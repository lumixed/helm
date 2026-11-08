import { describe, expect, it } from 'vitest';
import type { AgentState } from './brief';
import { eveningText, weeklyCron, weeklyText } from './routines';

const state = (items: [string, string, number | null][]): AgentState => ({
  studentId: 's1',
  name: 'Maya',
  timezone: 'America/Vancouver',
  briefTimeLocal: '07:30',
  assignments: items.map(([title, dueAt, weightPct], i) => ({
    id: `a${i}`,
    courseCode: i % 2 ? 'Work' : 'DATA 210',
    title,
    dueAt,
    weightPct,
    estMinutes: null,
    progressPct: 0,
    status: 'todo' as const,
  })),
  changes: [],
});
const now = new Date('2026-11-10T05:00:00Z'); // Mon Nov 9, 10 pm local

describe('routines', () => {
  it('weekly cron is minute hour * * weekday', () => {
    expect(weeklyCron(0, '18:30')).toBe('30 18 * * 0');
  });

  it('evening check-in lists tomorrow and past-due items', () => {
    const t = eveningText(
      state([
        ['Lab report', '2026-11-11T06:59:00Z', 10], // Tue Nov 10 23:59 local = tomorrow
        ['Old thing', '2026-11-08T06:59:00Z', 5],
      ]),
      now,
    );
    expect(t).toMatch(/^Evening check-in, Maya\./);
    expect(t).toMatch(/Due tomorrow: DATA 210 · Lab report \(11:59 p\.m\.\)/);
    expect(t).toMatch(/Past due and still open: Work · Old thing/);
  });

  it('evening check-in says so when nothing is due', () => {
    expect(eveningText(state([]), now)).toMatch(/Nothing is due tomorrow/);
  });

  it('weekly review groups the next 7 days by day and calls out big items', () => {
    const t = weeklyText(
      state([
        ['Midterm', '2026-11-12T17:00:00Z', 25],
        ['Pay rent', '2026-11-15T17:00:00Z', null],
        ['Far away', '2026-12-01T17:00:00Z', 5],
      ]),
      now,
    );
    expect(t).toMatch(/Thu, Nov 12: DATA 210 · Midterm 10:00 a\.m\./);
    expect(t).toMatch(/Sun, Nov 15: Work · Pay rent/);
    expect(t).not.toMatch(/Far away/);
    expect(t).toMatch(/Biggest: DATA 210 · Midterm/);
  });
});
