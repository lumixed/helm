import type { ScheduleItem } from '@helm/shared';
import { GmailError } from './gmail';

/**
 * Google Calendar, from inside the person's agent with the same Google key as Gmail (encrypted env
 * on this VM only). Read for "Your day" in the brief; written only when the person taps "Add to
 * Google Calendar" for that day's work blocks (calendar.events).
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
  extendedProperties?: { private?: Record<string, string> };
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
  return (
    items
      .filter((e) => e.status !== 'cancelled')
      .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === 'declined'))
      // Helm's own work blocks are already in the plan; counting them as busy would plan twice.
      .filter((e) => e.extendedProperties?.private?.helm !== 'block')
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
      .slice(0, 30)
  );
}

export interface BlockEvent {
  assignmentId: string;
  title: string;
  start: string;
  end: string;
}

/**
 * A fixed Google event id per block (hex is valid base32hex), so adding the same plan twice is a
 * no-op: Google answers 409 for an id that already exists.
 */
export async function blockEventId(b: BlockEvent): Promise<string> {
  const data = new TextEncoder().encode(`helm:${b.assignmentId}:${b.start}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return `helm${Buffer.from(hash).toString('hex').slice(0, 40)}`;
}

/** Insert work blocks. Returns how many were new and how many were already there. */
export async function addBlocks(
  token: string,
  blocks: BlockEvent[],
  appUrl: string | null,
  f: Fetch = fetch,
): Promise<{ added: number; existing: number }> {
  let added = 0;
  let existing = 0;
  for (const b of blocks) {
    const res = await f(CAL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: await blockEventId(b),
        summary: `Focus: ${b.title}`.slice(0, 250),
        description: `Planned by Helm around your calendar.${appUrl ? ` ${appUrl}/today` : ''}`,
        start: { dateTime: b.start },
        end: { dateTime: b.end },
        transparency: 'opaque',
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
        extendedProperties: { private: { helm: 'block', assignmentId: b.assignmentId } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 409) existing++;
    else if (res.status === 401 || res.status === 403) throw new GmailError('auth');
    else if (!res.ok) throw new GmailError('api');
    else added++;
  }
  return { added, existing };
}
