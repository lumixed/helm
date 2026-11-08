'use client';

import { useState } from 'react';
import { Button, Card, CardTitle, inputClass } from './ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** When Helm may plan focused work, and which days are off. */
export function WorkHoursCard({
  initial,
}: {
  initial: { start: string; end: string; offDays: number[] } | null;
}) {
  const [start, setStart] = useState(initial?.start ?? '09:00');
  const [end, setEnd] = useState(initial?.end ?? '21:00');
  const [off, setOff] = useState<number[]>(initial?.offDays ?? []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const invalid = start >= end;

  async function save() {
    setBusy(true);
    setNote(null);
    const res = await fetch('/api/work-hours', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start, end, offDays: off }),
    });
    setBusy(false);
    setNote(
      res.ok ? 'Saved. Your next brief plans inside these hours.' : 'Could not save. Try again.',
    );
  }

  return (
    <Card>
      <CardTitle>Work hours</CardTitle>
      <p className="text-sm text-ink-soft">
        Helm fits focused work around your calendar, only inside these hours. On days off it plans
        nothing.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="wh-start" className="font-medium text-ink">
            From
          </label>
          <input
            id="wh-start"
            type="time"
            className={`${inputClass} w-36`}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <label htmlFor="wh-end" className="font-medium text-ink">
            to
          </label>
          <input
            id="wh-end"
            type="time"
            className={`${inputClass} w-36`}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <fieldset>
          <legend className="font-medium text-ink">Days off</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label
                key={d}
                className="flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={off.includes(i)}
                  onChange={(e) =>
                    setOff((o) => (e.target.checked ? [...o, i] : o.filter((x) => x !== i)))
                  }
                />
                <span aria-hidden>{d}</span>
                <span className="sr-only">{FULL[i]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {invalid && (
          <p role="alert" className="text-sm text-danger">
            The end time must be after the start time.
          </p>
        )}
        <Button variant="secondary" className="w-fit" disabled={busy || invalid} onClick={save}>
          Save work hours
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
