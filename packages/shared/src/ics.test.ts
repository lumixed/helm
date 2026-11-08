import { describe, expect, it } from 'vitest';
import { calendarItems, isCalendarFeedUrl, parseIcs } from './ics';

const tz = 'America/Vancouver';
// Shaped like a Canvas feed: CRLF, folded lines, escaped commas, all-day and timed events.
const feed = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Instructure//Canvas//EN',
  'BEGIN:VEVENT',
  'UID:event-assignment-101',
  'DTSTART:20261114T065900Z',
  'DTEND:20261114T065900Z',
  'SUMMARY:Assignment 4: Hash tables\\, part 1 [DATA 210]',
  'URL;VALUE=URI:https://demo.instructure.com/courses/1/assignments/101',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-102',
  'DTSTART;VALUE=DATE:20261120',
  'SUMMARY:Reading quiz 6 [ENGL 150]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-calendar-event-77',
  'DTSTART;TZID=America/Vancouver:20261112T150000',
  'SUMMARY:Study group',
  '  session [DATA 210]', // fold: one space removed, the word's own space kept
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-old',
  'DTSTART:20260901T065900Z',
  'SUMMARY:Long gone [DATA 210]',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcs', () => {
  it('reads UTC, all-day and TZID times, unfolds lines and unescapes text', () => {
    const ev = parseIcs(feed, tz);
    expect(ev).toHaveLength(4);
    expect(ev[0]).toMatchObject({
      uid: 'event-assignment-101',
      summary: 'Assignment 4: Hash tables, part 1 [DATA 210]',
      start: '2026-11-14T06:59:00.000Z',
      allDay: false,
      url: 'https://demo.instructure.com/courses/1/assignments/101',
    });
    expect(ev[1]).toMatchObject({ allDay: true, start: '2026-11-21T06:59:00.000Z' }); // 23:59 local
    expect(ev[2]).toMatchObject({
      summary: 'Study group session [DATA 210]',
      start: '2026-11-12T22:00:00.000Z',
    });
  });

  it('ignores garbage safely', () => {
    expect(parseIcs('not a calendar', tz)).toEqual([]);
    expect(parseIcs('BEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT', tz)).toEqual([]);
  });
});

describe('calendarItems', () => {
  it('splits course from title, guesses the type, drops old items, sorts by due', () => {
    const items = calendarItems(parseIcs(feed, tz), tz, new Date('2026-11-08T00:00:00Z'));
    expect(items.map((i) => [i.courseCode, i.title, i.type, i.dueTimeAssumed])).toEqual([
      ['DATA 210', 'Study group session', 'event', false],
      ['DATA 210', 'Assignment 4: Hash tables, part 1', 'assignment', false],
      ['ENGL 150', 'Reading quiz 6', 'quiz', true],
    ]);
  });
});

describe('isCalendarFeedUrl', () => {
  it('accepts https Canvas feeds and listed hosts only', () => {
    expect(isCalendarFeedUrl('https://ubc.instructure.com/feeds/calendars/user_abc.ics')).toBe(
      true,
    );
    expect(isCalendarFeedUrl('http://ubc.instructure.com/feeds/x.ics')).toBe(false);
    expect(isCalendarFeedUrl('https://evil.example/feeds/x.ics')).toBe(false);
    expect(isCalendarFeedUrl('https://helm.test/mock-portal/feeds/x.ics', ['helm.test'])).toBe(
      true,
    );
  });
});
