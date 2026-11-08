'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SubmissionView } from '@/lib/submissions';
import { SubmissionItem } from './SubmissionItem';
import { Button, Card, Field, inputClass } from './ui';

interface Option {
  id: string;
  label: string;
  allowed: string[];
}

const ACTIVE = new Set(['ready', 'scheduled', 'held', 'submitting']);

/** Poll the queue (this also advances the scheduler), faster while something is in motion. */
export function useSubmissions(initial: SubmissionView[]) {
  const [items, setItems] = useState(initial);
  const load = useCallback(async () => {
    const res = await fetch('/api/submissions', { cache: 'no-store' });
    if (res.ok) setItems(((await res.json()) as { submissions: SubmissionView[] }).submissions);
  }, []);
  const busy = items.some((s) => ACTIVE.has(s.status));
  useEffect(() => {
    const t = setInterval(load, busy ? 3000 : 15000);
    return () => clearInterval(t);
  }, [load, busy]);
  return { items, load };
}

export function SubmissionsBoard({
  initial,
  assignments,
  demo,
  failNext,
}: {
  initial: SubmissionView[];
  assignments: Option[];
  demo: boolean;
  failNext: number;
}) {
  const { items, load } = useSubmissions(initial);
  const [assignmentId, setAssignmentId] = useState(assignments[0]?.id ?? '');
  const [when, setWhen] = useState<'default' | 'pick' | 'demo-90s'>(demo ? 'demo-90s' : 'default');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fails, setFails] = useState(failNext);
  const chosen = assignments.find((a) => a.id === assignmentId);

  async function upload(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    const data = new FormData(form);
    data.set('submitAt', when === 'pick' ? pick : when);
    const res = await fetch('/api/submissions', { method: 'POST', body: data });
    setBusy(false);
    if (!res.ok) {
      setError(
        ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Upload failed.',
      );
      return;
    }
    form.reset();
    await load();
  }

  async function setFailures(n: number) {
    const res = await fetch('/api/demo/portal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ failNext: n, mode: '503' }),
    });
    if (res.ok) setFails(((await res.json()) as { failNext: number }).failNext);
  }

  return (
    <>
      <Card>
        <h2 className="text-lg font-semibold">Let Helm hand it in</h2>
        <p className="mt-1 text-sm">
          Homework, an application, a form for work: anything you hand in on a website. Helm never
          edits it. It checks the file, waits for your OK, and hands it in on time with a receipt.
        </p>
        {assignments.length === 0 ? (
          <p className="mt-3">Nothing open with a due date yet.</p>
        ) : (
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void upload(e.currentTarget);
            }}
          >
            <Field label="What is it for?" htmlFor="sub-assignment">
              <select
                id="sub-assignment"
                name="assignmentId"
                className={inputClass}
                value={assignmentId}
                onChange={(e) => setAssignmentId(e.target.value)}
              >
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Finished file"
              htmlFor="sub-file"
              hint={
                chosen?.allowed.length
                  ? `This one takes ${chosen.allowed.map((t) => `.${t}`).join(', ')}. Up to 4 MB.`
                  : 'Up to 4 MB.'
              }
            >
              <input id="sub-file" name="file" type="file" required className={inputClass} />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium">When should Helm hand it in?</legend>
              {demo && (
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="when"
                    className="h-5 w-5"
                    checked={when === 'demo-90s'}
                    onChange={() => setWhen('demo-90s')}
                  />
                  In 90 seconds (demo)
                </label>
              )}
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="when"
                  className="h-5 w-5"
                  checked={when === 'default'}
                  onChange={() => setWhen('default')}
                />
                2 hours before the deadline
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="when"
                  className="h-5 w-5"
                  checked={when === 'pick'}
                  onChange={() => setWhen('pick')}
                />
                At a time I pick
              </label>
              {when === 'pick' && (
                <input
                  type="datetime-local"
                  aria-label="Submit time"
                  required
                  className={inputClass}
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                />
              )}
            </fieldset>
            <Button type="submit" disabled={busy}>
              {busy ? 'Checking your file…' : 'Upload and check'}
            </Button>
            {error && (
              <p role="alert" className="text-flare">
                {error}
              </p>
            )}
          </form>
        )}
      </Card>

      <section aria-labelledby="queue-h" className="flex flex-col gap-3">
        <h2 id="queue-h" className="text-lg font-semibold">
          Your hand-ins
        </h2>
        {items.length === 0 ? (
          <p>Nothing yet.</p>
        ) : (
          <ul aria-live="polite" className="flex flex-col gap-3">
            {items.map((s) => (
              <SubmissionItem key={s.id} s={s} onChange={load} />
            ))}
          </ul>
        )}
      </section>

      {demo && (
        <Card className="ring-2 ring-flare/40">
          <h2 className="text-lg font-semibold">Demo: portal failure</h2>
          <p className="mt-1 text-sm">
            Make the demo portal fail on purpose, to show retries and the alert.{' '}
            {fails > 0
              ? `The next ${fails} submit${fails === 1 ? '' : 's'} will fail.`
              : 'The portal is working normally.'}
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" className="flex-1" onClick={() => setFailures(1)}>
              Fail once
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => setFailures(3)}>
              Fail every attempt
            </Button>
            <Button variant="ghost" onClick={() => setFailures(0)}>
              Reset
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

/** For Today: only what needs the student now (hold window open, paused, or failed). */
export function SubmissionAlerts({ initial }: { initial: SubmissionView[] }) {
  const { items, load } = useSubmissions(initial);
  const urgent = items.filter(
    (s) => s.holdOpen || s.status === 'failed' || s.status === 'held' || s.status === 'submitting',
  );
  if (urgent.length === 0) return null;
  return (
    <ul aria-live="assertive" className="flex flex-col gap-3">
      {urgent.map((s) => (
        <SubmissionItem key={s.id} s={s} onChange={load} compact />
      ))}
    </ul>
  );
}
