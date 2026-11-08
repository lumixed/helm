import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDuration, rankAssignments } from '@helm/shared';
import { AgentStatus } from '@/components/AgentStatus';
import { BriefCard } from '@/components/BriefCard';
import { DoneButton } from '@/components/DoneButton';
import { ChangesCard } from '@/components/ChangesCard';
import { IconAdd, IconArrow, IconBell, IconGlobe, IconShare } from '@/components/icons';
import { SubmissionAlerts } from '@/components/SubmissionsBoard';
import { Banner, Card, CardTitle, Chip, Shell } from '@/components/ui';
import { getDb } from '@/db';
import { listAssignments } from '@/lib/assignments';
import { todaysBrief } from '@/lib/briefs';
import { formatWhen } from '@/lib/format';
import { listChanges } from '@/lib/inbox';
import { requireProfile } from '@/lib/page-data';
import { currentUser } from '@/lib/session';
import { listSubmissions } from '@/lib/submissions';
import { llmPausedThisMonth } from '@/lib/limits';
import { reminderViews } from '@/lib/reminders';
import { latestWeeklyReview } from '@/lib/week';
import { openWaiting } from '@/lib/waiting';
import { WaitingCard } from '@/components/WaitingCard';
import { GetStartedCard } from '@/components/GetStartedCard';
import { gmailConfig } from '@/lib/gmail';
import { setupSteps } from '@/lib/setup-steps';
import { telegramToken } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * Today answers one question: what do I do right now? Order: anything that needs the person
 * (new items to check, hand-in alerts, changes), then the brief, then what's coming up.
 * Setup things (Gmail, Telegram, install) live in Settings.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const { gmail } = await searchParams;
  const { user, agent } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  const db = await getDb();
  const fullUser = (await currentUser())!;
  const [confirmed, pending, brief, changes, submissions, paused, reminders, week, waiting] =
    await Promise.all([
      listAssignments(db, user.id, user.timezone, { review: false }),
      listAssignments(db, user.id, user.timezone, { review: true }),
      todaysBrief(db, fullUser),
      listChanges(db, fullUser),
      listSubmissions(db, fullUser),
      llmPausedThisMonth(db, user.id),
      reminderViews(db, fullUser),
      latestWeeklyReview(db, user.id),
      openWaiting(db, user.id),
    ]);
  const pickable = confirmed
    .filter((a) => a.status === 'todo' || a.status === 'in_progress')
    .map((a) => ({ id: a.id, label: `${a.courseCode ? `${a.courseCode} · ` : ''}${a.title}` }));

  const now = new Date();
  const ranked = rankAssignments(confirmed, now);
  // Without a brief yet, show the live ranking so the page is never empty.
  const live = brief ? [] : ranked.slice(0, 3);
  const shown = new Set([
    ...(brief?.focus.map((f) => f.assignmentId) ?? []),
    ...live.map((r) => r.item.id),
  ]);
  const nextReminders = reminders.filter((r) => r.enabled && r.nextAt).slice(0, 3);
  const comingUp = ranked.filter((r) => !shown.has(r.item.id) && r.hoursLeft <= 7 * 24).slice(0, 8);
  const dateLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone: user.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const steps = setupSteps(fullUser, {
    hasItems: confirmed.length + pending.length > 0,
    google: Boolean(gmailConfig()),
    telegram: Boolean(telegramToken()),
  });

  return (
    <Shell title={user.name ? `Today, ${user.name}` : 'Today'} subtitle={dateLabel}>
      {paused && (
        <Banner tone="warn" role="status">
          <strong>Paused: your monthly AI budget is used up.</strong> Your agent still keeps your
          list and your hand-ins, but it can&apos;t write briefs or read new documents until next
          month or a higher limit.
        </Banner>
      )}
      {gmail && (
        <Banner tone={gmail === 'connected' || gmail === 'ok' ? 'ok' : 'warn'} role="status">
          {gmail === 'connected' || gmail === 'ok'
            ? 'Gmail is connected. Your agent will read new mail.'
            : 'Gmail was not connected. You can try again in Settings.'}
        </Banner>
      )}

      {pending.length > 0 && (
        <Link
          href="/review"
          className="flex items-center justify-between gap-3 rounded-card border border-warn/25 bg-warn-soft px-5 py-4 text-ink transition-colors hover:border-warn/50"
        >
          <span>
            <span className="font-semibold">
              {pending.length} new item{pending.length === 1 ? '' : 's'} to check
            </span>
            <span className="block text-sm text-muted">Nothing is used until you confirm it.</span>
          </span>
          <IconArrow />
        </Link>
      )}

      {!fullUser.setupDismissedAt && steps.some((s) => !s.done) && <GetStartedCard steps={steps} />}

      <SubmissionAlerts initial={submissions} />
      <ChangesCard pending={changes.pending} applied={changes.applied} assignments={pickable} />
      <BriefCard
        initial={brief}
        briefTime={user.briefTimeLocal}
        googleConnected={Boolean(fullUser.gmailAddress)}
        doneIds={confirmed
          .filter((a) => a.status === 'done' || a.status === 'submitted')
          .map((a) => a.id)}
      />

      {live.length > 0 && (
        <Card>
          <CardTitle aside="Live ranking">Right now</CardTitle>
          <ol className="flex flex-col divide-y divide-line">
            {live.map((r, i) => (
              <li key={r.item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${r.overdue ? 'bg-danger text-white' : 'bg-canvas text-ink'}`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {r.item.courseCode && (
                      <span className="text-muted">{r.item.courseCode} · </span>
                    )}
                    {r.item.title}
                  </p>
                  <p className="text-sm text-ink-soft">{r.why}</p>
                  <p className="text-sm text-muted">
                    Due {formatWhen(r.item.dueAt!, user.timezone)}
                    {r.remainingMinutes > 0 &&
                      ` · plan ${formatDuration(Math.min(r.remainingMinutes, 120))} today`}
                  </p>
                </div>
                <DoneButton id={r.item.id} title={r.item.title} />
              </li>
            ))}
          </ol>
        </Card>
      )}

      {confirmed.length === 0 && pending.length === 0 && (
        <Card className="text-center">
          <p className="text-ink">Nothing tracked yet.</p>
          <p className="mt-1 text-sm text-muted">
            Add a syllabus, a lease or a bill, or share a message, and Helm lists what you owe.
          </p>
        </Card>
      )}

      {comingUp.length > 0 && (
        <Card>
          <CardTitle aside="Next 7 days">Coming up</CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {comingUp.map((r) => (
              <li
                key={r.item.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-ink">
                  {r.item.courseCode && <span className="text-muted">{r.item.courseCode} · </span>}
                  {r.item.title}
                </span>
                <Chip tone={r.hoursLeft <= 48 ? 'warn' : 'neutral'}>
                  {formatWhen(r.item.dueAt!, user.timezone).replace(/,\s\d.*$/, '')}
                </Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {waiting.length > 0 && (
        <WaitingCard
          rows={waiting.map((w) => ({
            id: w.id,
            summary: w.summary,
            toName: w.toName,
            subject: w.subject,
            daysAgo: Math.max(1, Math.floor((now.getTime() - w.sentAt.getTime()) / 86_400_000)),
            drafted: Boolean(w.draftedAt),
          }))}
        />
      )}

      {week && Date.now() - week.createdAt.getTime() < 3 * 86_400_000 && (
        <Link
          href="/week"
          className="group rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong sm:p-6"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="text-[17px] font-semibold tracking-tight text-ink">
              Your week in review
            </span>
            <IconArrow
              width={16}
              height={16}
              className="text-muted transition-transform group-hover:translate-x-0.5"
            />
          </span>
          <span className="mt-2 line-clamp-2 block text-ink-soft">{week.summary}</span>
          <span className="mt-3 flex flex-wrap gap-2">
            <Chip tone={week.factsJson.done.length ? 'ok' : 'neutral'}>
              {week.factsJson.done.length} done
            </Chip>
            <Chip tone={week.factsJson.slipped.length ? 'warn' : 'neutral'}>
              {week.factsJson.slipped.length} slipped
            </Chip>
            <Chip>{week.factsJson.nextWeek.length} due next week</Chip>
          </span>
        </Link>
      )}

      {nextReminders.length > 0 ? (
        <Card>
          <CardTitle
            aside={
              <Link
                href="/reminders"
                className="font-medium text-ink underline-offset-4 hover:underline"
              >
                All reminders
              </Link>
            }
          >
            Reminders
          </CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {nextReminders.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="flex min-w-0 items-center gap-2 truncate text-ink">
                  <IconBell width={16} height={16} className="shrink-0 text-muted" />
                  {r.title}
                </span>
                <Chip>{formatWhen(r.nextAt!, user.timezone)}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {nextReminders.length === 0 && (
          <QuickLink
            href="/reminders"
            Icon={IconBell}
            title="Set a reminder"
            body="Rent, bills, appointments. Your agent's own schedule sends them, even with Helm closed."
          />
        )}
        <QuickLink
          href="/tasks"
          Icon={IconGlobe}
          title="Do something on a website"
          body="Renew, book, fill in a form. Helm works in a private browser and stops for your yes."
        />
        <QuickLink
          href="/share"
          Icon={IconShare}
          title="Share a message"
          body="An email, text or chat about a date? Paste it and Helm updates your list."
        />
        <QuickLink
          href="/intake"
          Icon={IconAdd}
          title="Add a document"
          body="Syllabus, lease, bill or invite. Your agent finds every date."
        />
      </div>

      <AgentStatus initial={agent} />
      <p className="text-center text-sm text-muted">
        <Link href="/week" className="font-medium text-ink underline-offset-4 hover:underline">
          Your week in review
        </Link>
        {' · '}Your brief arrives each morning at {user.briefTimeLocal} (
        {user.timezone.replaceAll('_', ' ')}).
      </p>
    </Shell>
  );
}

function QuickLink({
  href,
  Icon,
  title,
  body,
}: {
  href: string;
  Icon: typeof IconShare;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group flex gap-3 rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-ink">
        <Icon />
      </span>
      <span>
        <span className="flex items-center gap-1 font-semibold text-ink">
          {title}
          <IconArrow
            width={16}
            height={16}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </span>
        <span className="mt-0.5 block text-sm text-muted">{body}</span>
      </span>
    </Link>
  );
}
