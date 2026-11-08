import { describe, expect, it } from 'vitest';
import { planDay } from './plan';

const tz = 'America/Vancouver'; // UTC-7
const at = (local: string) => new Date(`${local}:00-07:00`).toISOString();
const local = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

describe('planDay', () => {
  const morning = new Date(at('2026-11-10T07:30'));

  it('places items in priority order around calendar events, with breaks and max 90-min blocks', () => {
    const { blocks, unplannedMinutes } = planDay(
      [
        { id: 'a', title: 'Lab report', minutes: 120 },
        { id: 'b', title: 'Reading', minutes: 45 },
      ],
      [{ start: at('2026-11-10T10:00'), end: at('2026-11-10T11:00'), allDay: false }],
      morning,
      tz,
    );
    expect(blocks.map((b) => [b.title, local(b.start), local(b.end)])).toEqual([
      ['Lab report', '09:00', '09:50'], // stops 10 min before the 10:00 event
      ['Lab report', '11:10', '12:20'], // after the event + buffer: the remaining 70 min
      ['Reading', '12:30', '13:15'], // 10-min break first
    ]);
    expect(unplannedMinutes).toBe(0);
  });

  it('never plans in the past and skips all-day events', () => {
    const { blocks } = planDay(
      [{ id: 'a', title: 'Essay', minutes: 60 }],
      [{ start: at('2026-11-10T00:00'), end: null, allDay: true }],
      new Date(at('2026-11-10T14:03')),
      tz,
    );
    expect(local(blocks[0]!.start)).toBe('14:05');
  });

  it('reports what does not fit', () => {
    const { blocks, unplannedMinutes } = planDay(
      [{ id: 'a', title: 'Big project', minutes: 120 }],
      [],
      new Date(at('2026-11-10T20:00')),
      tz,
    );
    expect(blocks.map((b) => [local(b.start), local(b.end)])).toEqual([['20:00', '21:00']]);
    expect(unplannedMinutes).toBe(60);
  });

  it('plans nothing when the window is over', () => {
    expect(
      planDay([{ id: 'a', title: 'x', minutes: 30 }], [], new Date(at('2026-11-10T21:30')), tz),
    ).toEqual({
      blocks: [],
      unplannedMinutes: 30,
    });
  });
});

import { normalizeMoney } from './domain';
describe('normalizeMoney', () => {
  it('rounds to cents, upper-cases the currency, and drops nonsense', () => {
    expect(normalizeMoney(45.499, 'cad')).toEqual({ amount: 45.5, currency: 'CAD' });
    expect(normalizeMoney(1200, null)).toEqual({ amount: 1200, currency: null });
    expect(normalizeMoney(-5, 'USD')).toEqual({ amount: null, currency: null });
    expect(normalizeMoney(10, 'dollars')).toEqual({ amount: 10, currency: null });
  });
});
