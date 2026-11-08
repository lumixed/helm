import { describe, expect, it } from 'vitest';
import type { AgentState } from '@helm/shared';
import { buildBrief } from './brief';
import { listEvents } from './gcal';

describe('listEvents', () => {
  it('reads today’s events, skipping cancelled and declined ones', async () => {
    let asked = '';
    const f = (async (u: string | URL | Request) => {
      asked = String(u);
      return Response.json({
        items: [
          {
            summary: 'Standup',
            start: { dateTime: '2026-11-10T17:00:00Z' },
            end: { dateTime: '2026-11-10T17:15:00Z' },
            location: 'Zoom',
          },
          {
            summary: 'Cancelled thing',
            status: 'cancelled',
            start: { dateTime: '2026-11-10T18:00:00Z' },
          },
          {
            summary: 'Declined',
            start: { dateTime: '2026-11-10T19:00:00Z' },
            attendees: [{ self: true, responseStatus: 'declined' }],
          },
          { summary: 'Mom’s birthday', start: { date: '2026-11-10' }, end: { date: '2026-11-11' } },
        ],
      });
    }) as typeof fetch;
    const ev = await listEvents('tok', '2026-11-10T08:00:00Z', '2026-11-11T08:00:00Z', f);
    expect(asked).toContain('singleEvents=true');
    expect(ev.map((e) => [e.title, e.allDay])).toEqual([
      ['Standup', false],
      ['Mom’s birthday', true],
    ]);
    expect(ev[0]).toMatchObject({ location: 'Zoom' });
  });
});

describe('brief with a calendar', () => {
  const state: AgentState = {
    studentId: 's1',
    name: 'Maya',
    timezone: 'America/Vancouver',
    briefTimeLocal: '07:30',
    assignments: [],
    changes: [],
  };
  it('lists the day and mentions the first timed event in the opener', async () => {
    const b = await buildBrief(
      state,
      new Date('2026-11-10T15:30:00Z'),
      'cron',
      undefined,
      [],
      [{ title: 'Standup', start: '2026-11-10T17:00:00Z', end: null, allDay: false }],
    );
    expect(b.schedule).toHaveLength(1);
    expect(b.summary).toMatch(/First on your calendar: Standup at 10:00 a\.m\./);
    expect(b.capacity).toMatch(/1 thing on your calendar/);
  });
});
