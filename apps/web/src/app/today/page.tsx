import { formatWhen as whenLabel } from '@/lib/format';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDuration, rankAssignments } from '@helm/shared';
import { AgentStatus } from '@/components/AgentStatus';
import { BriefCard } from '@/components/BriefCard';
import { ChangesCard } from '@/components/ChangesCard';
import { ShareMessage } from '@/components/ShareMessage';
import { TelegramCard } from '@/components/TelegramCard';
import { telegramToken } from '@/lib/telegram';
import { SubmissionAlerts } from '@/components/SubmissionsBoard';
import { listSubmissions } from '@/lib/submissions';
import { demoEmailTemplates } from '@/lib/demo-emails';
import { listChanges } from '@/lib/inbox';
import { todaysBrief } from '@/lib/briefs';
import { currentUser } from '@/lib/session';
import { Card, Shell } from '@/components/ui';
import { getDb } from '@/db';
import { listAssignments } from '@/lib/assignments';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const { user, agent } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  const db = await getDb();
  const fullUser = (await currentUser())!;
  const [confirmed, pending, brief, changes] = await Promise.all([
    listAssignments(db, user.id, user.timezone, { review: false }),
    listAssignments(db, user.id, user.timezone, { review: true }),
    todaysBrief(db, fullUser),
    listChanges(db, fullUser),
  ]);
  const submissions = await listSubmissions(db, fullUser);
  const demo = process.env.DEMO_MODE === 'true';
  const pickable = confirmed
    .filter((a) => a.status === 'todo' || a.status === 'in_progress')
    .map((a) => ({ id: a.id, label: `${a.courseCode ? `${a.courseCode} · ` : ''}${a.title}` }));
  const now = new Date();
  const ranked = rankAssignments(confirmed, now);
  const focus = ranked.slice(0, 3);
  const soon = ranked.filter((r) => r.hoursLeft <= 72 && !focus.includes(r));

  return (
    <Shell
      title={user.name ? `Today, ${user.name}` : 'Today'}
      actions={
        <nav aria-label="Main" className="flex gap-1">
          <Link
            href="/submissions"
            className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
          >
            Hand in
          </Link>
          <Link
            href="/timeline"
            className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
          >
            Timeline
          </Link>
          <Link
            href="/setup"
            className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
          >
            Settings
          </Link>
        </nav>
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

      <SubmissionAlerts initial={submissions} />

      <ChangesCard pending={changes.pending} applied={changes.applied} assignments={pickable} />

      <BriefCard initial={brief} briefTime={user.briefTimeLocal} />

      <Card>
        <h2 className="text-lg font-semibold">Right now</h2>
        {focus.length === 0 ? (
          <p className="mt-2">
            {confirmed.length === 0 ? 'No deadlines yet. ' : 'Nothing is pressing right now. '}
            <Link href="/intake" className="font-medium underline underline-offset-4">
              Add a document
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
          Add another document
        </Link>
      </p>
      <ShareMessage templates={demo ? demoEmailTemplates(confirmed, user.timezone, now) : []} />
      {telegramToken() && <TelegramCard linked={user.telegramLinked} />}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          Put Helm on your phone&apos;s home screen
        </summary>
        <p>
          iPhone: open Helm in Safari, tap Share, then <strong>Add to Home Screen</strong>. Android:
          open the Chrome menu, then <strong>Install app</strong>. On Android you can then share any
          message to Helm from the share sheet.
        </p>
      </details>
      <AgentStatus initial={agent} />
    </Shell>
  );
}
