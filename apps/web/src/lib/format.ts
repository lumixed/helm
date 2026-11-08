/**
 * Dates are formatted on the SERVER, with the same tz database that converted them. Browsers can
 * ship older tz data (e.g. B.C.'s 2026 move to permanent UTC-7), which would show times an hour off.
 */
export function formatWhen(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatTime(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

/** "10:00 a.m." in the person's timezone, or "All day". */
export function eventTime(e: { allDay: boolean; start: string }, tz: string): string {
  return e.allDay
    ? 'All day'
    : new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(
        new Date(e.start),
      );
}
