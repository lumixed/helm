/**
 * Timezone math lives in code, not in the LLM (PRD section 20: "Backend owns tz math").
 * The model returns local wall-clock times; these helpers turn them into exact instants.
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Offset of `tz` from UTC at instant `at`, in minutes (e.g. -480 for PST). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * "2026-11-14T17:00" in "America/Vancouver" → the exact instant. For a time that falls in a DST
 * gap (clocks jump forward), the result moves forward like a wall clock would. For a repeated
 * hour (clocks fall back) it picks the first occurrence.
 */
export function localToUtc(local: string, tz: string): Date {
  const m = LOCAL_RE.exec(local);
  if (!m) throw new Error(`Expected YYYY-MM-DDTHH:mm, got "${local}"`);
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(wall) || new Date(wall).getUTCDate() !== d)
    throw new Error(`Invalid date "${local}"`);
  // Try the offsets in force around that wall time; keep the first that maps back exactly.
  const candidates = [
    tzOffsetMinutes(tz, new Date(wall - 12 * 3_600_000)),
    tzOffsetMinutes(tz, new Date(wall + 12 * 3_600_000)),
  ];
  for (const off of candidates.sort((a, b) => b - a)) {
    const instant = new Date(wall - off * 60_000);
    if (tzOffsetMinutes(tz, instant) === off) return instant;
  }
  // DST gap: the wall time doesn't exist. Use the offset from before the jump (the smaller one,
  // e.g. PST), which lands just after the jump: 02:30 becomes 03:30 PDT.
  return new Date(wall - Math.min(...candidates) * 60_000);
}

/** The instant shown as local wall time in `tz`: "2026-11-14T17:00". */
export function utcToLocal(at: Date, tz: string): string {
  const shifted = new Date(at.getTime() + tzOffsetMinutes(tz, at) * 60_000);
  return shifted.toISOString().slice(0, 16);
}
