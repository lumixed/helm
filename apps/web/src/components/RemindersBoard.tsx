'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ReminderRule } from '@helm/shared';
import { Banner, Button, Card, CardTitle, Chip, Field, buttonClass, inputClass } from './ui';

export interface ReminderRow {
  id: string;
  title: string;
  rule: ReminderRule;
  description: string;
  nextAt: string | null;
  nextLabel: string | null;
  lastLabel: string | null;
  lastFiredBy: string | null;
  enabled: boolean;
  createdVia: string;
  cron: string;
}

type Repeat = ReminderRule['repeat'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const selectClass = `${inputClass} appearance-none pr-10 bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23646b78' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-[length:12px] bg-[right_1rem_center] bg-no-repeat`;

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function RemindersBoard({
  rows,
  today,
  timezone,
}: {
  rows: ReminderRow[];
  today: string;
  timezone: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('monthly');
  const [date, setDate] = useState(nextDay(today));
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);

  function rule(): ReminderRule {
    switch (repeat) {
      case 'once':
        return { repeat, date, time };
      case 'daily':
        return { repeat, time };
      case 'weekly':
        return { repeat, weekday, time };
      case 'monthly':
        return { repeat, day, time };
    }
  }

  async function call(url: string, method: string, body?: object) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string; synced?: boolean };
    return { ok: res.ok, ...out };
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy('add');
    setNote(null);
    const r = await call('/api/reminders', 'POST', { title, rule: rule() });
    setBusy(null);
    if (!r.ok) return setNote({ tone: 'danger', text: r.error ?? 'Could not save. Try again.' });
    setNote(
      r.synced
        ? { tone: 'ok', text: 'Saved to your agent. Maritime will wake it at that time.' }
        : { tone: 'warn', text: 'Saved. Your agent picks it up at its next check.' },
    );
    setTitle('');
    router.refresh();
  }

  async function act(id: string, kind: 'toggle' | 'remove', enabled?: boolean) {
    setBusy(id);
    setNote(null);
    const r =
      kind === 'remove'
        ? await call(`/api/reminders/${id}`, 'DELETE')
        : await call(`/api/reminders/${id}`, 'PATCH', { enabled });
    setBusy(null);
    if (!r.ok) setNote({ tone: 'danger', text: r.error ?? 'Try again.' });
    router.refresh();
  }

  const upcoming = rows.filter((r) => r.nextAt);
  const done = rows.filter((r) => !r.nextAt);

  return (
    <>
      <Card>
        <CardTitle>Add a reminder</CardTitle>
        <form onSubmit={add} className="flex flex-col gap-4">
          <Field label="What" htmlFor="r-title">
            <input
              id="r-title"
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Pay rent"
              maxLength={120}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Repeats" htmlFor="r-repeat">
              <select
                id="r-repeat"
                className={selectClass}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as Repeat)}
              >
                <option value="once">Just once</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </select>
            </Field>
            {repeat === 'once' && (
              <Field label="Date" htmlFor="r-date">
                <input
                  id="r-date"
                  type="date"
                  className={inputClass}
                  value={date}
                  min={today}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </Field>
            )}
            {repeat === 'weekly' && (
              <Field label="On" htmlFor="r-weekday">
                <select
                  id="r-weekday"
                  className={selectClass}
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                >
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {repeat === 'monthly' && (
              <Field label="Day of the month" htmlFor="r-day">
                <select
                  id="r-day"
                  className={selectClass}
                  value={day}
                  onChange={(e) => setDay(Number(e.target.value))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                      {d > 28 ? ' (or last day)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Time" htmlFor="r-time">
              <input
                id="r-time"
                type="time"
                className={inputClass}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Or just tell{' '}
              <Link href="/chat" className="font-medium text-ink underline underline-offset-4">
                Ask
              </Link>
              : &ldquo;remind me to pay rent on the 1st&rdquo;.
            </p>
            <Button type="submit" disabled={busy === 'add' || !title.trim()}>
              {busy === 'add' ? 'Saving…' : 'Add reminder'}
            </Button>
          </div>
        </form>
        {note && (
          <Banner
            tone={note.tone}
            role={note.tone === 'danger' ? 'alert' : 'status'}
            className="mt-4"
          >
            {note.text}
          </Banner>
        )}
      </Card>

      <Card>
        <CardTitle>Your reminders</CardTitle>
        <p className="-mt-2 mb-2 text-sm text-muted">Times in {timezone.replace(/_/g, ' ')}.</p>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">
            No reminders yet. Add rent, a bill, or a weekly quiz above.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{r.title}</p>
                  <p className="text-sm text-ink-soft">{r.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {r.enabled ? (
                      <span className="text-sm text-muted">Next: {r.nextLabel}</span>
                    ) : (
                      <Chip tone="warn">Paused</Chip>
                    )}
                    {r.createdVia === 'chat' && <Chip>From Ask</Chip>}
                    {r.enabled && (
                      <span
                        className="font-mono text-xs text-muted"
                        title="Maritime cron on your agent"
                      >
                        cron {r.cron}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, 'toggle', !r.enabled)}
                    aria-label={`${r.enabled ? 'Pause' : 'Resume'} ${r.title}`}
                  >
                    {r.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, 'remove')}
                    aria-label={`Remove ${r.title}`}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-muted">
              Already went off ({done.length})
            </summary>
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {done.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-ink-soft">
                    {r.title} · {r.description}
                    {r.lastLabel ? ` · sent ${r.lastLabel}` : ''}
                  </span>
                  <button
                    type="button"
                    className={buttonClass('tertiary', 'text-sm')}
                    disabled={busy === r.id}
                    onClick={() => act(r.id, 'remove')}
                    aria-label={`Remove ${r.title}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card>
        <CardTitle>How reminders work</CardTitle>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-soft">
          <li>
            Helm writes your reminders into your private agent&apos;s settings file on Maritime.
          </li>
          <li>
            Your agent publishes each one as its own <strong>Maritime cron schedule</strong> in your
            timezone. Maritime holds the schedule, so it works while the agent sleeps.
          </li>
          <li>
            At the time, Maritime wakes your agent, and it sends the reminder to your phone (Helm
            app or Telegram). The title stays on your agent&apos;s disk, not in the schedule.
          </li>
          <li>If a wake is ever missed, the agent&apos;s 15-minute safety-net check sends it.</li>
        </ol>
        <Link href="/maritime" className={buttonClass('tertiary', 'mt-3 text-sm')}>
          See it live under the hood →
        </Link>
      </Card>
    </>
  );
}
