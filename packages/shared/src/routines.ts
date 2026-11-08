import { z } from 'zod';
import type { AgentState } from './brief';
import { dailyCron } from './schedules';
import { utcToLocal } from './time';

/**
 * Routines (PRD v3): an evening check-in and a weekly review, each its own Maritime platform cron
 * on the person's agent, in their timezone. The text is written by code from the plan, not by the
 * LLM, so it is fast, free and predictable.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const Routines = z.object({
  /** Evening check-in time, local "HH:MM". */
  evening: z.string().regex(HHMM).optional(),
  /** Weekly review: day (0 = Sunday) and local time. */
  weekly: z
    .object({ weekday: z.number().int().min(0).max(6), time: z.string().regex(HHMM) })
    .optional(),
});
export type Routines = z.infer<typeof Routines>;
export const ROUTINE_KINDS = ['evening', 'weekly'] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];

export function weeklyCron(weekday: number, time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${m} ${h} * * ${weekday}`;
}
export { dailyCron as eveningCron };

/** Agent → backend: send this routine's text to the person's phone. */
export const RoutineSentRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  routine: z.enum(ROUTINE_KINDS),
  text: z.string().min(1).max(2000),
});
export type RoutineSentRequest = z.infer<typeof RoutineSentRequest>;

const fmt = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opts }).format(new Date(iso));
const localDay = (d: Date | string, tz: string) => utcToLocal(new Date(d), tz).slice(0, 10);
const label = (a: AgentState['assignments'][number]) =>
  `${a.courseCode ? `${a.courseCode} · ` : ''}${a.title}`;

/** "Tomorrow: … Still open: … Overdue: …" for tonight. */
export function eveningText(state: AgentState, now: Date): string {
  const tz = state.timezone;
  const today = localDay(now, tz);
  const tomorrow = localDay(new Date(now.getTime() + 86_400_000), tz);
  const open = state.assignments.filter((a) => a.dueAt);
  const overdue = open.filter((a) => new Date(a.dueAt!).getTime() < now.getTime());
  const dueTomorrow = open.filter((a) => localDay(a.dueAt!, tz) === tomorrow);
  const laterToday = open.filter(
    (a) => localDay(a.dueAt!, tz) === today && new Date(a.dueAt!) > now,
  );
  const lines = [`Evening check-in${state.name ? `, ${state.name}` : ''}.`];
  if (laterToday.length)
    lines.push(
      `Still due tonight: ${laterToday.map((a) => `${label(a)} (${fmt(a.dueAt!, tz, { hour: 'numeric', minute: '2-digit' })})`).join('; ')}.`,
    );
  if (dueTomorrow.length)
    lines.push(
      `Due tomorrow: ${dueTomorrow.map((a) => `${label(a)} (${fmt(a.dueAt!, tz, { hour: 'numeric', minute: '2-digit' })})`).join('; ')}.`,
    );
  if (overdue.length)
    lines.push(
      `Past due and still open: ${overdue.slice(0, 5).map(label).join('; ')}. Mark them done in Helm if they are.`,
    );
  if (lines.length === 1) lines.push('Nothing is due tomorrow. Rest well.');
  else lines.push('If something should move, open Helm; your brief arrives in the morning.');
  return lines.join('\n');
}

/** The week ahead, day by day. */
export function weeklyText(state: AgentState, now: Date): string {
  const tz = state.timezone;
  const end = now.getTime() + 7 * 86_400_000;
  const week = state.assignments
    .filter(
      (a) =>
        a.dueAt &&
        new Date(a.dueAt).getTime() >= now.getTime() &&
        new Date(a.dueAt).getTime() < end,
    )
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const overdue = state.assignments.filter(
    (a) => a.dueAt && new Date(a.dueAt).getTime() < now.getTime(),
  );
  const lines = [`Your week ahead${state.name ? `, ${state.name}` : ''}:`];
  if (week.length === 0) lines.push('Nothing due in the next 7 days.');
  const byDay = new Map<string, string[]>();
  for (const a of week) {
    const d = fmt(a.dueAt!, tz, { weekday: 'short', month: 'short', day: 'numeric' });
    byDay.set(d, [
      ...(byDay.get(d) ?? []),
      `${label(a)} ${fmt(a.dueAt!, tz, { hour: 'numeric', minute: '2-digit' })}`,
    ]);
  }
  for (const [d, items] of byDay) lines.push(`${d}: ${items.join('; ')}`);
  const heavy = week.filter((a) => (a.weightPct ?? 0) >= 15);
  if (heavy.length) lines.push(`Biggest: ${heavy.map(label).join('; ')}. Start those early.`);
  if (overdue.length)
    lines.push(`${overdue.length} past-due item${overdue.length === 1 ? '' : 's'} still open.`);
  return lines.join('\n');
}
