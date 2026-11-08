import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema, type Db } from '@/db';
import type { AgentRow, User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import type { MaritimeClient } from './maritime';
import { authUrl, connectGmail, registerAgentEmail, signState, verifyState } from './gmail';
import { egressAllowlist } from './network';

process.env.AUTH_SECRET ??= 'test-secret-test-secret-123';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'csecret';
process.env.APP_BASE_URL = 'https://helm.test';

let db: Db;
let maya: User;
let agent: AgentRow;
beforeEach(async () => {
  db = await connect(undefined);
  [maya] = (await db.insert(schema.users).values({ email: 'maya@x.edu' }).returning()) as [User];
  [agent] = (await db
    .insert(schema.agents)
    .values({ userId: maya.id, agentTokenHash: 'h', maritimeAgentId: 'mt_1', status: 'ready' })
    .returning()) as [AgentRow];
});

describe('OAuth state', () => {
  it('is signed and expires', () => {
    const s = signState(maya.id, 0);
    expect(verifyState(s, 0)).toBe(maya.id);
    expect(verifyState(s, 11 * 60_000)).toBeNull();
    expect(verifyState(s.replace(maya.id, '00000000-0000-0000-0000-000000000000'), 0)).toBeNull();
  });
  it('asks Google for read-only Gmail with offline access', () => {
    const u = new URL(authUrl(maya.id));
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('redirect_uri')).toBe('https://helm.test/api/gmail/callback');
  });
});

describe('connectGmail', () => {
  it('puts the refresh token only in the agent env, never in the database', async () => {
    const env = new Map<string, { value: string; secret: boolean }>();
    let reloads = 0;
    const maritime = {
      setEnv: async (id: string, k: string, v: string, secret: boolean) => {
        env.set(`${id}:${k}`, { value: v, secret });
      },
      reloadEnv: async () => {
        reloads++;
      },
    } as unknown as MaritimeClient;
    const sent: string[] = [];
    const transport: AgentTransport = {
      kind: 'maritime',
      putFile: async () => {},
      send: async (_a, m) => {
        sent.push(m);
      },
    };
    const fakeGoogle = (async (url: string | URL | Request) =>
      String(url).includes('/token')
        ? Response.json({
            access_token: 'at',
            refresh_token: 'RT-SECRET',
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
          })
        : Response.json({ emailAddress: 'maya.demo@gmail.com' })) as typeof fetch;

    const r = await connectGmail(db, maya, agent, maritime, transport, 'code', {
      fetch: fakeGoogle,
    });
    expect(r.email).toBe('maya.demo@gmail.com');
    expect(env.get('mt_1:GMAIL_REFRESH_TOKEN')).toEqual({ value: 'RT-SECRET', secret: true });
    expect(env.get('mt_1:GOOGLE_CLIENT_SECRET')?.secret).toBe(true);
    expect(reloads).toBe(1);
    expect(JSON.parse(sent[0]!).type).toBe('gmail.sync');
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, maya.id));
    expect(u!.gmailAddress).toBe('maya.demo@gmail.com');
    expect(JSON.stringify(u)).not.toContain('RT-SECRET');
  });
});

describe('registerAgentEmail', () => {
  it('registers a Gmail message once, with metadata only', async () => {
    const req = {
      studentId: maya.id,
      source: 'email' as const,
      externalId: 'g1',
      from: 'Smile Dental',
      subject: 'Appointment',
      receivedAt: '2026-11-07T17:00:00.000Z',
      bodySha256: 'a'.repeat(64),
    };
    const a = await registerAgentEmail(db, maya.id, req);
    const b = await registerAgentEmail(db, maya.id, req);
    expect(b.inboxMessageId).toBe(a.inboxMessageId);
    const rows = await db.select().from(schema.inboxMessages);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'email', subject: 'Appointment', status: 'sent' });
  });
});

describe('egress allowlist', () => {
  it('adds only Google token + Gmail API hosts when Gmail is set up', () => {
    expect(egressAllowlist()).toEqual(
      expect.arrayContaining(['oauth2.googleapis.com', 'gmail.googleapis.com', 'helm.test']),
    );
    expect(egressAllowlist({ ...process.env, GOOGLE_CLIENT_ID: '' })).not.toContain(
      'gmail.googleapis.com',
    );
  });
});
