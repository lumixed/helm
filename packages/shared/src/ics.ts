import { z } from 'zod';
import { localToUtc, utcToLocal } from './time';

/**
 * Calendar feeds (iCalendar, RFC 5545), e.g. a Canvas "Calendar Feed" link (PRD S3). A small,
 * dependency-free reader for the parts we need: VEVENT with SUMMARY, DTSTART/DTEND, UID, URL.
 */
export interface IcsEvent {
  uid: string;
  summary: string;
  /** Exact instant (UTC ISO). For all-day events: 23:59 local on that day. */
  start: string;
  allDay: boolean;
  url?: string;
  description?: string;
}

const unescapeText = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Unfold continuation lines (a line starting with a space or tab continues the previous one). */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function parseDate(
  value: string,
  params: Record<string, string>,
  tz: string,
): { iso: string; allDay: boolean } | null {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!m) return null;
    return { iso: localToUtc(`${m[1]}-${m[2]}-${m[3]}T23:59`, tz).toISOString(), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (z)
    return { iso: new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!)).toISOString(), allDay: false };
  // Floating or TZID time: local wall clock in that zone (fall back to the person's own).
  const zone = params.TZID && isZone(params.TZID) ? params.TZID : tz;
  return { iso: localToUtc(`${y}-${mo}-${d}T${h}:${mi}`, zone).toISOString(), allDay: false };
}

function isZone(z: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

export function parseIcs(text: string, tz: string, max = 1000): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Record<string, { value: string; params: Record<string, string> }> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur?.UID && cur.SUMMARY && cur.DTSTART) {
        const when = parseDate(cur.DTSTART.value, cur.DTSTART.params, tz);
        if (when)
          out.push({
            uid: cur.UID.value.slice(0, 300),
            summary: unescapeText(cur.SUMMARY.value).trim().slice(0, 300),
            start: when.iso,
            allDay: when.allDay,
            ...(cur.URL ? { url: cur.URL.value.slice(0, 500) } : {}),
            ...(cur.DESCRIPTION
              ? { description: unescapeText(cur.DESCRIPTION.value).slice(0, 1000) }
              : {}),
          });
      }
      cur = null;
      if (out.length >= max) break;
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    const [name, ...rawParams] = line.slice(0, i).split(';');
    const params = Object.fromEntries(
      rawParams.map((p) => {
        const [k, v = ''] = p.split('=');
        return [k!.toUpperCase(), v.replace(/^"|"$/g, '')];
      }),
    );
    cur[name!.toUpperCase()] = { value: line.slice(i + 1), params };
  }
  return out;
}

/** One deadline from a calendar feed, keyed by the event's UID (stable across syncs). */
export const CalendarItem = z.object({
  uid: z.string().min(1).max(300),
  courseCode: z.string().max(40),
  title: z.string().min(1).max(300),
  dueAt: z.iso.datetime({ offset: true }),
  dueTimeAssumed: z.boolean(),
  type: z.enum(['assignment', 'quiz', 'exam', 'event']),
  url: z.string().max(500).optional(),
});
export type CalendarItem = z.infer<typeof CalendarItem>;

/**
 * Canvas feed events → deadlines. Canvas titles look like "Assignment 3 [DATA 210]" (course in
 * brackets at the end); assignment UIDs start with "event-assignment-". Past items (more than a
 * week ago) are skipped; plain calendar events are kept as type "event".
 */
export function calendarItems(events: IcsEvent[], tz: string, now: Date): CalendarItem[] {
  const cutoff = now.getTime() - 7 * 86_400_000;
  return events
    .filter((e) => new Date(e.start).getTime() >= cutoff)
    .map((e) => {
      const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(e.summary);
      const title = (m?.[1] ?? e.summary).trim() || e.summary;
      const course = (m?.[2] ?? '').trim();
      const lower = `${e.uid} ${title}`.toLowerCase();
      const type: CalendarItem['type'] = /quiz/.test(lower)
        ? 'quiz'
        : /\b(exam|midterm|final exam)\b/.test(lower)
          ? 'exam'
          : /assignment/.test(e.uid.toLowerCase()) ||
              /assignment|essay|project|report|homework|lab/.test(lower)
            ? 'assignment'
            : 'event';
      return {
        uid: e.uid,
        courseCode: course.slice(0, 40),
        title: title.slice(0, 300),
        dueAt: e.start,
        dueTimeAssumed: e.allDay,
        type,
        ...(e.url ? { url: e.url } : {}),
      };
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, 300);
}

/** Only https Canvas feed links (or the demo portal's feed) are accepted. */
export function isCalendarFeedUrl(raw: string, extraHosts: string[] = []): boolean {
  try {
    // `URL` exists in every runtime we use; this package is built without DOM/Node types.
    const Url = (
      globalThis as unknown as { URL: new (s: string) => { protocol: string; hostname: string } }
    ).URL;
    const u = new Url(raw);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1'))
      return false;
    return u.hostname.endsWith('.instructure.com') || extraHosts.includes(u.hostname);
  } catch {
    return false;
  }
}

/** Agent → backend: the deadlines found in the feed (no other calendar content). */
export const CalendarResultRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  items: z.array(CalendarItem).max(300),
  /** Events in the feed before filtering (for the timeline). */
  total: z.number().int().min(0),
});
export type CalendarResultRequest = z.infer<typeof CalendarResultRequest>;

export const CalendarResultResponse = z.object({
  added: z.number().int(),
  moved: z.number().int(),
  unchanged: z.number().int(),
});
export type CalendarResultResponse = z.infer<typeof CalendarResultResponse>;

export const describeLocal = (iso: string, tz: string) => utcToLocal(new Date(iso), tz);
