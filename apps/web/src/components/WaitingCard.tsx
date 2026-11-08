'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banner, Button, Card, CardTitle, Chip } from './ui';

export interface WaitingRow {
  id: string;
  summary: string;
  toName: string;
  subject: string;
  daysAgo: number;
  drafted: boolean;
}

/**
 * Mail the person sent that is still waiting for a reply (found by their agent in Gmail).
 * "Draft a nudge" saves a follow-up in Gmail Drafts; Helm never sends it.
 */
export function WaitingCard({ rows }: { rows: WaitingRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [asked, setAsked] = useState<Record<string, 'writing' | 'late'>>({});
  const [error, setError] = useState<string | null>(null);

  async function nudge(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/waiting/${id}`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      return setError(out.error ?? 'Try again in a moment.');
    }
    setAsked((a) => ({ ...a, [id]: 'writing' }));
    // The agent usually saves the draft within seconds.
    setTimeout(() => router.refresh(), 6000);
    setTimeout(() => {
      router.refresh();
      setAsked((a) => ({ ...a, [id]: 'late' }));
    }, 15000);
  }

  async function done(id: string) {
    setBusy(id);
    await fetch(`/api/waiting/${id}`, { method: 'DELETE' });
    setBusy(null);
    router.refresh();
  }

  return (
    <Card>
      <CardTitle aside="From your Gmail">Waiting on</CardTitle>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((w) => (
          <li key={w.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="font-medium text-ink">{w.summary}</p>
              <p className="text-sm text-muted">
                To {w.toName} · “{w.subject}” · {w.daysAgo} day{w.daysAgo === 1 ? '' : 's'}, no
                reply
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {w.drafted ? (
                <Chip tone="ok">Follow-up draft in your Gmail</Chip>
              ) : asked[w.id] === 'writing' ? (
                <Chip tone="accent">Your agent is writing a draft…</Chip>
              ) : asked[w.id] === 'late' ? (
                <span className="text-sm text-muted">
                  No draft yet. Check the{' '}
                  <a href="/timeline" className="font-medium text-ink underline underline-offset-4">
                    Timeline
                  </a>{' '}
                  (Gmail may need reconnecting).
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === w.id}
                  onClick={() => nudge(w.id)}
                  aria-label={`Draft a follow-up: ${w.summary}`}
                >
                  Draft a nudge
                </Button>
              )}
              <Button
                size="sm"
                variant="tertiary"
                disabled={busy === w.id}
                onClick={() => done(w.id)}
                aria-label={`Done: ${w.summary}`}
              >
                Done
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">
        Your agent reads your sent mail inside its private VM. Drafts go to Gmail for you to check
        and send; Helm never sends email.
      </p>
      {error && (
        <Banner tone="danger" role="alert" className="mt-3">
          {error}
        </Banner>
      )}
    </Card>
  );
}
