'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ChangeView } from '@/lib/inbox';
import { Button, Card, inputClass } from './ui';

interface Option {
  id: string;
  label: string;
}

/**
 * Changes Helm found in email (PRD M6). Pending ones wait for one tap; applied ones show where
 * they came from ("Prof. Lee's email, Sat 9:14 a.m.") so no change is ever a mystery.
 */
export function ChangesCard({
  pending,
  applied,
  assignments,
}: {
  pending: ChangeView[];
  applied: ChangeView[];
  assignments: Option[];
}) {
  if (pending.length === 0 && applied.length === 0) return null;
  return (
    <Card className={pending.length ? 'ring-2 ring-warn/30' : ''}>
      <h2 className="text-[17px] font-semibold tracking-tight text-ink">
        {pending.length
          ? `Helm found ${pending.length} change${pending.length === 1 ? '' : 's'} to check`
          : 'Recent changes from email'}
      </h2>
      {pending.length > 0 && (
        <ul className="mt-3 flex flex-col gap-4">
          {pending.map((c) => (
            <PendingItem key={c.id} c={c} assignments={assignments} />
          ))}
        </ul>
      )}
      {applied.length > 0 && (
        <>
          {pending.length > 0 && <h3 className="mt-5 font-medium">Already updated</h3>}
          <ul className="mt-2 flex flex-col gap-3">
            {applied.map((c) => (
              <li key={c.id}>
                <p className="font-medium">
                  {c.courseCode && <span className="text-muted">{c.courseCode} · </span>}
                  {c.title}: {c.label} {c.from ? `${c.from} → ` : ''}
                  {c.to}
                </p>
                <Provenance c={c} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Provenance({ c }: { c: ChangeView }) {
  return (
    <p className="text-sm text-muted">
      From {c.sender}
      {c.channel && c.channel !== 'email' ? ` (${c.channel}, shared by you)` : ''}
      {c.receivedLabel ? `, ${c.receivedLabel}` : ''}
      {c.evidence && (
        <>
          {' '}
          · <q className="italic">{c.evidence}</q>
        </>
      )}
    </p>
  );
}

function PendingItem({ c, assignments }: { c: ChangeView; assignments: Option[] }) {
  const router = useRouter();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPick = !c.assignmentId;
  const act = async (action: 'apply' | 'dismiss') => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/changes/${c.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...(needsPick && pick ? { assignmentId: pick } : {}) }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Try again.');
      return;
    }
    router.refresh();
  };
  const selectId = `pick-${c.id}`;
  return (
    <li className="flex flex-col gap-2">
      <p className="font-medium">
        {c.title ? (
          <>
            {c.courseCode && <span className="text-muted">{c.courseCode} · </span>}
            {c.title}:{' '}
          </>
        ) : (
          'An assignment: '
        )}
        {c.label} {c.from ? `${c.from} → ` : ''}
        <strong>{c.to}</strong>
      </p>
      <Provenance c={c} />
      {c.reason && <p className="text-sm">{c.reason}</p>}
      {needsPick && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={selectId} className="text-sm font-medium">
            Which assignment does this email mean?
          </label>
          <select
            id={selectId}
            className={inputClass}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Choose…</option>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={busy || (needsPick && !pick)}
          onClick={() => act('apply')}
        >
          {c.kind === 'cancelled' ? 'Mark cancelled' : 'Apply change'}
        </Button>
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => act('dismiss')}>
          Ignore
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
