import { describe, expect, it } from 'vitest';
import { setupSteps } from './setup-steps';

const blank = {
  gmailAddress: null,
  calendarHost: null,
  telegramChatId: null,
  routinesJson: {},
  workHoursJson: null,
};
const ids = (s: ReturnType<typeof setupSteps>) => s.map((x) => x.id);

describe('setupSteps', () => {
  it('does not offer what this server cannot do', () => {
    const s = setupSteps(blank, { hasItems: false, google: false, telegram: false });
    expect(ids(s)).toEqual(['first-item', 'work-hours', 'routines', 'calendar-feed']);
  });

  it('marks steps done from what is really connected', () => {
    const s = setupSteps(
      {
        ...blank,
        gmailAddress: 'a@b.c',
        telegramChatId: '42',
        routinesJson: { evening: '21:00' },
      },
      { hasItems: true, google: true, telegram: true },
    );
    expect(s.filter((x) => !x.done).map((x) => x.id)).toEqual(['work-hours', 'calendar-feed']);
  });
});
