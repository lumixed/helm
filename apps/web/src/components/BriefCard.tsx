'use client';

import { useEffect, useState } from 'react';
import type { TodaysBrief } from '@/lib/briefs';
import { Button, Card } from './ui';

/** Today's brief, plus "Send my brief now" which wakes the agent and waits for the new brief. */
export function BriefCard({
  initial,
  briefTime,
}: {
  initial: TodaysBrief | null;
  briefTime: string;
}) {
  const [brief, setBrief] = useState(initial);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (waitingSince === null) return;
    const t = setInterval(async () => {
      const res = await fetch('/api/brief/today', { cache: 'no-store' });
      const { brief: b } = (await res.json()) as { brief: TodaysBrief | null };
      if (b && new Date(b.generatedAt).getTime() >= waitingSince - 2000) {
        setBrief(b);
        setWaitingSince(null);
      } else if (Date.now() - waitingSince > 120_000) {
        setWaitingSince(null);
        setError('Your agent has not answered yet. Check the timeline, or try again.');
      }
    }, 2000);
    return () => clearInterval(t);
  }, [waitingSince]);

  async function sendNow() {
    setError(null);
    const started = Date.now();
    const res = await fetch('/api/brief/regenerate', { method: 'POST' });
    if (!res.ok) {
      setError(
        ((await res.json().catch(() => ({}))) as { error?: string }).error ??
          'Could not reach your agent.',
      );
      return;
    }
    setWaitingSince(started);
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">Your brief</h2>
        {brief && (
          <p className="text-sm text-sea-800/80 dark:text-sea-100/80">
            {brief.trigger === 'cron' ? 'Morning brief' : 'On request'} · {brief.generatedLabel}
          </p>
        )}
      </div>
      <div aria-live="polite" className="mt-2 flex flex-col gap-3">
        {!brief ? (
          <p>Your brief arrives each morning at {briefTime}. You can also ask for it now.</p>
        ) : (
          <>
            <p className="text-lg leading-relaxed">{brief.summary}</p>
            {brief.focus.length > 0 && (
              <ol className="flex flex-col gap-3">
                {brief.focus.map((f, i) => (
                  <li key={f.assignmentId} className="flex gap-3">
                    <span
                      aria-hidden
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-semibold ${f.overdue ? 'bg-flare text-white' : 'bg-sea-100 text-sea-950'}`}
                    >
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-medium">
                        {f.courseCode && (
                          <span className="text-sea-600 dark:text-sea-100">{f.courseCode} · </span>
                        )}
                        {f.title}
                      </p>
                      <p className="text-sm">{f.why}</p>
                      <p className="text-sm text-sea-800/80 dark:text-sea-100/80">
                        Due {f.dueLabel}
                        {f.minutes > 0 &&
                          ` · plan ${f.minutes >= 60 ? `${Math.round((f.minutes / 60) * 10) / 10}h` : `${f.minutes} min`} today`}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {brief.changes.length > 0 && (
              <div>
                <h3 className="font-medium">Changed since your last brief</h3>
                <ul className="text-sm">
                  {brief.changes.map((c, i) => (
                    <li key={i}>
                      {c.title}: {c.field} {c.oldValue ? `from ${c.oldValue} ` : ''}to {c.newValue}{' '}
                      ({c.source})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.dueSoon.length > 0 && (
              <p className="text-sm">
                Also due in the next 3 days: {brief.dueSoon.map((d) => d.title).join(', ')}.
              </p>
            )}
            <p className="text-sm text-sea-800/80 dark:text-sea-100/80">{brief.capacity}</p>
          </>
        )}
        {waitingSince !== null && (
          <p className="rounded-xl bg-sea-100 px-3 py-2 text-sea-950">
            Waking your agent and writing your brief…
          </p>
        )}
        {error && (
          <p role="alert" className="text-flare">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        onClick={sendNow}
        disabled={waitingSince !== null}
        className="mt-4 w-full"
      >
        Send my brief now
      </Button>
    </Card>
  );
}
