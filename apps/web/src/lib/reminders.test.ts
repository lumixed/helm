import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema } from '@/db';
import type { User } from '@/db/schema';
import { agentSettings } from './provisioning';
import { registerPushToken, setPushFetch } from './push';
import {
  activeSchedules,
  catchUpReminders,
  createReminder,
  fireReminder,
  reminderViews,
  updateReminder,
} from './reminders';

afterEach(() => setPushFetch((...a) => fetch(...a)));

async function person() {
  const db = await connect(undefined);
  const [user] = (await db
    .insert(schema.users)
    .values({ email: 'r@x.edu', timezone: 'America/Los_Angeles' })
    .returning()) as [User];
  return { db, user };
}

const NOW = new Date('2026-11-08T18:00:00Z'); // Sun 10:00 PST

describe('reminders', () => {
  it('creates, describes and orders reminders; rejects a time already past', async () => {
    const { db, user } = await person();
    await createReminder(
      db,
      user,
      { title: 'Pay rent', rule: { repeat: 'monthly', day: 1, time: '09:00' } },
      'chat',
      NOW,
    );
    await createReminder(
      db,
      user,
      { title: 'Dentist', rule: { repeat: 'once', date: '2026-11-10', time: '15:00' } },
      'you',
      NOW,
    );
    await expect(
      createReminder(
        db,
        user,
        { title: 'Too late', rule: { repeat: 'once', date: '2026-11-08', time: '09:00' } },
        'you',
        NOW,
      ),
    ).rejects.toThrow(/already passed/);

    const views = await reminderViews(db, user, NOW);
    expect(views.map((v) => [v.title, v.description, v.nextAt])).toEqual([
      ['Dentist', 'Tue, Nov 10 at 3 pm', '2026-11-10T23:00:00.000Z'],
      ['Pay rent', 'Every month on the 1st at 9 am', '2026-12-01T17:00:00.000Z'],
    ]);
    const events = await db.select().from(schema.agentEvents);
    expect(events.filter((e) => e.type === 'reminder.set')).toHaveLength(2);
  });

  it('writes enabled reminders into the agent settings file, so they become Maritime crons', async () => {
    const { db, user } = await person();
    const r = await createReminder(
      db,
      user,
      { title: 'Pay rent', rule: { repeat: 'monthly', day: 1, time: '09:00' } },
      'you',
      NOW,
    );
    const settings = JSON.parse(agentSettings(user, await activeSchedules(db, user, NOW)));
    expect(settings.reminders).toEqual([
      { id: r.id, title: 'Pay rent', rule: { repeat: 'monthly', day: 1, time: '09:00' } },
    ]);
    await updateReminder(db, user.id, r.id, { enabled: false });
    expect(await activeSchedules(db, user, NOW)).toEqual([]);
    // No reminders: the file is exactly what it was before reminders existed.
    expect(JSON.parse(agentSettings(user, []))).not.toHaveProperty('reminders');
  });

  it('sends each occurrence once, whoever gets there first', async () => {
    const { db, user } = await person();
    await registerPushToken(db, user.id, 'ExponentPushToken[phone1]', 'ios');
    const pushed: string[] = [];
    setPushFetch((async (_u: string | URL | Request, init?: RequestInit) => {
      const msgs = JSON.parse(String(init?.body)) as { body: string; title: string }[];
      pushed.push(...msgs.map((m) => `${m.title} ${m.body}`));
      return Response.json({ data: msgs.map(() => ({ status: 'ok' })) });
    }) as typeof fetch);

    const r = await createReminder(
      db,
      user,
      { title: 'Pay rent', rule: { repeat: 'monthly', day: 1, time: '09:00' } },
      'you',
      new Date('2026-11-20T00:00:00Z'),
    );
    const at = new Date('2026-12-01T17:00:00Z');
    const first = await fireReminder(db, user.id, r.id, at, 'maritime_cron', at);
    expect(first).toEqual({ delivered: true, duplicate: false, finished: false });
    expect(await fireReminder(db, user.id, r.id, at, 'heartbeat', at)).toMatchObject({
      duplicate: true,
    });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain('Pay rent');
    // The heartbeat right after finds nothing left to do.
    expect(await catchUpReminders(db, user, new Date('2026-12-01T17:20:00Z'))).toEqual({
      sent: 0,
      finished: false,
    });
    const [row] = await db.select().from(schema.reminders).where(eq(schema.reminders.id, r.id));
    expect(row?.lastFiredBy).toBe('maritime_cron');
  });

  it('heartbeat catch-up covers a missed cron after a grace period, never hours late', async () => {
    const { db, user } = await person();
    const r = await createReminder(
      db,
      user,
      { title: 'Dentist', rule: { repeat: 'once', date: '2026-11-10', time: '15:00' } },
      'you',
      NOW,
    );
    // 2 minutes after: leave it to the platform cron.
    expect((await catchUpReminders(db, user, new Date('2026-11-10T23:02:00Z'))).sent).toBe(0);
    // 15 minutes after, still not sent: the heartbeat sends it, and the one-off is finished.
    expect(await catchUpReminders(db, user, new Date('2026-11-10T23:15:00Z'))).toEqual({
      sent: 1,
      finished: true,
    });
    const events = await db.select().from(schema.agentEvents);
    expect(events.find((e) => e.type === 'reminder.fired')?.payloadJson).toMatchObject({
      firedBy: 'heartbeat',
      reminderId: r.id,
    });
    // Gone from the agent's schedules once it has gone off.
    expect(await activeSchedules(db, user, new Date('2026-11-10T23:15:00Z'))).toEqual([]);

    const daily = await createReminder(
      db,
      user,
      { title: 'Vitamins', rule: { repeat: 'daily', time: '08:00' } },
      'you',
      NOW,
    );
    // Eight hours after 08:00 is too late to be useful.
    expect((await catchUpReminders(db, user, new Date('2026-11-12T00:00:00Z'))).sent).toBe(0);
    expect(daily.id).toBeTruthy();
  });
});
