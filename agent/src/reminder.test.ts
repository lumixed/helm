import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { encodeAgentMessage, parseInbound } from '@helm/shared';

const RENT = {
  id: 'r1',
  title: 'Pay rent',
  rule: { repeat: 'monthly', day: 1, time: '09:00' },
};
const LAST_DAY = {
  id: 'r2',
  title: 'Phone bill',
  rule: { repeat: 'monthly', day: 31, time: '09:00' },
};

async function setup(now: string, postStatus = 200, postBody: object = { delivered: true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-reminder-'));
  process.env.HELM_DATA_DIR = dir;
  process.env.HELM_STUDENT_ID = 's1';
  fs.mkdirSync(path.join(dir, 'helm'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'helm', 'config.json'),
    JSON.stringify({ v: 1, timezone: 'America/Los_Angeles', reminders: [RENT, LAST_DAY] }),
  );
  vi.resetModules();
  const { createApp } = await import('./server');
  const { Emitter } = await import('./emit');
  const { Dedupe } = await import('./dedupe');
  const events: Array<{ type: string; reason: string; payload: Record<string, unknown> }> = [];
  const emitter = new Emitter({
    target: () => ({ backendUrl: 'https://backend.test', token: 't', studentId: 's1' }),
    outbox: path.join(dir, 'outbox.jsonl'),
    fetch: (async (_u: string, init?: RequestInit) => {
      events.push(...(JSON.parse(String(init?.body)) as { events: typeof events }).events);
      return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }));
    }) as typeof fetch,
  });
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const app = createApp({
    emitter,
    dedupe: new Dedupe(path.join(dir, 'processed.json')),
    handlerDeps: {
      now: () => new Date(now),
      post: async (p, body) => {
        posts.push({ path: p, body: body as Record<string, unknown> });
        return new Response(JSON.stringify(postBody), { status: postStatus });
      },
    },
  });
  const fire = (id: string) =>
    app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'scheduled',
        message: encodeAgentMessage({
          v: 1,
          type: 'reminder.due',
          requestId: `cron:reminder:${id}`,
          studentId: 's1',
          payload: { reminderId: id },
        }),
      }),
    });
  return { app, fire, events, posts };
}

describe('reminders on Maritime cron', () => {
  it('publishes one platform cron per reminder, in the person’s timezone, carrying only the id', async () => {
    const { app } = await setup('2026-11-08T18:00:00Z');
    const body = (await (await app.request('/schedules')).json()) as Array<{
      id: string;
      cron: string;
      tz: string;
      prompt: string;
    }>;
    const rent = body.find((e) => e.id === 'reminder-r1')!;
    expect(rent).toMatchObject({ cron: '0 9 1 * *', tz: 'America/Los_Angeles' });
    expect(rent.prompt).not.toContain('Pay rent');
    const msg = parseInbound(rent.prompt);
    expect(msg.kind === 'protocol' && msg.message.type).toBe('reminder.due');
    expect(body.find((e) => e.id === 'reminder-r2')?.cron).toBe('0 9 28-31 * *');
  });

  it('tells the backend when the cron fires on time and puts it on the timeline', async () => {
    const { fire, events, posts } = await setup('2026-12-01T17:00:20Z'); // 09:00:20 PST
    const res = (await (await fire('r1')).json()) as { response: string };
    expect(res.response).toContain('sent to your phone');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      path: '/api/agent/reminders/fired',
      body: { reminderId: 'r1', occurrenceAt: '2026-12-01T17:00:00.000Z' },
    });
    const fired = events.find((e) => e.type === 'reminder.fired')!;
    expect(fired.reason).toBe('Reminded you: Pay rent');
    expect(fired.payload).toMatchObject({ firedBy: 'maritime_cron', source: 'scheduled' });
  });

  it('stays quiet on the extra "28-31" wakes that are not the last day', async () => {
    const { fire, posts, events } = await setup('2026-12-28T17:00:00Z');
    const res = (await (await fire('r2')).json()) as { response: string };
    expect(res.response).toContain('not due today');
    expect(posts).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('ignores a reminder that was deleted before Maritime re-synced the schedule', async () => {
    const { fire, posts } = await setup('2026-12-01T17:00:00Z');
    const res = (await (await fire('gone')).json()) as { response: string };
    expect(res.response).toContain('no longer set');
    expect(posts).toHaveLength(0);
  });

  it('adds nothing to the timeline when the heartbeat already sent it', async () => {
    const { fire, events } = await setup('2026-12-01T17:00:00Z', 200, { duplicate: true });
    await fire('r1');
    expect(events.filter((e) => e.type === 'reminder.fired')).toHaveLength(0);
  });
});

describe('reminder backend failures', () => {
  it('records nothing when the backend is down (the heartbeat sends it later)', async () => {
    const { fire, events } = await setup('2026-12-01T17:00:00Z', 503, {});
    const res = (await (await fire('r1')).json()) as { response: string };
    expect(res.response).toContain('heartbeat');
    expect(events.filter((e) => e.type === 'reminder.fired')).toHaveLength(0);
  });
});
