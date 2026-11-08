'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banner, Button } from './ui';

/** Wakes the agent to write the review now, then waits for it to arrive. */
export function WeeklyReviewButton({ label = 'Write my review now' }: { label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'waiting' | 'slow' | 'error'>('idle');
  const [error, setError] = useState('');

  async function run() {
    setState('waiting');
    const res = await fetch('/api/review/weekly', { method: 'POST' });
    const out = (await res.json().catch(() => ({}))) as { requestedAt?: string; error?: string };
    if (!res.ok || !out.requestedAt) {
      setError(out.error ?? 'Could not reach your agent.');
      return setState('error');
    }
    const since = Date.parse(out.requestedAt) - 1000;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = (await (await fetch('/api/review/weekly', { cache: 'no-store' })).json()) as {
        latest: { createdAt: string } | null;
      };
      if (s.latest && Date.parse(s.latest.createdAt) >= since) {
        setState('idle');
        return router.refresh();
      }
    }
    setState('slow');
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" onClick={run} disabled={state === 'waiting'}>
        {state === 'waiting' ? 'Your agent is writing it…' : label}
      </Button>
      {state === 'slow' && (
        <Banner role="status">Still writing. It will appear here and on your phone shortly.</Banner>
      )}
      {state === 'error' && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
    </div>
  );
}
