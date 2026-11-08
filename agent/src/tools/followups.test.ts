import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from './gmail';
import { WaitingStore, checkWaiting, type Judge, type WaitingGmail } from './followups';

const NOW = new Date('2026-11-08T18:00:00Z');
const daysAgo = (d: number) => NOW.getTime() - d * 86_400_000;
const ME = 'Maya Chen <maya@x.edu>';

function fixture() {
  const threads: Record<string, ThreadMessage[]> = {
    landlord: [
      {
        id: 's1',
        from: ME,
        to: 'Dave <dave@rent.ca>',
        subject: 'Deposit',
        messageId: '<a@x>',
        at: daysAgo(5),
      },
    ],
    prof: [
      {
        id: 's2',
        from: ME,
        to: 'prof@uni.ca',
        subject: 'Extension?',
        messageId: '<b@x>',
        at: daysAgo(6),
      },
      {
        id: 'r2',
        from: 'Prof Lee <prof@uni.ca>',
        to: ME,
        subject: 'Re: Extension?',
        messageId: '<c@x>',
        at: daysAgo(4),
      },
    ],
    thanks: [
      {
        id: 's3',
        from: ME,
        to: 'sam@club.ca',
        subject: 'Thanks!',
        messageId: '<d@x>',
        at: daysAgo(4),
      },
    ],
    robot: [
      {
        id: 's4',
        from: ME,
        to: 'no-reply@shop.com',
        subject: 'Order',
        messageId: '<e@x>',
        at: daysAgo(4),
      },
    ],
  };
  const gmail: WaitingGmail = {
    listSent: async () => [
      { id: 's1', threadId: 'landlord' },
      { id: 's2', threadId: 'prof' },
      { id: 's3', threadId: 'thanks' },
      { id: 's4', threadId: 'robot' },
    ],
    thread: async (id) => threads[id]!,
    get: async (id) => ({
      id,
      from: ME,
      subject: '',
      receivedAt: '',
      body: id === 's1' ? 'Hi Dave, when will my deposit come back?' : 'Thanks for everything!',
    }),
  };
  const judged: string[][] = [];
  const judge: Judge = async (emails) => {
    judged.push(emails.map((e) => e.to));
    return {
      items: emails.map((e) => ({
        ref: e.ref,
        needsReply: e.body.includes('?'),
        summary: e.body.includes('?') ? 'Asked Dave when the deposit comes back' : '',
      })),
    };
  };
  const store = new WaitingStore(fs.mkdtempSync(path.join(os.tmpdir(), 'helm-waiting-')));
  return { threads, gmail, judge, judged, store };
}

describe('waiting on', () => {
  it('reports only unanswered mail that asked for something, judging each email once', async () => {
    const { gmail, judge, judged, store } = fixture();
    const r = await checkWaiting(gmail, judge, store, NOW);
    expect(r.open).toEqual([
      {
        threadId: 'landlord',
        to: 'Dave',
        subject: 'Deposit',
        summary: 'Asked Dave when the deposit comes back',
        sentAt: new Date(daysAgo(5)).toISOString(),
      },
    ]);
    // The prof replied, the no-reply address is skipped: only two emails reach the model.
    expect(judged).toEqual([['Dave <dave@rent.ca>', 'sam@club.ca']]);
    // Within 6 hours: no new check. Forced: nothing new, nothing judged again.
    expect((await checkWaiting(gmail, judge, store, NOW)).skipped).toBe(true);
    expect(await checkWaiting(gmail, judge, store, NOW, { force: true })).toEqual({
      open: [],
      replied: [],
    });
    expect(judged).toHaveLength(1);
  });

  it('closes an item once the other person answers', async () => {
    const { gmail, judge, store, threads } = fixture();
    await checkWaiting(gmail, judge, store, NOW);
    threads.landlord!.push({
      id: 'r1',
      from: 'Dave <dave@rent.ca>',
      to: ME,
      subject: 'Re: Deposit',
      messageId: '<f@x>',
      at: daysAgo(1),
    });
    expect(await checkWaiting(gmail, judge, store, NOW, { force: true })).toEqual({
      open: [],
      replied: ['landlord'],
    });
  });
});

describe('draft a nudge', () => {
  it('saves a reply draft in the same thread (never sends) and tells Helm', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-nudge-'));
    process.env.HELM_DATA_DIR = dir;
    process.env.HELM_STUDENT_ID = 's1';
    const { vi } = await import('vitest');
    vi.resetModules();
    const { createApp } = await import('../server');
    const { Emitter } = await import('../emit');
    const { Dedupe } = await import('../dedupe');
    const { encodeAgentMessage } = await import('@helm/shared');
    const { threads, gmail } = fixture();
    const drafts: Record<string, unknown>[] = [];
    const posted: string[] = [];
    const app = createApp({
      emitter: new Emitter({
        target: () => ({ backendUrl: 'https://helm.test', token: 't', studentId: 's1' }),
        outbox: path.join(dir, 'o.jsonl'),
        fetch: (async () => new Response('{"accepted":1,"duplicates":0}')) as typeof fetch,
      }),
      dedupe: new Dedupe(path.join(dir, 'p.json')),
      handlerDeps: {
        dataDir: dir,
        get: async () =>
          new Response(
            JSON.stringify({
              studentId: 's1',
              name: 'Maya',
              timezone: 'UTC',
              briefTimeLocal: '07:30',
              assignments: [],
              changes: [],
            }),
          ),
        post: async (p) => {
          posted.push(p);
          return new Response('{}');
        },
        writeNudge: async () => {
          throw new Error('no model');
        },
        gmail: () => ({
          ...gmail,
          listNew: async () => [],
          draft: async (d) => {
            drafts.push(d);
            return { id: 'd1' };
          },
        }),
      },
    });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'webhook',
        message: encodeAgentMessage({
          v: 1,
          type: 'followup.draft',
          requestId: 'f1',
          studentId: 's1',
          payload: { threadId: 'landlord' },
        }),
      }),
    });
    expect(((await res.json()) as { response: string }).response).toBe('followup: draft saved');
    expect(drafts[0]).toMatchObject({
      to: 'Dave <dave@rent.ca>',
      subject: 'Re: Deposit',
      threadId: 'landlord',
      inReplyTo: '<a@x>',
    });
    expect(String(drafts[0]!.body)).toContain('Just following up');
    expect(String(drafts[0]!.body)).toMatch(/Maya$/);
    expect(posted).toContain('/api/agent/waiting/drafted');
    expect(threads.landlord).toHaveLength(1);
  });
});
