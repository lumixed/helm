'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { IconCheck } from './icons';

/** Mark an item done (or undo). Feeds the brief and the weekly review's "Finished" list. */
export function DoneButton({
  id,
  title,
  initialDone = false,
}: {
  id: string;
  title: string;
  initialDone?: boolean;
}) {
  const router = useRouter();
  const [done, setDone] = useState(initialDone);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const next = !done;
    const res = await fetch(`/api/assignments/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next ? { status: 'done', progressPct: 100 } : { status: 'todo' }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(next);
      router.refresh();
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={done}
      aria-label={done ? `Mark ${title} not done` : `Mark ${title} done`}
      className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
        done
          ? 'border-ok/30 bg-ok-soft text-ok'
          : 'border-line-strong bg-surface text-ink hover:bg-canvas'
      }`}
    >
      <IconCheck width={14} height={14} />
      {done ? 'Done' : 'Mark done'}
    </button>
  );
}
