import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { encodeAgentMessage, type WeekFacts } from '@helm/shared';

const FACTS: WeekFacts = {
  weekEnding: '2026-11-08',
  done: [{ title: 'Essay 1', courseCode: 'ENGL 150', at: '2026-11-05T20:00:00.000Z' }],
  slipped: [{ title: 'Lab 3', courseCode: 'CHEM 121', at: '2026-11-06T07:00:00.000Z' }],
  nextWeek: [
    { title: 'Assignment 4', courseCode: 'DATA 210', at: '2026-11-13T07:59:00.000Z', minutes: 180 },
  ],
  nextWeekMinutes: 180,
  changesCaught: 2,
  remindersSent: 1,
  agentWakes: 30,
  cronWakes: 20,
};

async function setup(word: () => Promise<{ summary: string; writer: string }>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-review-'));
  process.env.HELM_DATA_DIR = dir;
  process.env.HELM_STUDENT_ID = 's1';
  fs.mkdirSync(path.join(dir, 'helm'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'helm', 'config.json'),
    JSON.stringify({
      v: 1,
      timezone: 'America/Los_Angeles',
      routines: { weekly: { weekday: 0, time: '18:00' } },
    }),
  );
  vi.resetModules();
  const { createApp } = await import('./server');
  const { Emitter } = await import('./emit');
  const { Dedupe } = await import('./dedupe');
  const events: { type: string; reason: string }[] = [];
  const posts: { path: string; body: Record<string, unknown> }[] = [];
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
      get: async () => new Response(JSON.stringify({ facts: FACTS, name: 'Maya' })),
      post: async (p, body) => {
        posts.push({ path: p, body: body as Record<string, unknown> });
        return new Response('{"stored":true}');
      },
      wordWeek: word,
    },
  });
  return { app, events, posts };
}

const fire = (app: Awaited<ReturnType<typeof setup>>['app']) =>
  app.request('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'scheduled',
      message: encodeAgentMessage({
        v: 1,
        type: 'routine.due',
        requestId: 'cron:routine:weekly',
        studentId: 's1',
        payload: { routine: 'weekly' },
      }),
    }),
  });

describe('weekly review on its own Maritime cron', () => {
  it('is published as the weekly routine’s schedule in the person’s timezone', async () => {
    const { app } = await setup(async () => ({ summary: 'x', writer: 'm' }));
    const s = (await (await app.request('/schedules')).json()) as {
      id: string;
      cron: string;
      tz: string;
    }[];
    expect(s.find((e) => e.id === 'weekly-review')).toMatchObject({
      cron: '0 18 * * 0',
      tz: 'America/Los_Angeles',
    });
  });

  it('words the opener with the model and sends it to Helm', async () => {
    const { app, events, posts } = await setup(async () => ({
      summary: 'Nice week, Maya.',
      writer: 'gemini-test',
    }));
    await fire(app);
    expect(posts[0]).toMatchObject({
      path: '/api/agent/review',
      body: { summary: 'Nice week, Maya.', writer: 'gemini-test' },
    });
    expect(events.find((e) => e.type === 'review.written')?.reason).toBe(
      'Wrote your weekly review: 1 done, 1 slipped, 1 due next week',
    );
  });

  it('falls back to a plain template when the model fails', async () => {
    const { app, posts } = await setup(async () => {
      throw new Error('503');
    });
    await fire(app);
    expect(posts[0]?.body).toMatchObject({ writer: 'template' });
    expect(String(posts[0]?.body.summary)).toBe(
      "Here's your week, Maya. You finished 1 thing. 1 item slipped past its date; pick one to finish or drop. Next week has 1 deadline, about 3 hours of work.",
    );
  });
});
