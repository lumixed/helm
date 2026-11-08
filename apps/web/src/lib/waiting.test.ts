import { afterEach, describe, expect, it } from 'vitest';
import { connect, schema } from '@/db';
import { registerPushToken, setPushFetch } from './push';
import { dismissWaiting, markDrafted, openWaiting, saveWaitingReport } from './waiting';

afterEach(() => setPushFetch((...a) => fetch(...a)));

const item = (threadId: string, summary: string) => ({
  threadId,
  to: 'Dave',
  subject: 'Deposit',
  summary,
  sentAt: '2026-11-03T18:00:00.000Z',
});

describe('waiting on', () => {
  it('adds new items once, tells the phone, closes answered ones, never re-opens', async () => {
    const db = await connect(undefined);
    const [u] = await db.insert(schema.users).values({ email: 'w@x.edu' }).returning();
    await registerPushToken(db, u!.id, 'ExponentPushToken[w1]', 'ios');
    const pushed: string[] = [];
    setPushFetch((async (_u: string | URL | Request, init?: RequestInit) => {
      const msgs = JSON.parse(String(init?.body)) as { body: string }[];
      pushed.push(...msgs.map((m) => m.body));
      return Response.json({ data: msgs.map(() => ({ status: 'ok' })) });
    }) as typeof fetch);

    await saveWaitingReport(db, u!.id, {
      open: [
        item('t1', 'Asked Dave when the deposit comes back'),
        item('t2', 'Asked Sam for notes'),
      ],
      replied: [],
    });
    expect((await openWaiting(db, u!.id)).map((w) => w.summary)).toHaveLength(2);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain('Asked Dave when the deposit comes back');

    // Same thread again: no duplicate, no second message.
    expect(
      (await saveWaitingReport(db, u!.id, { open: [item('t1', 'x')], replied: [] })).added,
    ).toEqual([]);
    expect(pushed).toHaveLength(1);

    await saveWaitingReport(db, u!.id, { open: [], replied: ['t2'] });
    const [t1] = await openWaiting(db, u!.id);
    expect(t1?.threadId).toBe('t1');
    await markDrafted(db, u!.id, 't1');
    expect((await openWaiting(db, u!.id))[0]?.draftedAt).toBeTruthy();
    expect(await dismissWaiting(db, u!.id, t1!.id)).toBe(true);
    expect(await openWaiting(db, u!.id)).toEqual([]);
    // A dismissed thread is not brought back by a later report.
    await saveWaitingReport(db, u!.id, { open: [item('t1', 'x')], replied: [] });
    expect(await openWaiting(db, u!.id)).toEqual([]);
  });
});
