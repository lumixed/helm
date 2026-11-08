import { z } from 'zod';
import { localToUtc, utcToLocal } from './time';

/**
 * Time-blocking (PRD v3): code, not the LLM, decides when to work on what today. Free time is the
 * work window minus calendar events (with a buffer) minus time already past; the day's focus items
 * are placed in priority order, in blocks of at most 90 minutes with breaks between them.
 */
export const WorkBlock = z.object({
  assignmentId: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
});
export type WorkBlock = z.infer<typeof WorkBlock>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** When the person wants work planned: a daily window and days off (0 = Sunday). */
export const WorkHours = z
  .object({
    start: z.string().regex(HHMM),
    end: z.string().regex(HHMM),
    offDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  })
  .refine((w) => w.start < w.end, 'The end must be after the start');
export type WorkHours = z.infer<typeof WorkHours>;
export const DEFAULT_WORK_HOURS: WorkHours = { start: '09:00', end: '21:00', offDays: [] };

/** True when `now` falls on one of the person's days off (in their timezone). */
export function isDayOff(now: Date, tz: string, hours: WorkHours): boolean {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  return hours.offDays.includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd));
}

export interface PlanItem {
  id: string;
  title: string;
  /** Suggested minutes today. */
  minutes: number;
}
export interface BusyEvent {
  start: string;
  end: string | null;
  allDay: boolean;
}

export const PLAN_RULES = {
  maxBlockMin: 90,
  minBlockMin: 25,
  breakMin: 10,
  bufferMin: 10,
  /** An event with no end time is treated as an hour long. */
  defaultEventMin: 60,
} as const;

const MIN = 60_000;

export function planDay(
  items: PlanItem[],
  events: BusyEvent[],
  now: Date,
  tz: string,
  window: { start: string; end: string } = { start: '09:00', end: '21:00' },
): { blocks: WorkBlock[]; unplannedMinutes: number } {
  const day = utcToLocal(now, tz).slice(0, 10);
  const winStart = Math.max(
    localToUtc(`${day}T${window.start}`, tz).getTime(),
    roundUp(now.getTime(), 5),
  );
  const winEnd = localToUtc(`${day}T${window.end}`, tz).getTime();
  if (winEnd - winStart < PLAN_RULES.minBlockMin * MIN)
    return { blocks: [], unplannedMinutes: items.reduce((m, i) => m + i.minutes, 0) };

  // Busy intervals (timed events only), padded by the buffer, merged.
  const busy = events
    .filter((e) => !e.allDay)
    .map((e) => {
      const s = new Date(e.start).getTime();
      const end = e.end ? new Date(e.end).getTime() : s + PLAN_RULES.defaultEventMin * MIN;
      return [s - PLAN_RULES.bufferMin * MIN, end + PLAN_RULES.bufferMin * MIN] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const b of busy) {
    const last = merged.at(-1);
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([...b]);
  }
  // Free intervals inside the window.
  let free: [number, number][] = [];
  let cursor = winStart;
  for (const [s, e] of merged) {
    if (e <= cursor) continue;
    if (s >= winEnd) break;
    if (s > cursor) free.push([cursor, Math.min(s, winEnd)]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < winEnd) free.push([cursor, winEnd]);
  free = free.filter(([s, e]) => e - s >= PLAN_RULES.minBlockMin * MIN);

  const blocks: WorkBlock[] = [];
  let unplanned = 0;
  for (const item of items) {
    let left = item.minutes;
    while (left >= PLAN_RULES.minBlockMin && free.length) {
      const [s, e] = free[0]!;
      const len = Math.min(left, PLAN_RULES.maxBlockMin, Math.floor((e - s) / MIN));
      if (len < PLAN_RULES.minBlockMin) {
        free.shift();
        continue;
      }
      blocks.push({
        assignmentId: item.id,
        title: item.title,
        start: new Date(s).toISOString(),
        end: new Date(s + len * MIN).toISOString(),
      });
      left -= len;
      const next = s + (len + PLAN_RULES.breakMin) * MIN;
      if (e - next >= PLAN_RULES.minBlockMin * MIN) free[0] = [next, e];
      else free.shift();
    }
    // Leftover under one block is not worth a slot today; count it as unplanned.
    unplanned += Math.max(0, left);
  }
  return { blocks, unplannedMinutes: unplanned };
}

function roundUp(ms: number, toMin: number) {
  const step = toMin * MIN;
  return Math.ceil(ms / step) * step;
}
