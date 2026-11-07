import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDuration, rankAssignments } from '@helm/shared';
import { AgentStatus } from '@/components/AgentStatus';
import { Card, Shell } from '@/components/ui';
import { getDb } from '@/db';
import { listAssignments } from '@/lib/assignments';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

function whenLabel(dueAt: string, tz: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(dueAt));
}

export default async function TodayPage() {
  const { user, agent } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  const db = await getDb();
  const [confirmed, pending] = await Promise.all([
    listAssignments(db, user.id, user.timezone, { review: false }),
    listAssignments(db, user.id, user.timezone, { review: true }),
  ]);
  const now = new Date();
  const ranked = rankAssignments(confirmed, now);
  const focus = ranked.slice(0, 3);
  const soon = ranked.filter((r) => r.hoursLeft <= 72 && !focus.includes(r));

  return (
    <Shell
      title={user.name ? `Today, ${user.name}` : 'Today'}
      actions={
        <Link
          href="/setup"
          className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
        >
          Settings
        </Link>
      }
    >
      {pending.length > 0 && (
        <Link
          href="/review"
          className="block rounded-2xl bg-amber-100 px-5 py-4 font-medium text-amber-950 ring-1 ring-amber-400"
        >
          {pending.length} new deadline{pending.length === 1 ? '' : 's'} to check →
        </Link>
      )}

      <Card>
        <h2 className="text-lg font-semibold">Focus today</h2>
        {focus.length === 0 ? (
          <p className="mt-2">
            {confirmed.length === 0 ? 'No deadlines yet. ' : 'Nothing is pressing right now. '}
            <Link href="/intake" className="font-medium underline underline-offset-4">
              Add a syllabus
            </Link>
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {focus.map((r, i) => (
              <li key={r.item.id} className="flex gap-3">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-semibold ${r.overdue ? 'bg-flare text-white' : 'bg-sea-100 text-sea-950'}`}
                >
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">
                    {r.item.courseCode && (
                      <span className="text-sea-600 dark:text-sea-100">{r.item.courseCode} · </span>
                    )}
                    {r.item.title}
                  </p>
                  <p className="text-sm">{r.why}</p>
                  <p className="text-sm text-sea-800/80 dark:text-sea-100/80">
                    Due {whenLabel(r.item.dueAt!, user.timezone)}
                    {r.remainingMinutes > 0 &&
                      ` · plan ${formatDuration(Math.min(r.remainingMinutes, 120))} today`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {soon.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">Also due in the next 3 days</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {soon.map((r) => (
              <li key={r.item.id}>
                {r.item.courseCode} {r.item.title} · {whenLabel(r.item.dueAt!, user.timezone)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-sm text-sea-800/80 dark:text-sea-100/80">
        Your morning brief arrives at {user.briefTimeLocal} ({user.timezone.replaceAll('_', ' ')}).{' '}
        <Link href="/intake" className="underline underline-offset-4">
          Add another syllabus
        </Link>
      </p>
      <AgentStatus initial={agent} />
    </Shell>
  );
}
