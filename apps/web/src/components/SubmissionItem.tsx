'use client';

import { useState } from 'react';
import type { SubmissionView } from '@/lib/submissions';
import { Button } from './ui';

const STATUS: Record<string, { label: string; tone: string }> = {
  ready: { label: 'Checked, not scheduled', tone: 'bg-sea-100 text-sea-950' },
  checks_failed: { label: 'Needs a fix', tone: 'bg-flare/15 text-flare' },
  scheduled: { label: 'Scheduled', tone: 'bg-sea-100 text-sea-950' },
  held: { label: 'On hold', tone: 'bg-amber-100 text-amber-950' },
  submitting: { label: 'Submitting…', tone: 'bg-sea-600 text-white' },
  submitted: { label: 'Submitted', tone: 'bg-emerald-100 text-emerald-950' },
  failed: { label: 'NOT submitted', tone: 'bg-flare text-white' },
};

const MARK = { pass: '✓', warn: '!', fail: '✕' } as const;

/** One submission with the one or two actions that make sense right now. */
export function SubmissionItem({
  s,
  onChange,
  compact = false,
}: {
  s: SubmissionView;
  onChange: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const warns = s.checks.filter((c) => c.status === 'warn');
  const act = async (action: string, body: object = {}) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/submissions/${s.id}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok)
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Try again.');
    onChange();
  };
  const st = STATUS[s.status] ?? { label: s.status, tone: 'bg-sea-100 text-sea-950' };
  const ackId = `ack-${s.id}`;

  return (
    <li
      className={`flex flex-col gap-2 rounded-xl p-4 ring-1 ${s.status === 'failed' ? 'ring-2 ring-flare' : s.holdOpen ? 'ring-2 ring-amber-400' : 'ring-sea-100 dark:ring-sea-600'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">
          {s.courseCode && (
            <span className="text-sea-600 dark:text-sea-100">{s.courseCode} · </span>
          )}
          {s.title}
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${st.tone}`}>
          {st.label}
        </span>
      </div>
      <p className="text-sm text-sea-800/80 dark:text-sea-100/80">
        {s.fileName} · {(s.fileSize / 1024).toFixed(0)} KB · due {s.dueLabel ?? '—'}
      </p>

      {s.holdOpen && (
        <div role="alert" className="rounded-xl bg-amber-100 px-3 py-2 text-amber-950">
          <p className="font-medium">Last chance: Helm submits this at {s.submitLabel}.</p>
          <p className="text-sm">Hold it, send it now, or leave it and Helm will go ahead.</p>
        </div>
      )}
      {s.status === 'scheduled' && !s.holdOpen && (
        <p className="text-sm">
          Helm submits it {s.submitLabel}
          {s.submitAtFromDefault ? ' (2 hours before the deadline)' : ''}. You&apos;ll get a hold
          notice first.
          {s.attempts > 0 && s.lastError && (
            <span className="block text-flare">
              Attempt {s.attempts} failed: {s.lastError} Helm will try again.
            </span>
          )}
        </p>
      )}
      {s.status === 'held' && (
        <p className="text-sm">
          {s.lastError ?? 'Nothing will be submitted until you release it.'}
        </p>
      )}
      {s.status === 'failed' && (
        <div role="alert" className="text-sm">
          <p className="font-medium text-flare">{s.lastError}</p>
          <p>
            Submit it yourself now on the{' '}
            <a href="/mock-portal" className="font-medium underline underline-offset-4">
              demo portal
            </a>
            .
          </p>
        </div>
      )}
      {s.receipt && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
          <dt className="font-medium">Confirmation</dt>
          <dd>{s.receipt.confirmationId}</dd>
          <dt className="font-medium">Submitted</dt>
          <dd>{s.receipt.submittedLabel}</dd>
          <dt className="font-medium">File hash</dt>
          <dd className="truncate font-mono" title={s.receipt.fileSha256}>
            {s.receipt.fileSha256.slice(0, 16)}…
          </dd>
        </dl>
      )}

      {!compact && (s.status === 'ready' || s.status === 'checks_failed') && (
        <ul className="flex flex-col gap-1 text-sm">
          {s.checks.map((c) => (
            <li key={c.check} className={c.status === 'fail' ? 'text-flare' : ''}>
              <span aria-hidden className="inline-block w-5 font-semibold">
                {MARK[c.status]}
              </span>
              <span className="sr-only">{c.status}: </span>
              {c.message}
            </li>
          ))}
        </ul>
      )}

      {s.status === 'ready' && (
        <div className="flex flex-col gap-2">
          {warns.length > 0 && (
            <label htmlFor={ackId} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                id={ackId}
                type="checkbox"
                className="h-5 w-5"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              I checked the warnings above.
            </label>
          )}
          <p className="text-sm">
            Scheduling is your OK for Helm to submit <strong>this exact file</strong> at{' '}
            {s.submitLabel}.
          </p>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={busy || (warns.length > 0 && !ack)}
              onClick={() => act('schedule', { ackWarnings: ack })}
            >
              Schedule submission
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => act('cancel')}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {s.status === 'scheduled' && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={s.holdOpen ? 'primary' : 'ghost'}
            className="flex-1"
            disabled={busy}
            onClick={() => act('hold')}
          >
            Hold
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => act('submit-now')}
          >
            Submit now
          </Button>
          {s.holdOpen ? (
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={onChange}>
              Leave it
            </Button>
          ) : (
            <Button variant="danger" disabled={busy} onClick={() => act('cancel')}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {s.status === 'held' && (
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => act('release')}>
            Release
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => act('submit-now')}
          >
            Submit now
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => act('cancel')}>
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-flare">
          {error}
        </p>
      )}
    </li>
  );
}
