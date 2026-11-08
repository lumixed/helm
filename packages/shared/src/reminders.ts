import { z } from 'zod';
import { localToUtc, utcToLocal } from './time';

/**
 * Personal reminders ("pay rent on the 1st", "dentist Tuesday 3 pm"). Each one becomes its own
 * Maritime platform-cron schedule on the person's agent (GET /schedules), so Maritime wakes the
 * agent at the right local time even when every app is closed.
 */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ReminderRule = z.discriminatedUnion('repeat', [
  z.object({
    repeat: z.literal('once'),
    date: z.string().regex(DATE),
    time: z.string().regex(HHMM),
  }),
  z.object({ repeat: z.literal('daily'), time: z.string().regex(HHMM) }),
  /** 0 = Sunday … 6 = Saturday (cron numbering). */
  z.object({
    repeat: z.literal('weekly'),
    weekday: z.number().int().min(0).max(6),
    time: z.string().regex(HHMM),
  }),
  /** 29–31 fall on the last day in shorter months. */
  z.object({
    repeat: z.literal('monthly'),
    day: z.number().int().min(1).max(31),
    time: z.string().regex(HHMM),
  }),
]);
export type ReminderRule = z.infer<typeof ReminderRule>;

export const REMINDER_TITLE_MAX = 120;
export const MAX_REMINDERS = 30;

/** One reminder as it sits in the agent's settings file. */
export const ReminderSchedule = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(REMINDER_TITLE_MAX),
  rule: ReminderRule,
});
export type ReminderSchedule = z.infer<typeof ReminderSchedule>;

const hm = (time: string) => time.split(':').map(Number) as [number, number];

/** The 5-field cron Maritime evaluates in the person's timezone. */
export function reminderCron(rule: ReminderRule): string {
  const [h, m] = hm(rule.time);
  switch (rule.repeat) {
    case 'once': {
      const [, mo, d] = rule.date.split('-').map(Number);
      // Repeats yearly in cron terms; the agent only acts on the real date and Helm removes the
      // schedule once it has fired.
      return `${m} ${h} ${d} ${mo} *`;
    }
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekly':
      return `${m} ${h} * * ${rule.weekday}`;
    case 'monthly':
      // "28-31" wakes on each of the last days; occursOn() keeps only the right one.
      return rule.day <= 28 ? `${m} ${h} ${rule.day} * *` : `${m} ${h} 28-31 * *`;
  }
}

const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** Does the reminder fall on this local calendar date (YYYY-MM-DD)? */
export function occursOn(rule: ReminderRule, date: string): boolean {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  switch (rule.repeat) {
    case 'once':
      return rule.date === date;
    case 'daily':
      return true;
    case 'weekly':
      return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === rule.weekday;
    case 'monthly':
      return d === Math.min(rule.day, daysInMonth(y, mo));
  }
}

const DAY = 86_400_000;
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

function instantOn(rule: ReminderRule, date: string, tz: string): Date {
  return localToUtc(`${date}T${rule.time}`, tz);
}

/** The first occurrence strictly after `after`, or null (a one-off already past). */
export function nextOccurrence(rule: ReminderRule, tz: string, after: Date): Date | null {
  if (rule.repeat === 'once') {
    const at = instantOn(rule, rule.date, tz);
    return at.getTime() > after.getTime() ? at : null;
  }
  const today = utcToLocal(after, tz).slice(0, 10);
  for (let i = -1; i <= 62; i++) {
    const date = shiftDate(today, i);
    if (!occursOn(rule, date)) continue;
    const at = instantOn(rule, date, tz);
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}

/** The latest occurrence at or before `atOrBefore`, or null. */
export function previousOccurrence(rule: ReminderRule, tz: string, atOrBefore: Date): Date | null {
  if (rule.repeat === 'once') {
    const at = instantOn(rule, rule.date, tz);
    return at.getTime() <= atOrBefore.getTime() ? at : null;
  }
  const today = utcToLocal(atOrBefore, tz).slice(0, 10);
  for (let i = 1; i >= -62; i--) {
    const date = shiftDate(today, i);
    if (!occursOn(rule, date)) continue;
    const at = instantOn(rule, date, tz);
    if (at.getTime() <= atOrBefore.getTime()) return at;
  }
  return null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ordinal = (n: number) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

function clock(time: string): string {
  const [h, m] = hm(time);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "Every month on the 1st at 9 am", "Tue, Nov 10 at 3:30 pm". */
export function describeRule(rule: ReminderRule): string {
  const at = clock(rule.time);
  switch (rule.repeat) {
    case 'once': {
      const d = new Date(`${rule.date}T12:00:00Z`);
      const label = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(d);
      return `${label} at ${at}`;
    }
    case 'daily':
      return `Every day at ${at}`;
    case 'weekly':
      return `Every ${WEEKDAYS[rule.weekday]} at ${at}`;
    case 'monthly':
      return `Every month on the ${ordinal(rule.day)} at ${at}${rule.day > 28 ? ' (or the last day)' : ''}`;
  }
}
