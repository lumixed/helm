import { localToUtc, nextOccurrence, utcToLocal } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { Db } from '@/db';
import type { User } from '@/db/schema';
import { listAssignments } from './assignments';
import { formatWhen } from './format';
import { listReminders } from './reminders';
import { listSubmissions, timings } from './submissions';

/**
 * Notifications the phone app schedules on the device itself. Expo Go cannot receive server push
 * (SDK 58), but it can show local notifications, so the app asks for this list whenever it opens
 * and re-schedules everything. Times are exact instants computed here with the person's
 * timezone, so the phone's own timezone setting cannot shift them.
 */
export interface LocalNotification {
  id: string;
  at: string;
  title: string;
  body: string;
  /** App path to open when tapped. */
  path: string;
}

const DAY = 86_400_000;
const MAX = 40;

export async function mobileSchedule(
  db: Db,
  user: User,
  now = new Date(),
): Promise<LocalNotification[]> {
  const out: LocalNotification[] = [];

  // Morning brief for the next 7 days (the platform cron writes it at this time).
  const today = utcToLocal(now, user.timezone).slice(0, 10);
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) + d * DAY).toISOString().slice(0, 10);
    const at = localToUtc(`${date}T${user.briefTimeLocal}`, user.timezone);
    if (at.getTime() <= now.getTime() + 30_000) continue;
    out.push({
      id: `brief:${date}`,
      at: at.toISOString(),
      title: 'Your brief is ready',
      body: 'See what to focus on today.',
      path: '/today',
    });
  }

  // Hold notices for scheduled hand-ins: the last moment to say "Hold".
  const { holdMs } = timings();
  for (const s of await listSubmissions(db, user)) {
    if (s.status !== 'scheduled' || !s.submitAt) continue;
    const at = new Date(Date.parse(s.submitAt) - holdMs);
    if (at.getTime() <= now.getTime()) continue;
    const mins = Math.max(1, Math.round(holdMs / 60_000));
    out.push({
      id: `hold:${s.id}`,
      at: at.toISOString(),
      title: holdMs >= 60_000 ? `Helm hands this in in ${mins} min` : 'Helm hands this in shortly',
      body: `${s.courseCode ? `${s.courseCode} · ` : ''}${s.title}. Open Helm to hold it.`,
      path: '/submissions',
    });
  }

  // A day-before reminder for open deadlines in the next week.
  for (const a of await listAssignments(db, user.id, user.timezone, { review: false })) {
    if (!a.dueAt || (a.status !== 'todo' && a.status !== 'in_progress')) continue;
    const at = new Date(Date.parse(a.dueAt) - DAY);
    if (at.getTime() <= now.getTime() || at.getTime() > now.getTime() + 7 * DAY) continue;
    out.push({
      id: `due:${a.id}`,
      at: at.toISOString(),
      title: 'Due tomorrow',
      body: `${a.courseCode ? `${a.courseCode} · ` : ''}${a.title}, ${formatWhen(a.dueAt, user.timezone)}`,
      path: '/today',
    });
  }

  // Reminders. A phone with server push gets them from the agent's Maritime cron already, so
  // only phones without it (Expo Go) schedule them locally. Up to 3 occurrences each.
  const pushPhones = await db
    .select({ id: schema.pushTokens.id })
    .from(schema.pushTokens)
    .where(eq(schema.pushTokens.userId, user.id))
    .limit(1);
  if (pushPhones.length === 0) {
    for (const r of await listReminders(db, user.id)) {
      if (!r.enabled) continue;
      let after = now;
      for (let i = 0; i < 3; i++) {
        const at = nextOccurrence(r.ruleJson, user.timezone, after);
        if (!at || at.getTime() > now.getTime() + 14 * DAY) break;
        out.push({
          id: `reminder:${r.id}:${at.toISOString()}`,
          at: at.toISOString(),
          title: '⏰ Reminder',
          body: r.title,
          path: '/reminders',
        });
        after = at;
      }
    }
  }

  return out.sort((x, y) => x.at.localeCompare(y.at)).slice(0, MAX);
}
