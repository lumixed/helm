import { beforeEach, describe, expect, it } from 'vitest';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import type { MaritimeClient } from './maritime';
import { mintChatToken, relayChat } from './chat';

let db: Db;
let maya: User;
let minted: { ext: string; scopes: string[]; ttl: number }[];
const maritime = {
  mintToken: async (ext: string, p: { scopes: string[]; ttlSeconds: number }) => {
    minted.push({ ext, scopes: p.scopes, ttl: p.ttlSeconds });
    return { token: 'eu_SECRET', agentId: 'mt_1', expiresAt: '2026-11-08T00:15:00Z' };
  },
} as unknown as MaritimeClient;

beforeEach(async () => {
  minted = [];
  db = await connect(undefined);
  [maya] = (await db.insert(schema.users).values({ email: 'm@x.edu' }).returning()) as [User];
  await db
    .insert(schema.agents)
    .values({ userId: maya.id, agentTokenHash: 'h', maritimeAgentId: 'mt_1', status: 'ready' });
});

describe('chat tokens', () => {
  it("mints a chat-only token for this person's end user, and records it without the token", async () => {
    const t = await mintChatToken(db, maya, maritime);
    expect(t.token).toBe('eu_SECRET');
    expect(minted).toEqual([{ ext: `user_${maya.id}`, scopes: ['chat'], ttl: 900 }]);
    const rows = await db.select().from(schema.maritimeEvents);
    expect(rows[0]!.kind).toBe('helm.token_minted');
    expect(JSON.stringify(rows)).not.toContain('eu_SECRET');
  });
});

describe('relayChat', () => {
  it('relays with a 60-second chat token to this person’s agent only', async () => {
    const calls: { url: string; auth: string; body: unknown }[] = [];
    const f = (async (u: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(u),
        auth: (init?.headers as Record<string, string>).authorization ?? '',
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({ response: 'Assignment 4 is due Friday.' });
    }) as typeof fetch;
    const answer = await relayChat(db, maya, "what's due?", 'app', { maritime, fetch: f });
    expect(answer).toBe('Assignment 4 is due Friday.');
    expect(minted[0]!.ttl).toBe(60);
    expect(calls[0]).toMatchObject({
      url: 'https://api.maritime.sh/api/agents/mt_1/chat',
      auth: 'Bearer eu_SECRET',
      body: { message: "what's due?", conversation_id: 'app' },
    });
  });

  it('talks to the local agent in development', async () => {
    const f = (async (u: string | URL | Request) => {
      expect(String(u)).toBe('http://127.0.0.1:8787/chat');
      return Response.json({ response: 'local answer' });
    }) as typeof fetch;
    expect(
      await relayChat(db, maya, 'hi', 'app', {
        maritime: null,
        localAgentUrl: 'http://127.0.0.1:8787',
        fetch: f,
      }),
    ).toBe('local answer');
  });
});
