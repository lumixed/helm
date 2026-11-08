'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Field, fileInputClass, inputClass, textareaClass } from './ui';

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'reading'; intakeId: string; fileName: string; since: number }
  | { kind: 'error'; message: string };

export function SyllabusUpload() {
  const router = useRouter();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (phase.kind !== 'reading') return;
    const t = setInterval(async () => {
      setElapsed(Math.round((Date.now() - phase.since) / 1000));
      const res = await fetch(`/api/onboarding/intake/${phase.intakeId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const s = (await res.json()) as { status: string; message?: string };
      if (s.status === 'done') router.push(`/review?intake=${phase.intakeId}`);
      if (s.status === 'error')
        setPhase({ kind: 'error', message: s.message ?? 'Your agent could not read that file.' });
    }, 2000);
    return () => clearInterval(t);
  }, [phase, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPhase({ kind: 'sending' });
    const res =
      mode === 'file'
        ? await fetch('/api/onboarding/syllabus', { method: 'POST', body: f })
        : await fetch('/api/onboarding/syllabus', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: f.get('text'), courseHint: f.get('courseHint') }),
          });
    const data = (await res.json().catch(() => ({}))) as {
      intakeId?: string;
      fileName?: string;
      error?: string;
    };
    if (!res.ok || !data.intakeId) {
      setPhase({ kind: 'error', message: data.error ?? 'Upload failed. Please try again.' });
      return;
    }
    setElapsed(0);
    setPhase({
      kind: 'reading',
      intakeId: data.intakeId,
      fileName: data.fileName ?? 'your document',
      since: Date.now(),
    });
  }

  const busy = phase.kind === 'sending' || phase.kind === 'reading';
  return (
    <Card>
      <div role="tablist" aria-label="How to add a document" className="mb-4 flex gap-2">
        {(['file', 'paste'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            disabled={busy}
            className={`min-h-11 flex-1 rounded-xl px-3 font-medium ring-1 ring-line-strong ${mode === m ? 'bg-ink text-white' : ''}`}
          >
            {m === 'file' ? 'Upload a file' : 'Paste text'}
          </button>
        ))}
      </div>
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
        {mode === 'file' ? (
          <Field
            label="Document file"
            htmlFor="file"
            hint="PDF, Word (.docx) or text, up to 10 MB."
          >
            <input
              id="file"
              name="file"
              type="file"
              required
              accept=".pdf,.docx,.txt,.md"
              disabled={busy}
              className={fileInputClass}
            />
          </Field>
        ) : (
          <Field
            label="Document text"
            htmlFor="text"
            hint="Paste the whole thing, including any schedule or dates."
          >
            <textarea
              id="text"
              name="text"
              required
              minLength={40}
              rows={8}
              disabled={busy}
              className={`${textareaClass} min-h-40`}
            />
          </Field>
        )}
        <Field
          label="Area (optional)"
          htmlFor="courseHint"
          hint='e.g. "DATA 210", "Work" or "Rent". Helps group what Helm finds.'
        >
          <input
            id="courseHint"
            name="courseHint"
            maxLength={100}
            disabled={busy}
            className={inputClass}
          />
        </Field>
        <div aria-live="polite">
          {phase.kind === 'reading' && (
            <p className="rounded-xl bg-accent-soft px-3 py-2 text-ink">
              Your agent is reading {phase.fileName}… ({elapsed}s, usually under 30s)
              {elapsed > 90 && ' This is taking longer than usual; the AI service may be busy.'}
            </p>
          )}
          {phase.kind === 'error' && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-danger">
              {phase.message}
            </p>
          )}
        </div>
        <Button type="submit" disabled={busy}>
          {phase.kind === 'sending'
            ? 'Sending to your agent…'
            : phase.kind === 'reading'
              ? 'Reading…'
              : 'Read my document'}
        </Button>
        <p className="text-sm text-muted">
          The file goes only to your private agent. Helm keeps the deadlines it finds, not the file.
        </p>
      </form>
    </Card>
  );
}
