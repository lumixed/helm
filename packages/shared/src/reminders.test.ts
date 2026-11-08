import { describe, expect, it } from 'vitest';
import {
  describeRule,
  nextOccurrence,
  occursOn,
  previousOccurrence,
  reminderCron,
  type ReminderRule,
} from './reminders';

const LA = 'America/Los_Angeles';

describe('reminderCron', () => {
  it('writes local-time cron for each kind', () => {
    expect(reminderCron({ repeat: 'daily', time: '07:05' })).toBe('5 7 * * *');
    expect(reminderCron({ repeat: 'weekly', weekday: 2, time: '15:30' })).toBe('30 15 * * 2');
    expect(reminderCron({ repeat: 'monthly', day: 1, time: '09:00' })).toBe('0 9 1 * *');
    expect(reminderCron({ repeat: 'monthly', day: 31, time: '09:00' })).toBe('0 9 28-31 * *');
    expect(reminderCron({ repeat: 'once', date: '2026-12-03', time: '14:00' })).toBe('0 14 3 12 *');
  });
});

describe('occursOn', () => {
  it('puts day 31 on the last day of short months', () => {
    const r: ReminderRule = { repeat: 'monthly', day: 31, time: '09:00' };
    expect(occursOn(r, '2026-11-30')).toBe(true);
    expect(occursOn(r, '2026-11-28')).toBe(false);
    expect(occursOn(r, '2027-02-28')).toBe(true);
    expect(occursOn(r, '2026-12-31')).toBe(true);
    expect(occursOn(r, '2026-12-30')).toBe(false);
  });
  it('matches weekdays', () => {
    expect(occursOn({ repeat: 'weekly', weekday: 0, time: '09:00' }, '2026-11-08')).toBe(true); // Sunday
    expect(occursOn({ repeat: 'weekly', weekday: 1, time: '09:00' }, '2026-11-08')).toBe(false);
  });
});

describe('next / previous occurrence', () => {
  const now = new Date('2026-11-08T18:00:00Z'); // Sun 10:00 in Los Angeles (PST)

  it('finds the next monthly occurrence in local time', () => {
    const r: ReminderRule = { repeat: 'monthly', day: 1, time: '09:00' };
    expect(nextOccurrence(r, LA, now)?.toISOString()).toBe('2026-12-01T17:00:00.000Z');
    expect(previousOccurrence(r, LA, now)?.toISOString()).toBe('2026-11-01T17:00:00.000Z'); // PST since Nov 1 02:00
  });

  it('returns today when the time is still ahead, tomorrow otherwise', () => {
    expect(nextOccurrence({ repeat: 'daily', time: '11:00' }, LA, now)?.toISOString()).toBe(
      '2026-11-08T19:00:00.000Z',
    );
    expect(nextOccurrence({ repeat: 'daily', time: '09:00' }, LA, now)?.toISOString()).toBe(
      '2026-11-09T17:00:00.000Z',
    );
  });

  it('one-off: next until it passes, then only previous', () => {
    const r: ReminderRule = { repeat: 'once', date: '2026-11-10', time: '15:00' };
    expect(nextOccurrence(r, LA, now)?.toISOString()).toBe('2026-11-10T23:00:00.000Z');
    expect(previousOccurrence(r, LA, now)).toBeNull();
    const later = new Date('2026-11-11T00:00:00Z');
    expect(nextOccurrence(r, LA, later)).toBeNull();
    expect(previousOccurrence(r, LA, later)?.toISOString()).toBe('2026-11-10T23:00:00.000Z');
  });
});

describe('describeRule', () => {
  it('reads naturally', () => {
    expect(describeRule({ repeat: 'monthly', day: 1, time: '09:00' })).toBe(
      'Every month on the 1st at 9 am',
    );
    expect(describeRule({ repeat: 'monthly', day: 22, time: '09:00' })).toBe(
      'Every month on the 22nd at 9 am',
    );
    expect(describeRule({ repeat: 'monthly', day: 31, time: '18:15' })).toBe(
      'Every month on the 31st at 6:15 pm (or the last day)',
    );
    expect(describeRule({ repeat: 'weekly', weekday: 2, time: '00:00' })).toBe(
      'Every Tuesday at 12 am',
    );
    expect(describeRule({ repeat: 'once', date: '2026-11-10', time: '15:30' })).toBe(
      'Tue, Nov 10 at 3:30 pm',
    );
  });
});
