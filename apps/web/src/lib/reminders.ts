import {
  MAX_REMINDERS,
  REMINDER_TITLE_MAX,
  ReminderRule,
  describeRule,
  nextOccurrence,
  previousOccurrence,
  type ReminderSchedule,
} from '@helm/shared';
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@/db';
import type { Reminder, User } from '@/db/schema';
import { recordHelmEvent } from './submissions';
import { sendToUser } from './telegram';

/**
 * Personal reminders. Helm keeps the list; the person's agent publishes each enabled one as its
 * own Maritime cron (GET /schedules), and Maritime wakes the agent at that local time. The
 * agent's heartbeat is the safety net for a wake the platform missed.
 */
export class ReminderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const ReminderInput = z.object({
  title: z.string().trim().min(1, 'Say what to remind you about').max(REMINDER_TITLE_MAX),
  rule: ReminderRule,
});
export type ReminderInput = z.infer<typeof ReminderInput>;

export interface ReminderView {
  id: string;
  title: string;
  rule: ReminderRule;
  description: string;
  /** Next time it goes off; null for a one-off that already went off. */
  nextAt: string | null;
  enabled: boolean;
  createdVia: string;
  lastFiredAt: string | null;
  lastFiredBy: string | null;
}

export function reminderView(r: Reminder, tz: string, now = new Date()): ReminderView {
  return {
    id: r.id,
    title: r.title,
    rule: r.ruleJson,
    description: describeRule(r.ruleJson),
    nextAt: nextOccurrence(r.ruleJson, tz, now)?.toISOString() ?? null,
    enabled: r.enabled,
    createdVia: r.createdVia,
    lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
    lastFiredBy: r.lastFiredBy,
  };
}

export async function listReminders(db: Db, userId: string): Promise<Reminder[]> {
  return db
    .select()
    .from(schema.reminders)
    .where(eq(schema.reminders.userId, userId))
    .orderBy(asc(schema.reminders.createdAt));
}

/** Upcoming first, then paused, then one-offs that already went off. */
export async function reminderViews(db: Db, user: User, now = new Date()): Promise<ReminderView[]> {
  const rank = (v: ReminderView) => (!v.nextAt ? 2 : v.enabled ? 0 : 1);
  return (await listReminders(db, user.id))
    .map((r) => reminderView(r, user.timezone, now))
    .sort((a, b) => rank(a) - rank(b) || (a.nextAt ?? '').localeCompare(b.nextAt ?? ''));
}

export async function createReminder(
  db: Db,
  user: User,
  input: ReminderInput,
  via: 'you' | 'chat',
  now = new Date(),
): Promise<Reminder> {
  const parsed = ReminderInput.safeParse(input);
  if (!parsed.success) throw new ReminderError(400, parsed.error.issues[0]?.message ?? 'Invalid');
  const { title, rule } = parsed.data;
  if (!nextOccurrence(rule, user.timezone, now))
    throw new ReminderError(400, 'That time has already passed. Pick a time in the future.');
  const active = (await listReminders(db, user.id)).filter(
    (r) => r.enabled && nextOccurrence(r.ruleJson, user.timezone, now),
  );
  if (active.length >= MAX_REMINDERS)
    throw new ReminderError(
      400,
      `You can have up to ${MAX_REMINDERS} reminders. Remove one first.`,
    );
  const [row] = await db
    .insert(schema.reminders)
    .values({ userId: user.id, title, ruleJson: rule, createdVia: via })
    .returning();
  await recordHelmEvent(
    db,
    user.id,
    'reminder.set',
    `Set a reminder: ${title} (${describeRule(rule)})`,
    { reminderId: row!.id, via },
  );
  return row!;
}

export async function updateReminder(
  db: Db,
  userId: string,
  id: string,
  patch: { enabled: boolean },
): Promise<Reminder | null> {
  const [row] = await db
    .update(schema.reminders)
    .set({ enabled: patch.enabled })
    .where(and(eq(schema.reminders.id, id), eq(schema.reminders.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteReminder(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.reminders)
    .where(and(eq(schema.reminders.id, id), eq(schema.reminders.userId, userId)))
    .returning({ id: schema.reminders.id });
  return rows.length > 0;
}

/** What goes into the agent's settings file: enabled reminders that will still go off. */
export async function activeSchedules(
  db: Db,
  user: User,
  now = new Date(),
): Promise<ReminderSchedule[]> {
  return (await listReminders(db, user.id))
    .filter((r) => r.enabled && nextOccurrence(r.ruleJson, user.timezone, now))
    .map((r) => ({ id: r.id, title: r.title, rule: r.ruleJson }));
}

const appLink = (path: string) =>
  process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL.replace(/\/+$/, '')}${path}` : null;

export interface FireResult {
  delivered: boolean;
  duplicate: boolean;
  /** A one-off that has now gone off: its schedule should leave the agent's settings. */
  finished: boolean;
}

/**
 * Send one occurrence to the person's phone. Idempotent per occurrence, so the Maritime cron and
 * the heartbeat catch-up can both try without a double reminder.
 */
export async function fireReminder(
  db: Db,
  userId: string,
  reminderId: string,
  occurrenceAt: Date,
  by: 'maritime_cron' | 'heartbeat',
  now = new Date(),
): Promise<FireResult | null> {
  const [claimed] = await db
    .update(schema.reminders)
    .set({ lastOccurrenceAt: occurrenceAt, lastFiredAt: now, lastFiredBy: by })
    .where(
      and(
        eq(schema.reminders.id, reminderId),
        eq(schema.reminders.userId, userId),
        eq(schema.reminders.enabled, true),
        or(
          isNull(schema.reminders.lastOccurrenceAt),
          lt(schema.reminders.lastOccurrenceAt, occurrenceAt),
        ),
      ),
    )
    .returning();
  if (!claimed) {
    const [exists] = await db
      .select({ id: schema.reminders.id })
      .from(schema.reminders)
      .where(and(eq(schema.reminders.id, reminderId), eq(schema.reminders.userId, userId)));
    return exists ? { delivered: false, duplicate: true, finished: false } : null;
  }
  const link = appLink('/reminders');
  const delivered = await sendToUser(
    db,
    userId,
    `⏰ Reminder: ${claimed.title}`,
    link ? [[{ text: 'Open Helm', url: link }]] : [],
  ).catch(() => false);
  if (by === 'heartbeat')
    await recordHelmEvent(
      db,
      userId,
      'reminder.fired',
      `Reminded you: ${claimed.title}`,
      { reminderId, occurrenceAt: occurrenceAt.toISOString(), firedBy: by, delivered },
      `helm:reminder:${reminderId}@${occurrenceAt.toISOString()}`,
    );
  return { delivered, duplicate: false, finished: claimed.ruleJson.repeat === 'once' };
}

/** Leave the platform cron a few minutes before covering for it. */
const GRACE_MS = 5 * 60_000;
/** Too late to be useful past this; skip rather than remind hours later. */
const LATE_MS = 6 * 3_600_000;

/** Heartbeat safety net: send any occurrence the platform cron did not deliver. */
export async function catchUpReminders(db: Db, user: User, now = new Date()) {
  let sent = 0;
  let finished = false;
  for (const r of await listReminders(db, user.id)) {
    if (!r.enabled) continue;
    const prev = previousOccurrence(r.ruleJson, user.timezone, now);
    if (!prev) continue;
    const age = now.getTime() - prev.getTime();
    if (age < GRACE_MS || age > LATE_MS) continue;
    if (r.lastOccurrenceAt && r.lastOccurrenceAt.getTime() >= prev.getTime()) continue;
    // Never remind about something created after the moment it was for.
    if (r.createdAt.getTime() > prev.getTime()) continue;
    const res = await fireReminder(db, user.id, r.id, prev, 'heartbeat', now);
    if (res && !res.duplicate) {
      sent++;
      finished ||= res.finished;
    }
  }
  return { sent, finished };
}
