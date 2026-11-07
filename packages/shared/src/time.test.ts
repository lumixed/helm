import { describe, expect, it } from 'vitest';
import { localToUtc, tzOffsetMinutes, utcToLocal } from './time';

// Los Angeles still observes DST. (B.C. moved to permanent UTC-7 in tzdata 2026, so Vancouver
// is deliberately not used here: results would depend on the runtime's tz data version.)
const V = 'America/Los_Angeles';

describe('localToUtc', () => {
  it('handles standard time (PST, UTC-8)', () => {
    expect(localToUtc('2026-11-14T17:00', V).toISOString()).toBe('2026-11-15T01:00:00.000Z');
  });
  it('handles daylight time (PDT, UTC-7)', () => {
    expect(localToUtc('2026-10-14T17:00', V).toISOString()).toBe('2026-10-15T00:00:00.000Z');
  });
  it('handles the fall-back day (Nov 1 2026): repeated hour picks the first', () => {
    expect(localToUtc('2026-11-01T01:30', V).toISOString()).toBe('2026-11-01T08:30:00.000Z');
    expect(localToUtc('2026-11-01T23:59', V).toISOString()).toBe('2026-11-02T07:59:00.000Z');
  });
  it('handles the spring-forward gap (Mar 8 2026, 02:30 does not exist)', () => {
    expect(localToUtc('2026-03-08T02:30', V).toISOString()).toBe('2026-03-08T10:30:00.000Z');
  });
  it('works east of UTC and with half-hour zones', () => {
    expect(localToUtc('2026-11-14T09:00', 'Asia/Jakarta').toISOString()).toBe(
      '2026-11-14T02:00:00.000Z',
    );
    expect(localToUtc('2026-11-14T09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-14T03:30:00.000Z',
    );
  });
  it('rejects malformed or impossible dates', () => {
    expect(() => localToUtc('2026-11-14 17:00', V)).toThrow();
    expect(() => localToUtc('2026-02-30T10:00', V)).toThrow();
  });
});

describe('utcToLocal / tzOffsetMinutes', () => {
  it('round-trips', () => {
    const at = localToUtc('2026-12-03T23:59', V);
    expect(utcToLocal(at, V)).toBe('2026-12-03T23:59');
    expect(tzOffsetMinutes(V, at)).toBe(-480);
  });
});
