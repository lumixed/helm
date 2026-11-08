'use client';

import { useState } from 'react';
import { Button, Card, CardTitle, inputClass } from './ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Evening check-in and weekly review: each runs as a Maritime cron on the person's agent. */
export function RoutinesCard({
  initial,
}: {
  initial: { evening?: string; weekly?: { weekday: number; time: string } };
}) {
  const [eveningOn, setEveningOn] = useState(Boolean(initial.evening));
  const [evening, setEvening] = useState(initial.evening ?? '21:00');
  const [weeklyOn, setWeeklyOn] = useState(Boolean(initial.weekly));
  const [weekday, setWeekday] = useState(initial.weekly?.weekday ?? 0);
  const [weeklyTime, setWeeklyTime] = useState(initial.weekly?.time ?? '18:00');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setNote(null);
    const res = await fetch('/api/routines', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(eveningOn ? { evening } : {}),
        ...(weeklyOn ? { weekly: { weekday, time: weeklyTime } } : {}),
      }),
    });
    setBusy(false);
    setNote(
      res.ok
        ? 'Saved. Your agent runs these on its own schedule, even with Helm closed.'
        : 'Could not save. Try again.',
    );
  }
  return (
    <Card>
      <CardTitle>Routines</CardTitle>
      <p className="text-sm text-ink-soft">
        Each one is a scheduled wake-up on your private agent. It writes a short summary from your
        plan and sends it to your phone.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 font-medium text-ink">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={eveningOn}
              onChange={(e) => setEveningOn(e.target.checked)}
            />
            Evening check-in
          </label>
          <label htmlFor="r-evening" className="sr-only">
            Evening check-in time
          </label>
          <input
            id="r-evening"
            type="time"
            className={`${inputClass} w-36`}
            value={evening}
            disabled={!eveningOn}
            onChange={(e) => setEvening(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 font-medium text-ink">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={weeklyOn}
              onChange={(e) => setWeeklyOn(e.target.checked)}
            />
            Weekly review
          </label>
          <label htmlFor="r-day" className="sr-only">
            Weekly review day
          </label>
          <select
            id="r-day"
            className={`${inputClass} w-40`}
            value={weekday}
            disabled={!weeklyOn}
            onChange={(e) => setWeekday(Number(e.target.value))}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <label htmlFor="r-weekly-time" className="sr-only">
            Weekly review time
          </label>
          <input
            id="r-weekly-time"
            type="time"
            className={`${inputClass} w-36`}
            value={weeklyTime}
            disabled={!weeklyOn}
            onChange={(e) => setWeeklyTime(e.target.value)}
          />
        </div>
        <Button variant="secondary" className="w-fit" disabled={busy} onClick={save}>
          Save routines
        </Button>
        {note && (
          <p aria-live="polite" className="text-sm">
            {note}
          </p>
        )}
      </div>
    </Card>
  );
}
