import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { encodeAgentMessage } from '@helm/shared';

const feed = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:event-assignment-1',
  'DTSTART:20261114T065900Z',
  'SUMMARY:Assignment 5 [DATA 210]',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('calendar.sync handler', () => {
  it('fetches the feed from its env, reports deadlines only, and the heartbeat syncs at most hourly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-cal-'));
    process.env.HELM_DATA_DIR = dir;
    process.env.HELM_STUDENT_ID = 's1';
    process.env.CANVAS_ICS_URL = 'https://school.instructure.com/feeds/calendars/user_x.ics';
    vi.resetModules();
    const { createApp } = await import('../server');
    const { Emitter } = await import('../emit');
    const { Dedupe } = await import('../dedupe');
    const events: { type: string; reason: string }[] = [];
    const fetched: string[] = [];
    const posted: { path: string; body: { items: { uid: string; courseCode: string }[] } }[] = [];
    let now = new Date('2026-11-08T18:00:00Z');
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
        now: () => now,
        fetchFeed: async (u) => {
          fetched.push(u);
          return feed;
        },
        post: async (p, body) => {
          posted.push({ path: p, body: body as never });
          return p === '/api/agent/calendar/result'
            ? Response.json({ added: 1, moved: 0, unchanged: 0 })
            : new Response('{}');
        },
      },
    });
    const send = (type: 'calendar.sync' | 'heartbeat', id: string) =>
      app.request('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: type === 'heartbeat' ? 'scheduled' : 'webhook',
          message: encodeAgentMessage(
            type === 'heartbeat'
              ? { v: 1, type, requestId: id, studentId: 's1' }
              : { v: 1, type, requestId: id, studentId: 's1', payload: { reason: 'manual' } },
          ),
        }),
      });

    await send('calendar.sync', 'c1');
    expect(fetched).toEqual([process.env.CANVAS_ICS_URL]);
    const result = posted.find((p) => p.path === '/api/agent/calendar/result')!;
    expect(result.body.items).toMatchObject([
      { uid: 'event-assignment-1', courseCode: 'DATA 210' },
    ]);
    expect(events.find((e) => e.type === 'intake.parsed')?.reason).toMatch(
      /Synced your Canvas calendar: 1 new/,
    );

    now = new Date('2026-11-08T18:20:00Z');
    await send('heartbeat', 'cron:heartbeat-1');
    expect(fetched).toHaveLength(1); // synced 20 min ago: skip
    now = new Date('2026-11-08T19:30:00Z');
    await send('heartbeat', 'cron:heartbeat-2');
    expect(fetched).toHaveLength(2);
    delete process.env.CANVAS_ICS_URL;
  });
});
