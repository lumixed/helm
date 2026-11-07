import { describe, expect, it } from 'vitest';
import { ScheduleEntry, dailyCron } from './schedules';

describe('dailyCron', () => {
  it('converts HH:MM to a daily cron', () => {
    expect(dailyCron('07:30')).toBe('30 7 * * *');
    expect(dailyCron('00:00')).toBe('0 0 * * *');
    expect(dailyCron('23:05')).toBe('5 23 * * *');
  });
  it('rejects bad times', () => {
    expect(() => dailyCron('7:30')).toThrow();
    expect(() => dailyCron('24:00')).toThrow();
  });
});

describe('ScheduleEntry', () => {
  it('requires exactly one of cron / nextRunAt', () => {
    expect(ScheduleEntry.safeParse({ id: 'a', cron: '0 9 * * *' }).success).toBe(true);
    expect(ScheduleEntry.safeParse({ id: 'a', nextRunAt: '2026-11-08T17:00:00Z' }).success).toBe(
      true,
    );
    expect(ScheduleEntry.safeParse({ id: 'a' }).success).toBe(false);
    expect(
      ScheduleEntry.safeParse({ id: 'a', cron: '0 9 * * *', nextRunAt: '2026-11-08T17:00:00Z' })
        .success,
    ).toBe(false);
  });
});
