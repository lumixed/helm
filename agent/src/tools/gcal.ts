import type { ScheduleItem } from '@helm/shared';
import { GmailError } from './gmail';

/**
 * Google Calendar, read-only (calendar.readonly), from inside the person's agent with the same
 * Google key as Gmail (encrypted env on this VM only). Used for "Your calendar today" in the brief.
 */
type Fetch = typeof fetch;
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface GEvent {
  summary?: string;
  status?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

export async function listEvents(
  token: string,
  timeMin: string,
  timeMax: string,
  f: Fetch = fetch,
): Promise<ScheduleItem[]> {
  const q = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '25',
  });
  const res = await f(`${CAL}?${q}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new GmailError('auth');
  if (!res.ok) throw new GmailError('api');
  const items = ((await res.json()) as { items?: GEvent[] }).items ?? [];
  return items
    .filter((e) => e.status !== 'cancelled')
    .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === 'declined'))
    .map((e) => {
      const allDay = !e.start?.dateTime;
      return {
        title: (e.summary ?? '(no title)').slice(0, 200),
        start: e.start?.dateTime ?? `${e.start?.date}T00:00:00Z`,
        end: e.end?.dateTime ?? null,
        allDay,
        ...(e.location ? { location: e.location.slice(0, 200) } : {}),
      };
    })
    .slice(0, 30);
}
