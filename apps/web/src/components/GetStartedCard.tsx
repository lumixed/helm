'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SetupStep } from '@/lib/setup-steps';
import { Button, Card, CardTitle } from './ui';

/** First-run checklist on Today. Goes away when everything is done, or when closed. */
export function GetStartedCard({ steps }: { steps: SetupStep[] }) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)?.id;

  async function close() {
    setClosed(true);
    await fetch('/api/setup/dismiss', { method: 'POST' }).catch(() => undefined);
  }

  return (
    <Card>
      <CardTitle aside={`${done} of ${steps.length} done`}>Get Helm ready</CardTitle>
      <ol className="mt-2 flex flex-col divide-y divide-line">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-3 py-2.5">
            <span
              aria-hidden
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${s.done ? 'bg-accent-soft text-ink' : 'border border-line-strong text-muted'}`}
            >
              {s.done ? '✓' : ''}
            </span>
            <span className="min-w-0 flex-1">
              {s.done ? (
                <span className="text-muted">
                  <span className="sr-only">Done: </span>
                  {s.title}
                </span>
              ) : (
                <>
                  <Link
                    href={s.href}
                    className={`underline underline-offset-2 ${s.id === next ? 'font-semibold text-ink' : 'text-ink'}`}
                  >
                    {s.title}
                  </Link>
                  <span className="block text-sm text-muted">{s.why}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
      <Button variant="ghost" className="mt-2 w-fit" onClick={close}>
        Hide this list
      </Button>
    </Card>
  );
}
