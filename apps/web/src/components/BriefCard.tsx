'use client';

import { useEffect, useState } from 'react';
import type { TodaysBrief } from '@/lib/briefs';
import { DoneButton } from './DoneButton';
import { Button, Card } from './ui';

/** Today's brief, plus "Send my brief now" which wakes the agent and waits for the new brief. */
export function BriefCard({
  initial,
  briefTime,
  doneIds = [],
  googleConnected = false,
}: {
  initial: TodaysBrief | null;
  briefTime: string;
  /** Focus items already marked done or handed in. */
  doneIds?: string[];
  /** Google is connected, so work blocks can be added to the calendar. */
  googleConnected?: boolean;
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
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">Your brief</h2>
        {brief && (
          <p className="text-sm text-muted">
            {brief.trigger === 'cron'
              ? 'Morning brief'
              : brief.trigger === 'change'
                ? 'Replanned after a change'
                : 'On request'}{' '}
            · {brief.generatedLabel}
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
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-semibold ${f.overdue ? 'bg-danger text-white' : 'bg-accent-soft text-ink'}`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {f.courseCode && <span className="text-muted">{f.courseCode} · </span>}
                        {f.title}
                      </p>
                      <p className="text-sm">{f.why}</p>
                      <p className="text-sm text-muted">
                        Due {f.dueLabel}
                        {f.minutes > 0 &&
                          ` · plan ${f.minutes >= 60 ? `${Math.round((f.minutes / 60) * 10) / 10}h` : `${f.minutes} min`} today`}
                      </p>
                    </div>
                    <DoneButton
                      id={f.assignmentId}
                      title={f.title}
                      initialDone={doneIds.includes(f.assignmentId)}
                    />
                  </li>
                ))}
              </ol>
            )}
            {brief.day.length > 0 && (
              <div>
                <h3 className="font-medium">Your day</h3>
                <ol className="mt-1 flex flex-col gap-1 text-sm">
                  {brief.day.map((d, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-36 shrink-0 tabular-nums text-muted">{d.label}</span>
                      <span>
                        {d.kind === 'work' ? (
                          <>
                            <span className="sr-only">Work block: </span>
                            <strong className="font-medium">{d.title}</strong>
                          </>
                        ) : (
                          <>
                            <span className="sr-only">Calendar: </span>
                            {d.title}
                            {d.detail ? ` (${d.detail})` : ''}
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-1 text-xs text-muted">
                  Bold is focused work Helm fitted around your calendar.
                </p>
                {googleConnected && brief.blocks.length > 0 && <AddToCalendar />}
              </div>
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
            {brief.moneyLine && <p className="text-sm">{brief.moneyLine}</p>}
            <p className="text-sm text-muted">{brief.capacity}</p>
          </>
        )}
        {waitingSince !== null && (
          <p className="rounded-xl bg-accent-soft px-3 py-2 text-ink">
            Waking your agent and writing your brief…
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger">
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

/** One tap: the agent writes today's work blocks to Google Calendar. Tapping again adds nothing twice. */
function AddToCalendar() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!requestId) return;
    const started = Date.now();
    const t = setInterval(async () => {
      const res = await fetch(`/api/brief/calendar?requestId=${encodeURIComponent(requestId)}`, {
        cache: 'no-store',
      });
      const r = (await res.json().catch(() => ({}))) as {
        done?: boolean;
        ok?: boolean;
        message?: string;
      };
      if (r.done) {
        setRequestId(null);
        setNote({ ok: Boolean(r.ok), text: `${r.message ?? 'Done'}.`.replace(/\.\.$/, '.') });
      } else if (Date.now() - started > 90_000) {
        setRequestId(null);
        setNote({ ok: false, text: 'Your agent has not answered yet. Check the timeline.' });
      }
    }, 2000);
    return () => clearInterval(t);
  }, [requestId]);

  async function add() {
    setNote(null);
    const res = await fetch('/api/brief/calendar', { method: 'POST' });
    const r = (await res.json().catch(() => ({}))) as { requestId?: string; error?: string };
    if (!res.ok || !r.requestId) {
      setNote({ ok: false, text: r.error ?? 'Could not reach your agent.' });
      return;
    }
    setRequestId(r.requestId);
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <Button variant="secondary" className="w-fit" disabled={requestId !== null} onClick={add}>
        {requestId ? 'Adding to Google Calendar…' : 'Add blocks to Google Calendar'}
      </Button>
      <p aria-live="polite" className={`text-sm ${note && !note.ok ? 'text-danger' : ''}`}>
        {note?.text}
      </p>
    </div>
  );
}
