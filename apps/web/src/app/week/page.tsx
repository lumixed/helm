import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDuration } from '@helm/shared';
import { WeeklyReviewButton } from '@/components/WeeklyReviewButton';
import { Card, CardTitle, Chip, Shell } from '@/components/ui';
import { getDb } from '@/db';
import { formatWhen } from '@/lib/format';
import { requireProfile } from '@/lib/page-data';
import { latestWeeklyReview } from '@/lib/week';

export const dynamic = 'force-dynamic';

type Item = { title: string; courseCode: string | null; at: string };

export default async function WeekPage() {
  const { user } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  const review = await latestWeeklyReview(await getDb(), user.id);
  const tz = user.timezone;
  const day = (iso: string) => formatWhen(iso, tz).replace(/,\s\d.*$/, '');
  const name = (i: Item) => (
    <>
      {i.courseCode && <span className="text-muted">{i.courseCode} · </span>}
      {i.title}
    </>
  );

  if (!review)
    return (
      <Shell
        title="Your week"
        subtitle="Once a week your agent looks back at the week and ahead to the next."
      >
        <Card>
          <CardTitle>No review yet</CardTitle>
          <p className="mb-4 text-sm text-ink-soft">
            Turn on the weekly review in{' '}
            <Link href="/setup" className="font-medium text-ink underline underline-offset-4">
              Settings
            </Link>{' '}
            and pick a day and time. It runs on its own Maritime cron on your private agent, so it
            arrives even when Helm is closed. You can also ask for one now.
          </p>
          <WeeklyReviewButton />
        </Card>
      </Shell>
    );

  const f = review.factsJson;
  const weekLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${f.weekEnding}T12:00:00Z`));
  return (
    <Shell title="Your week" subtitle={`Week ending ${weekLabel}.`}>
      <Card>
        <p className="text-lg text-ink">{review.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip tone={f.done.length ? 'ok' : 'neutral'}>{f.done.length} done</Chip>
          <Chip tone={f.slipped.length ? 'warn' : 'neutral'}>{f.slipped.length} slipped</Chip>
          <Chip>
            {f.nextWeek.length} due next week
            {f.nextWeekMinutes ? ` · ${formatDuration(f.nextWeekMinutes)}` : ''}
          </Chip>
        </div>
      </Card>

      {f.done.length > 0 && (
        <Card>
          <CardTitle>Finished</CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {f.done.map((i, n) => (
              <li key={n} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                <span className="min-w-0 truncate text-ink">{name(i)}</span>
                <span className="shrink-0 text-sm text-muted">{day(i.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {f.slipped.length > 0 && (
        <Card>
          <CardTitle
            aside={
              <Link href="/today" className="font-medium text-ink">
                Open Today
              </Link>
            }
          >
            Slipped
          </CardTitle>
          <p className="-mt-1 mb-2 text-sm text-muted">
            Past their date and still open. Finish one, or mark it done or dropped on Today.
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {f.slipped.map((i, n) => (
              <li key={n} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-ink">{name(i)}</span>
                <Chip tone="warn">was due {day(i.at)}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle
          aside={f.nextWeekMinutes ? `About ${formatDuration(f.nextWeekMinutes)}` : undefined}
        >
          Next week
        </CardTitle>
        {f.nextWeek.length === 0 ? (
          <p className="text-sm text-muted">Nothing due yet. Enjoy the room.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {f.nextWeek.map((i, n) => (
              <li key={n} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                <span className="min-w-0 truncate text-ink">{name(i)}</span>
                <Chip>{day(i.at)}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Your agent this week</CardTitle>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          {[
            ['Woke up', `${f.agentWakes}×`],
            ['By Maritime cron', `${f.cronWakes}×`],
            ['Changes caught', String(f.changesCaught)],
            ['Reminders sent', String(f.remindersSent)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="text-lg font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-muted">
          Written {formatWhen(review.createdAt, tz)} by your private agent
          {review.writer === 'template' ? ' (plain template)' : ''}
          {review.requestId.startsWith('review:manual')
            ? ', because you asked.'
            : ', on its weekly Maritime cron.'}
        </p>
      </Card>

      <WeeklyReviewButton label="Write it again now" />
    </Shell>
  );
}
