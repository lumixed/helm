'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { HelmMark } from '@/components/icons';
import { Button, buttonClass } from '@/components/ui';

/** Shown when a page fails to load. Plain words, a retry, and a way back; no stack traces. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-5 text-center"
    >
      <HelmMark width={32} height={32} className="text-ink" />
      <h1 className="text-title font-normal tracking-tight text-ink">Something went wrong</h1>
      <p className="text-muted" role="alert">
        This page couldn&apos;t load just now. Try again in a moment.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/today" className={buttonClass('secondary')}>
          Go to Today
        </Link>
      </div>
      {error.digest && <p className="text-xs text-muted">Reference: {error.digest}</p>}
    </main>
  );
}
