'use client';

import { useState } from 'react';
import type { SubmissionView } from '@/lib/submissions';
import { Button, Chip, type Tone } from './ui';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ready: { label: 'Checked, not scheduled', tone: 'neutral' },
  checks_failed: { label: 'Needs a fix', tone: 'danger' },
  scheduled: { label: 'Scheduled', tone: 'accent' },
  held: { label: 'On hold', tone: 'warn' },
  submitting: { label: 'Submitting…', tone: 'accent' },
  submitted: { label: 'Submitted', tone: 'ok' },
  failed: { label: 'NOT submitted', tone: 'danger' },
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
  const st = STATUS[s.status] ?? { label: s.status, tone: 'neutral' as Tone };
  const ackId = `ack-${s.id}`;

  return (
    <li
      className={`flex flex-col gap-2 rounded-xl p-4 ring-1 ${s.status === 'failed' ? 'ring-2 ring-danger' : s.holdOpen ? 'ring-2 ring-warn/30' : 'ring-line'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">
          {s.courseCode && <span className="text-muted">{s.courseCode} · </span>}
          {s.title}
        </p>
        <Chip tone={st.tone}>{st.label}</Chip>
      </div>
      <p className="text-sm text-muted">
        {s.fileName} · {(s.fileSize / 1024).toFixed(0)} KB · due {s.dueLabel ?? '—'}
      </p>

      {s.holdOpen && (
        <div role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-ink">
          <p className="font-medium">Last chance: Helm submits this at {s.submitLabel}.</p>
          <p className="text-sm">Hold it, send it now, or leave it and Helm will go ahead.</p>
        </div>
      )}
      {s.status === 'scheduled' && !s.holdOpen && (
        <p className="text-sm">
          Helm submits it {s.submitLabel}
          {s.submitAtFromDefault ? ' (2 hours before the deadline)' : ''}
          {/* Dates like "6:51 p.m." already end with a period. */}
          {(s.submitAtFromDefault || !s.submitLabel?.endsWith('.')) && '.'} You&apos;ll get a hold
          notice first.
          {s.attempts > 0 && s.lastError && (
            <span className="block text-danger">
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
          <p className="font-medium text-danger">{s.lastError}</p>
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
            <li key={c.check} className={c.status === 'fail' ? 'text-danger' : ''}>
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
              size="sm"
              className="flex-1"
              disabled={busy || (warns.length > 0 && !ack)}
              onClick={() => act('schedule', { ackWarnings: ack })}
            >
              Schedule submission
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('cancel')}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {s.status === 'scheduled' && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={s.holdOpen ? 'primary' : 'ghost'}
            className="flex-1"
            disabled={busy}
            onClick={() => act('hold')}
          >
            Hold
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => act('submit-now')}
          >
            Submit now
          </Button>
          {s.holdOpen ? (
            <Button size="sm" variant="ghost" className="flex-1" disabled={busy} onClick={onChange}>
              Leave it
            </Button>
          ) : (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => act('cancel')}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {s.status === 'held' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => act('release')}>
            Release
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => act('submit-now')}
          >
            Submit now
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => act('cancel')}>
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
