import { reminderCron, utcToLocal } from '@helm/shared';
import { redirect } from 'next/navigation';
import { RemindersBoard, type ReminderRow } from '@/components/RemindersBoard';
import { getDb } from '@/db';
import { Shell } from '@/components/ui';
import { formatWhen } from '@/lib/format';
import { requireProfile } from '@/lib/page-data';
import { reminderViews } from '@/lib/reminders';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function RemindersPage() {
  const { user } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  const full = (await currentUser())!;
  const now = new Date();
  const rows: ReminderRow[] = (await reminderViews(await getDb(), full, now)).map((v) => ({
    ...v,
    nextLabel: v.nextAt ? formatWhen(v.nextAt, full.timezone) : null,
    lastLabel: v.lastFiredAt ? formatWhen(v.lastFiredAt, full.timezone) : null,
    cron: reminderCron(v.rule),
  }));
  return (
    <Shell
      title="Reminders"
      subtitle="Rent, bills, appointments, anything that repeats. Each one runs on your private agent's own schedule."
    >
      <RemindersBoard
        rows={rows}
        today={utcToLocal(now, full.timezone).slice(0, 10)}
        timezone={full.timezone}
      />
    </Shell>
  );
}
