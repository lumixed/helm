import { describe, expect, it } from 'vitest';
import type { AgentState } from '@helm/shared';
import { buildBrief, templateSummary } from './brief';

const now = new Date('2026-11-09T15:30:00Z');
const inH = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
const a = (
  id: string,
  h: number,
  weight: number | null = 10,
  extra: Partial<AgentState['assignments'][number]> = {},
) => ({
  id,
  courseCode: 'DATA 210',
  title: id,
  dueAt: inH(h),
  weightPct: weight,
  estMinutes: 240,
  progressPct: 0,
  status: 'todo' as const,
  ...extra,
});
const state = (assignments: AgentState['assignments']): AgentState => ({
  studentId: 's',
  name: 'Maya',
  timezone: 'America/Los_Angeles',
  briefTimeLocal: '07:30',
  assignments,
  changes: [],
});

describe('buildBrief', () => {
  it('ranks deterministically and caps suggested minutes', async () => {
    const b = await buildBrief(
      state([
        a('far', 24 * 9, 5),
        a('soon', 20, 30),
        a('mid', 48, 20),
        a('next', 60, 5),
        a('done', 5, 50, { status: 'done' }),
      ]),
      now,
      'cron',
    );
    expect(b.focus.map((f) => f.title)).toEqual(['soon', 'mid', 'next']);
    expect(b.dueSoon).toEqual([]);
    expect(b.focus[0]?.minutes).toBe(120);
    expect(b.capacity).toBe(
      'About 6h of focused work planned today. In 6 blocks, first at 9:00 a.m.',
    );
    expect(b.blocks.length).toBe(6);
    expect(b.forDate).toBe('2026-11-09');
    expect(b.writer).toBe('template');
  });

  it('lets the LLM write only the opener and falls back on failure', async () => {
    const ok = await buildBrief(state([a('x', 10)]), now, 'manual', async () => ({
      summary: 'Hello Maya, start with x.',
      writer: 'model-a',
    }));
    expect(ok).toMatchObject({ summary: 'Hello Maya, start with x.', writer: 'model-a' });
    expect(ok.focus[0]?.title).toBe('x');
    const fail = await buildBrief(state([a('x', 10)]), now, 'manual', async () => {
      throw new Error('503');
    });
    expect(fail.writer).toBe('template');
    expect(fail.summary).toMatch(/^Good morning, Maya\. Start with DATA 210 x\./);
  });

  it('plans inside work hours and nothing on a day off', async () => {
    const st = state([a('soon', 20, 30)]);
    // 2026-11-09 is a Monday.
    const late = await buildBrief(st, now, 'cron', undefined, [], [], {
      start: '14:00',
      end: '18:00',
      offDays: [],
    });
    expect(late.capacity).toMatch(/first at 2:00 p\.m\.$/);
    const off = await buildBrief(st, now, 'cron', undefined, [], [], {
      start: '09:00',
      end: '17:00',
      offDays: [1],
    });
    expect(off.blocks).toEqual([]);
    expect(off.capacity).toBe('Today is a day off, so no work is scheduled.');
    expect(off.focus[0]).toMatchObject({ title: 'soon', minutes: 0 }); // listed, no time suggested
  });

  it('says so honestly when nothing is urgent', async () => {
    const b = await buildBrief(state([]), now, 'cron', async () => ({
      summary: 'should not be used',
      writer: 'm',
    }));
    expect(b.summary).toBe('Good morning, Maya. Nothing is due soon. Enjoy the breathing room.');
    expect(b.capacity).toBe('Nothing needs work today.');
  });

  it('mentions overdue work first', () => {
    expect(
      templateSummary({
        name: '',
        forDate: 'x',
        localTime: '07:30',
        focus: [
          {
            assignmentId: '1',
            courseCode: null,
            title: 't',
            dueAt: inH(-1),
            why: '',
            minutes: 60,
            overdue: true,
          },
        ],
        dueSoon: [],
        changes: [],
        capacity: 'c',
        schedule: [],
        timezone: 'America/Vancouver',
      }),
    ).toBe('Good morning. 1 item is past due, so start there. c');
  });
});
