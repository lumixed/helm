import { describe, expect, it } from 'vitest';
import { connect, schema } from '@/db';
import type { User } from '@/db/schema';
import { confirmAssignments, listAssignments, saveIntakeResult } from './assignments';
import { mobileSchedule } from './mobile-schedule';
import { registerPushToken } from './push';
import { createReminder } from './reminders';

describe('mobileSchedule', () => {
  it('lists the next briefs in the person’s timezone and day-before reminders, never in the past', async () => {
    const db = await connect(undefined);
    const [user] = (await db
      .insert(schema.users)
      .values({ email: 'm@x.edu', timezone: 'America/Los_Angeles', briefTimeLocal: '07:30' })
      .returning()) as [User];
    const now = new Date('2026-11-09T18:00:00Z'); // 10:00 in Los Angeles: today's brief has passed
    await saveIntakeResult(db, user.id, 'i', [
      {
        courseCode: 'X 1',
        title: 'Soon',
        dueAt: '2026-11-11T07:59:00.000Z',
        dueTimeAssumed: false,
        weightPct: 10,
        type: 'assignment',
        allowedFileTypes: [],
        confidence: 0.9,
      },
      {
        courseCode: 'X 1',
        title: 'Far',
        dueAt: '2026-12-20T07:59:00.000Z',
        dueTimeAssumed: false,
        weightPct: 10,
        type: 'assignment',
        allowedFileTypes: [],
        confidence: 0.9,
      },
    ]);
    const rows = await listAssignments(db, user.id, 'UTC', { review: true });
    await confirmAssignments(
      db,
      user.id,
      rows.map((r) => r.id),
      [],
    );

    const list = await mobileSchedule(db, user, now);
    const briefs = list.filter((n) => n.id.startsWith('brief:'));
    expect(briefs).toHaveLength(6); // Nov 10..15; Nov 9 already passed
    expect(briefs[0]).toMatchObject({ at: '2026-11-10T15:30:00.000Z', path: '/today' }); // 07:30 PST
    const due = list.filter((n) => n.id.startsWith('due:'));
    expect(due).toHaveLength(1); // "Far" is beyond a week
    expect(due[0]).toMatchObject({ at: '2026-11-10T07:59:00.000Z', title: 'Due tomorrow' });
    expect(list.every((n) => Date.parse(n.at) > now.getTime())).toBe(true);

    await createReminder(
      db,
      user,
      { title: 'Vitamins', rule: { repeat: 'daily', time: '08:00' } },
      'you',
      now,
    );
    const withReminder = await mobileSchedule(db, user, now);
    const rem = withReminder.filter((n) => n.id.startsWith('reminder:'));
    expect(rem.map((n) => n.at)).toEqual([
      '2026-11-10T16:00:00.000Z',
      '2026-11-11T16:00:00.000Z',
      '2026-11-12T16:00:00.000Z',
    ]);
    expect(rem[0]).toMatchObject({ body: 'Vitamins', path: '/reminders' });
    // A phone with server push gets reminders from the agent's cron instead: no duplicates.
    await registerPushToken(db, user.id, 'ExponentPushToken[dev1]', 'ios');
    expect(
      (await mobileSchedule(db, user, now)).filter((n) => n.id.startsWith('reminder:')),
    ).toHaveLength(0);
    expect(list.map((n) => n.at)).toEqual([...list.map((n) => n.at)].sort());
  });
});
