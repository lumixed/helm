import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { encodeAgentMessage, type AgentState } from '@helm/shared';
import type { ChatReply } from './tools/chat';
import { rawMessage } from './tools/gmail';

const state: AgentState = {
  studentId: 's1',
  name: 'Maya',
  timezone: 'America/Vancouver',
  briefTimeLocal: '07:30',
  assignments: [
    {
      id: 'a1',
      courseCode: 'DATA 210',
      title: 'Lab report',
      dueAt: '2026-11-11T06:59:00.000Z',
      weightPct: 10,
      estMinutes: 120,
      progressPct: 0,
      status: 'todo',
    },
  ],
  changes: [],
};

async function setup(opts: {
  reply?: ChatReply;
  gmail?: boolean;
  config?: Record<string, unknown>;
  calendarDenied?: boolean;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-asst-'));
  fs.mkdirSync(path.join(dir, 'helm'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'helm', 'config.json'),
    JSON.stringify({ v: 1, timezone: 'America/Vancouver', briefTime: '07:30', ...opts.config }),
  );
  process.env.HELM_DATA_DIR = dir;
  process.env.HELM_STUDENT_ID = 's1';
  vi.resetModules();
  const { createApp, buildSchedules } = await import('./server');
  const { Emitter } = await import('./emit');
  const { Dedupe } = await import('./dedupe');
  // After resetModules, so `instanceof` in the handlers sees this same class.
  const { GmailError } = await import('./tools/gmail');
  const events: { type: string; reason: string }[] = [];
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const drafts: unknown[] = [];
  const calendarWrites: { title: string }[][] = [];
  const app = createApp({
    emitter: new Emitter({
      target: () => ({ backendUrl: 'https://helm.test', token: 't', studentId: 's1' }),
      outbox: path.join(dir, 'o.jsonl'),
      fetch: (async (_u: string | URL | Request, init?: RequestInit) => {
        events.push(...(JSON.parse(String(init?.body)) as { events: typeof events }).events);
        return new Response('{"accepted":1,"duplicates":0}');
      }) as typeof fetch,
    }),
    dedupe: new Dedupe(path.join(dir, 'p.json')),
    handlerDeps: {
      dataDir: dir,
      now: () => new Date('2026-11-10T05:00:00Z'),
      get: async () => new Response(JSON.stringify(state)),
      post: async (p, body) => {
        posted.push({ path: p, body: body as Record<string, unknown> });
        if (p === '/api/agent/tasks')
          return Response.json({ dueLabel: 'Fri, Nov 13, 5:00 p.m.' }, { status: 201 });
        if (p === '/api/agent/routine') return Response.json({ delivered: true });
        return new Response('{}');
      },
      chat: async () => ({ ...opts.reply!, model: 'test' }),
      gmail: () =>
        opts.gmail
          ? {
              listNew: async () => [],
              listSent: async () => [],
              thread: async () => [],
              get: async () => {
                throw new Error('unused');
              },
              draft: async (d) => {
                drafts.push(d);
                return { id: 'd1' };
              },
              events: async () => [],
              addBlocks: async (blocks) => {
                if (opts.calendarDenied) throw new GmailError('auth');
                calendarWrites.push(blocks);
                return { added: blocks.length, existing: 0 };
              },
            }
          : null,
    },
  });
  const say = async (message: string) =>
    (
      (await (
        await app.request('/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, source: 'front_door' }),
        })
      ).json()) as { response: string }
    ).response;
  return { app, say, events, posted, drafts, calendarWrites, buildSchedules };
}

describe('tell it to do things', () => {
  it('adds a task from chat with the time converted in code', async () => {
    const { say, posted } = await setup({
      reply: {
        reply: 'Adding it.',
        intent: 'task',
        task: {
          title: 'Dentist',
          dueLocal: '2026-11-13T17:00',
          type: 'appointment',
          area: 'Health',
        },
      },
    });
    expect(await say('dentist friday 5pm')).toMatch(
      /^Added “Dentist”, at Fri, Nov 13, 5:00 p\.m\./,
    );
    expect(posted[0]).toMatchObject({
      path: '/api/agent/tasks',
      body: {
        title: 'Dentist',
        dueAt: '2026-11-14T00:00:00.000Z',
        type: 'appointment',
        area: 'Health',
      },
    });
  });

  it('refuses a time in the past', async () => {
    const { say, posted } = await setup({
      reply: {
        reply: 'x',
        intent: 'task',
        task: { title: 'Old', dueLocal: '2026-11-01T09:00', type: 'task' },
      },
    });
    expect(await say('add old thing')).toMatch(/already passed/);
    expect(posted).toHaveLength(0);
  });
});

describe('mark done from chat', () => {
  it('marks exactly the referenced item done', async () => {
    const { say, posted } = await setup({ reply: { reply: 'x', intent: 'done', doneRef: 'A1' } });
    expect(await say('I finished the lab report')).toMatch(/Marked “DATA 210 · Lab report” done/);
    expect(posted[0]).toMatchObject({
      path: '/api/agent/assignments/done',
      body: { assignmentId: 'a1' },
    });
  });
  it('asks which one when the ref is unknown', async () => {
    const { say, posted } = await setup({ reply: { reply: 'x', intent: 'done', doneRef: 'A9' } });
    expect(await say('I finished it')).toMatch(/Which one/);
    expect(posted).toHaveLength(0);
  });
});

describe('website tasks from chat', () => {
  const ask = (url: string): ChatReply => ({
    reply: 'Sure.',
    intent: 'website',
    website: { url, instruction: 'Renew my books' },
  });
  it('makes it ready for the person to start, and never says it is done', async () => {
    const { say, posted } = await setup({ reply: ask('vpl.ca') });
    expect(await say('renew my books on vpl.ca')).toMatch(/ready on the Tasks page.*Tap Start/);
    expect(posted.find((p) => p.path === '/api/agent/web-tasks')?.body).toMatchObject({
      url: 'vpl.ca',
      instruction: 'Renew my books',
    });
  });
  it('refuses a site the person did not name themselves', async () => {
    const { say, posted } = await setup({ reply: ask('https://evil.example/collect') });
    expect(await say('renew my books')).toMatch(/Which website/);
    expect(posted.some((p) => p.path === '/api/agent/web-tasks')).toBe(false);
  });
});

describe('email drafts', () => {
  const draft: ChatReply = {
    reply: 'Ready.',
    intent: 'draft',
    draft: {
      to: null,
      subject: 'Extension request: Lab report',
      body: 'Hi Prof. Lee,\n\n…\n\nMaya',
    },
  };
  it('saves to Gmail Drafts and says Helm never sends', async () => {
    const { say, drafts, events } = await setup({ reply: draft, gmail: true });
    expect(await say('ask my prof for an extension')).toMatch(
      /Saved to your Gmail Drafts.*never sends/,
    );
    expect(drafts).toEqual([draft.draft]);
    expect(events.find((e) => e.type === 'chat.replied')?.reason).toMatch(/not sent/);
  });
  it('without Gmail, shows the draft text instead', async () => {
    const { say } = await setup({ reply: draft, gmail: false });
    expect(await say('ask my prof for an extension')).toMatch(
      /connect Gmail[\s\S]*Subject: Extension request/,
    );
  });
  it('builds a valid raw message without header injection', () => {
    const raw = Buffer.from(
      rawMessage({ to: 'a@b.c\r\nBcc: evil@x', subject: 'Hi', body: 'x' }),
      'base64url',
    ).toString();
    expect(raw).toMatch(/^To: a@b\.cBcc: evil@x\r\n/); // newline stripped: no second header
    expect(raw).not.toMatch(/\r\nBcc:/);
  });
});

describe('routines on Maritime cron', () => {
  it('publishes evening and weekly crons in the person’s timezone', async () => {
    const { buildSchedules } = await setup({
      config: { routines: { evening: '21:00', weekly: { weekday: 0, time: '18:00' } } },
    });
    const s = buildSchedules();
    expect(s.find((x) => x.id === 'evening-checkin')).toMatchObject({
      cron: '0 21 * * *',
      tz: 'America/Vancouver',
    });
    expect(s.find((x) => x.id === 'weekly-review')).toMatchObject({ cron: '0 18 * * 0' });
  });

  it('writes the evening check-in from the plan and has Helm send it', async () => {
    const { app, posted, events } = await setup({});
    await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'scheduled',
        message: encodeAgentMessage({
          v: 1,
          type: 'routine.due',
          requestId: 'cron:routine:evening',
          studentId: 's1',
          payload: { routine: 'evening' },
        }),
      }),
    });
    const sent = posted.find((p) => p.path === '/api/agent/routine')!;
    expect(sent.body).toMatchObject({
      routine: 'evening',
      text: expect.stringMatching(/Due tomorrow: DATA 210 · Lab report/),
    });
    expect(events.find((e) => e.type === 'routine.sent')?.reason).toMatch(/sent to your phone/);
  });
});

describe('adding work blocks to Google Calendar', () => {
  const block = (start: string, end: string) => ({
    assignmentId: 'a1',
    title: 'Lab report',
    start,
    end,
  });
  const send = (
    app: Awaited<ReturnType<typeof setup>>['app'],
    blocks: ReturnType<typeof block>[],
  ) =>
    app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'front_door',
        message: encodeAgentMessage({
          v: 1,
          type: 'calendar.add_blocks',
          requestId: 'calendar:blocks:1',
          studentId: 's1',
          payload: { forDate: '2026-11-09', blocks },
        }),
      }),
    });
  // The test clock is 2026-11-10T05:00Z.
  const past = block('2026-11-10T03:00:00.000Z', '2026-11-10T04:00:00.000Z');
  const ahead = block('2026-11-10T06:00:00.000Z', '2026-11-10T07:00:00.000Z');

  it('writes only blocks still ahead and reports it', async () => {
    const { app, calendarWrites, events } = await setup({ gmail: true });
    await send(app, [past, ahead]);
    expect(calendarWrites).toEqual([[ahead]]);
    expect(events.find((e) => e.type === 'calendar.blocks_added')?.reason).toBe(
      'Added 1 work block to your Google Calendar',
    );
  });

  it('says to reconnect when Google has not allowed calendar writes', async () => {
    const { app, events } = await setup({ gmail: true, calendarDenied: true });
    await send(app, [ahead]);
    expect(events.find((e) => e.type === 'agent.error')?.reason).toMatch(/Connect Google again/);
    expect(events.find((e) => e.type === 'calendar.blocks_added')).toBeUndefined();
  });

  it('writes nothing without Google connected', async () => {
    const { app, calendarWrites, events } = await setup({ gmail: false });
    await send(app, [ahead]);
    expect(calendarWrites).toHaveLength(0);
    expect(events.find((e) => e.type === 'agent.error')?.reason).toMatch(/Connect Google/);
  });
});
