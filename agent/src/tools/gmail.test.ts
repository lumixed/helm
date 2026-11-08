import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { encodeAgentMessage, type AgentState } from '@helm/shared';
import { bodyText } from './gmail';
import { normalizeClassification } from './classify-email';

const b64 = (s: string) => Buffer.from(s).toString('base64url');

describe('bodyText', () => {
  it('prefers text/plain inside multipart', () => {
    expect(
      bodyText({
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64('Rent is due Dec 3.') } },
          { mimeType: 'text/html', body: { data: b64('<p>Rent</p>') } },
        ],
      }),
    ).toBe('Rent is due Dec 3.');
  });
  it('strips html when there is no plain part', () => {
    expect(
      bodyText({
        mimeType: 'text/html',
        body: { data: b64('<p>Hi&nbsp;Maya</p><script>x()</script><br>Bye') },
      }),
    ).toBe('Hi Maya\n\nBye');
  });
});

describe('gmail.sync handler', () => {
  it('reads new mail, registers metadata only, classifies, and skips it next time', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-gmail-'));
    process.env.HELM_DATA_DIR = dir;
    process.env.HELM_STUDENT_ID = 's1';
    vi.resetModules();
    const { createApp } = await import('../server');
    const { Emitter } = await import('../emit');
    const { Dedupe } = await import('../dedupe');
    const events: { type: string; reason: string }[] = [];
    const posted: { path: string; body: Record<string, unknown> }[] = [];
    const state: AgentState = {
      studentId: 's1',
      name: 'Maya',
      timezone: 'America/Vancouver',
      briefTimeLocal: '07:30',
      assignments: [],
      changes: [],
    };
    const email = {
      id: 'g1',
      from: 'Smile Dental <hi@smile.test>',
      subject: 'Appointment',
      receivedAt: '2026-11-07T17:00:00.000Z',
      body: 'SECRET BODY: your checkup is Tuesday Nov 17 at 9:30am.',
    };
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
        now: () => new Date('2026-11-07T18:00:00Z'),
        gmail: () => ({
          listNew: async () => ['g1'],
          get: async () => email,
          draft: async () => ({ id: 'd1' }),
        }),
        get: async () => new Response(JSON.stringify(state)),
        classify: async (e) => ({
          change: normalizeClassification(
            {
              kind: 'new_assignment',
              assignmentRef: null,
              matchConfidence: 0,
              newDueLocal: '2026-11-17T09:30',
              dueTimeAssumed: false,
              newTitle: 'Dentist checkup',
              courseCode: 'Health',
              weightPct: null,
              type: 'appointment',
              requirementNote: null,
              confidence: 0.95,
              evidence: null,
              summary: 'Dentist checkup on Tuesday at 9:30.',
              instructionsToAi: false,
            },
            e,
            { timezone: state.timezone, assignments: [] },
          ),
          model: 'test',
        }),
        post: async (p, body) => {
          posted.push({ path: p, body: body as Record<string, unknown> });
          if (p === '/api/agent/inbox/message')
            return Response.json({ inboxMessageId: 'm1', alreadyProcessed: false });
          return Response.json({
            decision: 'review',
            reason: 'New item.',
            changeId: null,
            assignmentTitle: null,
          });
        },
      },
    });
    const sync = (id: string) =>
      app.request('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'webhook',
          message: encodeAgentMessage({
            v: 1,
            type: 'gmail.sync',
            requestId: id,
            studentId: 's1',
            payload: { reason: 'manual' },
          }),
        }),
      });
    await sync('gmail:manual:1');
    expect(posted.map((p) => p.path)).toEqual([
      '/api/agent/inbox/message',
      '/api/agent/inbox/result',
    ]);
    expect(posted[0]!.body).toMatchObject({
      externalId: 'g1',
      source: 'email',
      subject: 'Appointment',
    });
    expect(JSON.stringify(posted)).not.toContain('SECRET BODY'); // the body never leaves the VM
    expect(events.find((e) => e.type === 'inbox.classified')?.reason).toMatch(
      /Read an email from Smile Dental/,
    );

    posted.length = 0;
    await sync('gmail:manual:2');
    expect(posted).toHaveLength(0); // already seen
    expect(events.at(-1)!.reason).toBe('Checked your Gmail: nothing new.');
  });
});
