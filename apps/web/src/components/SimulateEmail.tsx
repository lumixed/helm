'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, Field, inputClass } from './ui';

export interface EmailTemplate {
  id: string;
  label: string;
  from: string;
  subject: string;
  body: string;
}

interface Status {
  status: string;
  decision: string | null;
  reason: string | null;
  summary: string | null;
  injectionSuspected: boolean;
}

const DECISION: Record<string, string> = {
  applied: 'Applied',
  needs_confirmation: 'Waiting for your OK',
  review: 'Added to your review list',
  ignored: 'No change',
};

/** DEMO ONLY: send a made-up email to your agent, as if it arrived in your inbox. */
export function SimulateEmail({ templates }: { templates: EmailTemplate[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(templates[0]!);
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);

  useEffect(() => {
    if (!inboxId) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/inbox/${inboxId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const s = (await res.json()) as Status;
      setStatus(s);
      if (s.status === 'processed' || s.status === 'failed') {
        setInboxId(null);
        router.refresh();
      } else if (Date.now() - sentAt > 120_000) {
        setInboxId(null);
        setError('Your agent has not answered yet. Check the timeline.');
      }
    }, 2000);
    return () => clearInterval(t);
  }, [inboxId, sentAt, router]);

  async function send() {
    setError(null);
    setStatus(null);
    const res = await fetch('/api/inbox/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: draft.from,
        subject: draft.subject,
        body: draft.body,
        receivedAt: new Date().toISOString(),
      }),
    });
    const out = (await res.json().catch(() => ({}))) as { inboxMessageId?: string; error?: string };
    if (!res.ok || !out.inboxMessageId) return setError(out.error ?? 'Could not send the email.');
    setSentAt(Date.now());
    setInboxId(out.inboxMessageId);
  }

  return (
    <Card className="ring-2 ring-sea-600/30">
      <h2 className="text-lg font-semibold">Demo: simulate an email</h2>
      <p className="mt-1 text-sm">
        Made-up emails for the demo. Your agent reads them as data and decides what changed.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Email templates">
        {templates.map((t) => (
          <Button
            key={t.id}
            variant={t.id === draft.id ? 'primary' : 'ghost'}
            aria-pressed={t.id === draft.id}
            onClick={() => setDraft(t)}
            className="text-sm"
          >
            {t.label}
          </Button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <Field label="From" htmlFor="sim-from">
          <input
            id="sim-from"
            className={inputClass}
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label="Subject" htmlFor="sim-subject">
          <input
            id="sim-subject"
            className={inputClass}
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
          />
        </Field>
        <Field label="Email" htmlFor="sim-body">
          <textarea
            id="sim-body"
            rows={5}
            className={inputClass}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </Field>
      </div>
      <Button className="mt-3 w-full" onClick={send} disabled={inboxId !== null}>
        {inboxId ? 'Your agent is reading it…' : 'Send to my agent'}
      </Button>
      <div aria-live="polite" className="mt-3 text-sm">
        {status?.status === 'processed' && (
          <p>
            <strong>{DECISION[status.decision ?? ''] ?? status.decision}.</strong> {status.summary}{' '}
            {status.reason}
            {status.injectionSuspected && (
              <span className="mt-1 block font-medium text-flare">
                This email tried to give the agent instructions. It was treated as plain text.
              </span>
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="text-flare">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
