import type { User } from '@/db/schema';

export interface SetupStep {
  id: string;
  title: string;
  why: string;
  href: string;
  done: boolean;
}

/**
 * The "Get Helm ready" checklist. Each step is worked out from what is really connected, and a
 * step this server can't do (no Google or Telegram keys) isn't offered at all.
 */
export function setupSteps(
  user: Pick<
    User,
    'gmailAddress' | 'calendarHost' | 'telegramChatId' | 'routinesJson' | 'workHoursJson'
  >,
  ctx: { hasItems: boolean; google: boolean; telegram: boolean },
): SetupStep[] {
  const routines = user.routinesJson ?? {};
  const steps: (SetupStep | null)[] = [
    {
      id: 'first-item',
      title: 'Add your first thing to track',
      why: 'Paste a message or upload a document. You check everything before Helm uses it.',
      href: '/intake',
      done: ctx.hasItems,
    },
    ctx.google
      ? {
          id: 'google',
          title: 'Connect Gmail and Google Calendar',
          why: 'Your agent spots deadlines and bills, and plans around your day.',
          href: '/setup#google',
          done: Boolean(user.gmailAddress),
        }
      : null,
    ctx.telegram
      ? {
          id: 'telegram',
          title: 'Get your brief on Telegram',
          why: 'Your morning plan arrives on your phone, and you can text your agent.',
          href: '/setup#telegram',
          done: Boolean(user.telegramChatId),
        }
      : null,
    {
      id: 'work-hours',
      title: 'Set your work hours',
      why: 'Helm only plans focused work inside them, and never on days off.',
      href: '/setup#work-hours',
      done: Boolean(user.workHoursJson),
    },
    {
      id: 'routines',
      title: 'Turn on a routine',
      why: 'An evening check-in or weekly review, sent without you opening Helm.',
      href: '/setup#routines',
      done: Boolean(routines.evening || routines.weekly),
    },
    {
      id: 'calendar-feed',
      title: 'Import a calendar link',
      why: 'Optional. Canvas and other .ics calendars stay in sync on their own.',
      href: '/setup#calendar',
      done: Boolean(user.calendarHost),
    },
  ];
  return steps.filter((s): s is SetupStep => s !== null);
}
