import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import { listAssignments } from './assignments';
import { agentSettings } from './provisioning';
import { addTaskFromChat } from './tasks';
import { handleUpdate, setTelegramFetch } from './telegram';

process.env.AUTH_SECRET ??= 'test-secret-test-secret-123';

let db: Db;
let maya: User;
beforeEach(async () => {
  db = await connect(undefined);
  [maya] = (await db
    .insert(schema.users)
    .values({ email: 'm@x.edu', name: 'Maya', timezone: 'America/Vancouver' })
    .returning()) as [User];
});

describe('tasks from chat', () => {
  it('adds a confirmed task once per request, with its area', async () => {
    const t = {
      studentId: maya.id,
      requestId: 'chat:1',
      title: 'Dentist',
      dueAt: '2026-11-14T00:00:00.000Z',
      type: 'appointment' as const,
      area: 'Health',
    };
    const a = await addTaskFromChat(db, maya, t);
    const b = await addTaskFromChat(db, maya, t);
    expect(b.id).toBe(a.id);
    expect(a.dueLabel).toMatch(/Fri, Nov 13, 5:00 p\.m\./);
    const rows = await listAssignments(db, maya.id, maya.timezone);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Dentist',
      courseCode: 'Health',
      confirmed: true,
      type: 'appointment',
    });
  });
});

describe('routines in the agent settings file', () => {
  it('are included only when set, so each becomes a cron on the agent', async () => {
    expect(JSON.parse(agentSettings(maya)).routines).toBeUndefined();
    const [u] = (await db
      .update(schema.users)
      .set({ routinesJson: { evening: '21:00', weekly: { weekday: 0, time: '18:00' } } })
      .where(eq(schema.users.id, maya.id))
      .returning()) as [User];
    expect(JSON.parse(agentSettings(u)).routines).toEqual({
      evening: '21:00',
      weekly: { weekday: 0, time: '18:00' },
    });
  });
});

describe('two-way Telegram', () => {
  it('passes a linked chat’s message to the person’s agent and replies with its answer', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:test';
    const sent: Record<string, unknown>[] = [];
    setTelegramFetch((async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/sendMessage')) sent.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: {} });
    }) as typeof fetch);
    await db.update(schema.users).set({ telegramChatId: '42' }).where(eq(schema.users.id, maya.id));
    const asked: [string, string][] = [];
    const actions = {
      hold: async () => {},
      submitNow: async () => {},
      chat: async (userId: string, text: string) => {
        asked.push([userId, text]);
        return 'Lab report is due tomorrow at 11:59 pm.';
      },
    };
    expect(
      await handleUpdate(
        db,
        { message: { chat: { id: 42 }, text: "what's due tomorrow?" } },
        actions,
      ),
    ).toBe('chat');
    expect(asked).toEqual([[maya.id, "what's due tomorrow?"]]);
    expect(sent.at(-1)).toMatchObject({
      chat_id: '42',
      text: 'Lab report is due tomorrow at 11:59 pm.',
    });
    // An unlinked chat does not reach any agent.
    expect(await handleUpdate(db, { message: { chat: { id: 7 }, text: 'hi' } }, actions)).toBe(
      'ignored',
    );
    expect(asked).toHaveLength(1);
    delete process.env.TELEGRAM_BOT_TOKEN;
  });
});
