import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import {
  briefMessage,
  handleUpdate,
  linkCode,
  sendToUser,
  setTelegramFetch,
  verifyLinkCode,
} from './telegram';

process.env.AUTH_SECRET ??= 'test-secret-test-secret-123';

let db: Db;
let maya: User;
let calls: { method: string; body: Record<string, unknown> }[];

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123:test';
  calls = [];
  setTelegramFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split('/').pop()!;
    calls.push({ method, body: JSON.parse(String(init?.body)) });
    return Response.json({
      ok: true,
      result: method === 'getMe' ? { username: 'helm_test_bot' } : {},
    });
  }) as typeof fetch);
  db = await connect(undefined);
  [maya] = (await db
    .insert(schema.users)
    .values({ email: 'maya@x.edu', name: 'Maya' })
    .returning()) as [User];
});
afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
});

const actions = (log: string[]) => ({
  hold: async (u: string, id: string) => {
    log.push(`hold ${u} ${id}`);
  },
  submitNow: async (u: string, id: string) => {
    log.push(`now ${u} ${id}`);
  },
});

describe('link codes', () => {
  it('round-trips a user id and rejects tampering', () => {
    const code = linkCode(maya.id);
    expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(verifyLinkCode(code)).toBe(maya.id);
    expect(verifyLinkCode(`${code.slice(0, -1)}${code.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    expect(verifyLinkCode('nope')).toBeNull();
  });
});

describe('handleUpdate', () => {
  it('links a chat with /start <code>, and unlinks with /stop', async () => {
    expect(
      await handleUpdate(
        db,
        { message: { chat: { id: 42 }, text: `/start ${linkCode(maya.id)}` } },
        actions([]),
      ),
    ).toBe('linked');
    let [u] = await db.select().from(schema.users).where(eq(schema.users.id, maya.id));
    expect(u).toMatchObject({ telegramChatId: '42', channel: 'telegram' });
    expect(calls.at(-1)!.body.text).toMatch(/Connected/);

    await handleUpdate(db, { message: { chat: { id: 42 }, text: '/stop' } }, actions([]));
    [u] = await db.select().from(schema.users).where(eq(schema.users.id, maya.id));
    expect(u!.telegramChatId).toBeNull();
  });

  it('refuses a forged code', async () => {
    expect(
      await handleUpdate(
        db,
        { message: { chat: { id: 7 }, text: `/start ${'0'.repeat(32)}${'x'.repeat(22)}` } },
        actions([]),
      ),
    ).toBe('bad-code');
  });

  it('runs Hold for the linked student only', async () => {
    await db.update(schema.users).set({ telegramChatId: '42' }).where(eq(schema.users.id, maya.id));
    const log: string[] = [];
    await handleUpdate(
      db,
      {
        callback_query: {
          id: 'c1',
          data: 'hold:sub-1',
          message: { chat: { id: 42 }, message_id: 9 },
        },
      },
      actions(log),
    );
    expect(log).toEqual([`hold ${maya.id} sub-1`]);
    await handleUpdate(
      db,
      {
        callback_query: {
          id: 'c2',
          data: 'now:sub-1',
          message: { chat: { id: 99 }, message_id: 9 },
        },
      },
      actions(log),
    );
    expect(log).toHaveLength(1); // a stranger's chat can't act
  });
});

describe('sending', () => {
  it('only sends to a linked chat, with inline buttons', async () => {
    expect(await sendToUser(db, maya.id, 'hi')).toBe(false);
    await db.update(schema.users).set({ telegramChatId: '42' }).where(eq(schema.users.id, maya.id));
    expect(await sendToUser(db, maya.id, 'Last chance', [[{ text: 'Hold', data: 'hold:s' }]])).toBe(
      true,
    );
    expect(calls.at(-1)).toMatchObject({
      method: 'sendMessage',
      body: {
        chat_id: '42',
        reply_markup: { inline_keyboard: [[{ text: 'Hold', callback_data: 'hold:s' }]] },
      },
    });
  });

  it('writes a short brief with a link', () => {
    const text = briefMessage(
      {
        forDate: '2026-11-08',
        summary: 'Good morning, Maya. Start with Assignment 4.',
        focus: [
          {
            assignmentId: 'a',
            courseCode: 'DATA 210',
            title: 'Assignment 4',
            dueAt: '2026-11-14T01:00:00Z',
            why: 'w',
            minutes: 90,
            overdue: false,
          },
        ],
        dueSoon: [],
        changes: [],
        capacity: 'c',
        trigger: 'cron',
        writer: 'template',
      },
      'https://helm.test',
    );
    expect(text).toContain('1. DATA 210 · Assignment 4 (1.5h)');
    expect(text).toContain('https://helm.test/today');
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(160);
  });
});
