import { describe, expect, it } from 'vitest';
import { formatDuration, rankAssignments, scoreAssignment, type RankInput } from './ranking';

const now = new Date('2026-11-09T16:00:00Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
const a = (o: Partial<RankInput> & { id: string }): RankInput => ({
  title: o.id,
  dueAt: inHours(72),
  weightPct: 10,
  estMinutes: 120,
  progressPct: 0,
  status: 'todo',
  ...o,
});

describe('rankAssignments', () => {
  it('puts overdue items first, even over heavier upcoming work', () => {
    const r = rankAssignments(
      [
        a({ id: 'big-soon', dueAt: inHours(2), weightPct: 40, estMinutes: 600 }),
        a({ id: 'late', dueAt: inHours(-3), weightPct: 1 }),
      ],
      now,
    );
    expect(r.map((x) => x.item.id)).toEqual(['late', 'big-soon']);
    expect(r[0]?.why).toMatch(/^Overdue/);
  });

  it('near-deadline high-weight beats far-deadline low-weight', () => {
    const r = rankAssignments(
      [
        a({ id: 'far-light', dueAt: inHours(24 * 9), weightPct: 5 }),
        a({ id: 'near-heavy', dueAt: inHours(20), weightPct: 30 }),
      ],
      now,
    );
    expect(r.map((x) => x.item.id)).toEqual(['near-heavy', 'far-light']);
  });

  it('breaks ties by earlier due date, then id', () => {
    // Identical scores: both clamp to max weight and zero remaining effort.
    const same = { weightPct: 50, estMinutes: 60, progressPct: 100 };
    const r = rankAssignments(
      [a({ id: 'b', dueAt: inHours(10), ...same }), a({ id: 'a', dueAt: inHours(10), ...same })],
      now,
    );
    expect(r.map((x) => x.item.id)).toEqual(['a', 'b']);
  });

  it('skips done, submitted and undated items', () => {
    const r = rankAssignments(
      [
        a({ id: 'done', status: 'done' }),
        a({ id: 'sub', status: 'submitted' }),
        a({ id: 'nodate', dueAt: null }),
        a({ id: 'open' }),
      ],
      now,
    );
    expect(r.map((x) => x.item.id)).toEqual(['open']);
  });

  it('is deterministic: same inputs, same order', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      a({
        id: `x${i}`,
        dueAt: inHours((i * 7) % 50),
        weightPct: (i * 13) % 35,
        estMinutes: 30 + ((i * 17) % 300),
      }),
    );
    const first = rankAssignments(items, now).map((x) => x.item.id);
    const second = rankAssignments([...items].reverse(), now).map((x) => x.item.id);
    expect(second).toEqual(first);
  });

  it('more progress lowers effort pressure', () => {
    const fresh = scoreAssignment(a({ id: 'f', dueAt: inHours(24), estMinutes: 240 }), now)!;
    const half = scoreAssignment(
      a({ id: 'h', dueAt: inHours(24), estMinutes: 240, progressPct: 50 }),
      now,
    )!;
    expect(half.score).toBeLessThan(fresh.score);
    expect(half.remainingMinutes).toBe(120);
  });

  it('matches the PRD formula for a known case', () => {
    // 24h left, 15% weight, 3h of 6h done -> urgency 0.5, weightN 0.5, effort 3/(24*.25)=0.5
    const r = scoreAssignment(
      a({ id: 'k', dueAt: inHours(24), weightPct: 15, estMinutes: 360, progressPct: 50 }),
      now,
    )!;
    expect(r.score).toBeCloseTo(0.5 * 0.5 + 0.3 * 0.5 + 0.2 * 0.5, 10);
  });
});

describe('why text', () => {
  it('explains in plain language', () => {
    const r = scoreAssignment(
      a({ id: 'w', dueAt: inHours(5), weightPct: 20, estMinutes: 300 }),
      now,
    )!;
    expect(r.why).toBe('Due in 5h, worth 20%, about 5h of work left, tight for the time left');
  });
});

describe('formatDuration', () => {
  it('formats minutes', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(150)).toBe('2h 30m');
  });
});
