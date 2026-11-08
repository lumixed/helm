import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema, type Db } from '@/db';
import type { DesktopApp, User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import type { ComputersClient } from './computers';
import { checkApp, checkDue, connectApp, disconnectApp, type DesktopDeps } from './desktop';
import type { ChatListRead } from './vision';

process.env.AUTH_SECRET ??= 'test-secret-test-secret-123';
process.env.DEMO_MODE = 'false';

let db: Db;
let maya: User;
let log: string[];
let mode: 'agent' | 'human';
let screen: ChatListRead;
let sent: { type: string; payload: Record<string, unknown> }[];

const computers: ComputersClient = {
  ensure: async (ext) => {
    log.push(`ensure ${ext}`);
    return { id: 'pc1', status: 'ready', mode, lastTakeoverResult: null };
  },
  get: async () => ({ id: 'pc1', status: 'ready', mode, lastTakeoverResult: null }),
  wake: async () => {
    log.push('wake');
  },
  act: async (_id, actions) => {
    log.push(`act ${actions.map((a) => `${a.action}:${a.text ?? ''}`).join(',')}`);
  },
  screenshot: async () => {
    log.push('screenshot');
    return new Uint8Array([1]);
  },
  sleep: async () => {
    log.push('sleep');
  },
  remove: async (id) => {
    log.push(`remove ${id}`);
  },
  viewer: async (_id, m) => {
    log.push(`viewer ${m}`);
    return { url: 'https://maritime.sh/computer/pc1?t=x', expiresAt: '2026-11-08T02:00:00Z' };
  },
};
const transport: AgentTransport = {
  kind: 'local',
  putFile: async () => {},
  send: async (_a, m) => {
    sent.push(JSON.parse(m));
  },
};
const t0 = new Date('2026-11-07T20:00:00Z');
const deps = (now = t0): DesktopDeps => ({
  computers,
  vision: async () => ({ ...screen, model: 'test' }),
  transport,
  now,
});
const row = async (): Promise<DesktopApp> =>
  (await db.select().from(schema.desktopApps).where(eq(schema.desktopApps.userId, maya.id)))[0]!;
const chats = (...c: [string, string, number][]): ChatListRead => ({
  screen: 'chat_list',
  chats: c.map(([name, lastMessage, unread]) => ({ name, lastMessage, time: '9:14', unread })),
});

beforeEach(async () => {
  log = [];
  sent = [];
  mode = 'agent';
  screen = { screen: 'login', chats: [] };
  db = await connect(undefined);
  [maya] = (await db
    .insert(schema.users)
    .values({ email: 'maya@x.edu', timezone: 'America/Vancouver' })
    .returning()) as [User];
  await db
    .insert(schema.agents)
    .values({ userId: maya.id, agentTokenHash: 'h', maritimeAgentId: 'agent-1', status: 'ready' });
});

describe('connect', () => {
  it("opens the app on the person's own desktop and returns a takeover link", async () => {
    const r = await connectApp(db, maya, 'whatsapp', deps());
    expect(r.url).toMatch(/^https:\/\/maritime\.sh\/computer\//);
    expect(log).toEqual([
      `ensure user_${maya.id}`,
      'act key:ctrl+l,type:https://web.whatsapp.com,key:Return,wait:',
      'viewer control',
    ]);
    expect((await row()).status).toBe('linking');
  });
});

describe('check', () => {
  beforeEach(async () => {
    await connectApp(db, maya, 'whatsapp', deps());
    log = [];
  });

  it('waits while the person holds the desktop, and never acts on it', async () => {
    mode = 'human';
    expect((await checkApp(db, await row(), deps(), { force: true })).outcome).toBe(
      'person_in_control',
    );
    expect(log).toEqual([]);
  });

  it('becomes linked on the first chat list, with a baseline (old messages are not sent)', async () => {
    expect((await checkApp(db, await row(), deps(), { force: true })).outcome).toBe(
      'not_logged_in',
    );
    screen = chats(['Landlord', 'Rent is due Dec 3', 2], ['Mom', 'Call me', 1]);
    expect((await checkApp(db, await row(), deps(), { force: true })).outcome).toBe('linked');
    expect(sent).toHaveLength(0);
    expect((await row()).status).toBe('linked');
  });

  it('sends only new unread previews to the agent, once, and goes back to sleep', async () => {
    screen = chats(['Landlord', 'Rent is due Dec 3', 2]);
    await checkApp(db, await row(), deps(), { force: true }); // baseline
    log = [];
    screen = chats(
      ['Prof. Lee', 'Assignment 4 moved to Saturday 5pm', 1],
      ['Landlord', 'Rent is due Dec 3', 2],
    );
    const r = await checkApp(db, await row(), deps(), { force: true });
    expect(r).toEqual({ outcome: 'checked', newMessages: 1 });
    expect(sent[0]).toMatchObject({
      type: 'inbox.message',
      payload: {
        source: 'whatsapp',
        from: 'Prof. Lee',
        body: 'Assignment 4 moved to Saturday 5pm',
      },
    });
    // Read-only: a check is wake, screenshot, sleep. No clicks, no typing.
    expect(log).toEqual(['wake', 'screenshot', 'sleep']);
    expect((await checkApp(db, await row(), deps(), { force: true })).newMessages).toBe(0);
  });

  it('notices a logout and alerts', async () => {
    screen = chats(['Mom', 'hi', 0]);
    await checkApp(db, await row(), deps(), { force: true });
    screen = { screen: 'login', chats: [] };
    expect((await checkApp(db, await row(), deps(), { force: true })).outcome).toBe('logged_out');
    expect((await row()).status).toBe('needs_login');
    const alerts = await db
      .select()
      .from(schema.agentEvents)
      .where(eq(schema.agentEvents.type, 'alert.sent'));
    expect(alerts[0]!.reason).toMatch(/logged out/);
  });

  it('respects the interval, and two callers never both run a check', async () => {
    screen = chats(['Mom', 'hi', 0]);
    await checkApp(db, await row(), deps(), { force: true });
    log = [];
    expect((await checkApp(db, await row(), deps(new Date(t0.getTime() + 60_000)))).outcome).toBe(
      'skipped',
    );
    const later = new Date(t0.getTime() + 16 * 60_000);
    const stale = await row();
    const [a, b] = await Promise.all([
      checkApp(db, stale, deps(later)),
      checkApp(db, stale, deps(later)),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(['checked', 'skipped']);
  });

  it('checkDue only looks at apps that are due', async () => {
    screen = chats(['Mom', 'hi', 0]);
    await checkApp(db, await row(), deps(), { force: true });
    expect(await checkDue(db, deps(new Date(t0.getTime() + 60_000)), maya.id)).toEqual({});
  });
});

describe('disconnect', () => {
  it('deletes the desktop (and its logins) when no app is left', async () => {
    await connectApp(db, maya, 'whatsapp', deps());
    await disconnectApp(db, maya.id, 'whatsapp', computers);
    expect(log.at(-1)).toBe('remove pc1');
    expect((await row()).status).toBe('disconnected');
  });
});
