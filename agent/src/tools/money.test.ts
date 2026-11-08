import { describe, expect, it } from 'vitest';
import type { AgentState } from '@helm/shared';
import { buildBrief } from './brief';

describe('money line in the brief', () => {
  it('totals bills due within a week (with amounts), ignoring later ones', async () => {
    const now = new Date('2026-11-10T15:00:00Z');
    const bill = (title: string, dueAt: string, amountCents: number | null) => ({
      id: title,
      courseCode: 'Money',
      title,
      dueAt,
      weightPct: null,
      estMinutes: 0,
      progressPct: 0,
      status: 'todo' as const,
      type: 'bill',
      amountCents,
      currency: 'CAD',
    });
    const state: AgentState = {
      studentId: 's1',
      name: 'Maya',
      timezone: 'America/Vancouver',
      briefTimeLocal: '07:30',
      assignments: [
        bill('Rent', '2026-11-15T07:59:00Z', 120000),
        bill('Phone', '2026-11-12T07:59:00Z', 4500),
        bill('Insurance', '2026-12-20T07:59:00Z', 9000),
        bill('Unknown', '2026-11-13T07:59:00Z', null),
      ],
      changes: [],
    };
    const b = await buildBrief(state, now, 'cron');
    expect(b.money).toEqual({
      totalCents: 124500,
      currency: 'CAD',
      items: [
        { title: 'Phone', amountCents: 4500, dueAt: '2026-11-12T07:59:00Z' },
        { title: 'Rent', amountCents: 120000, dueAt: '2026-11-15T07:59:00Z' },
      ],
    });
  });
});

describe('time-blocks skip long-overdue items', () => {
  it('lists an item overdue by weeks but gives it no work block', async () => {
    const state: AgentState = {
      studentId: 's1',
      name: '',
      timezone: 'America/Vancouver',
      briefTimeLocal: '07:30',
      assignments: [
        {
          id: 'old',
          courseCode: 'X',
          title: 'Midterm',
          dueAt: '2026-10-14T17:00:00Z',
          weightPct: 20,
          estMinutes: 180,
          progressPct: 0,
          status: 'todo',
        },
        {
          id: 'new',
          courseCode: 'X',
          title: 'Lab',
          dueAt: '2026-11-11T06:59:00Z',
          weightPct: 10,
          estMinutes: 60,
          progressPct: 0,
          status: 'todo',
        },
      ],
      changes: [],
    };
    const b = await buildBrief(state, new Date('2026-11-10T15:00:00Z'), 'cron');
    expect(b.focus.map((f) => f.title)).toContain('Midterm');
    expect(b.blocks.map((x) => x.title)).toEqual(['Lab']);
  });
});
