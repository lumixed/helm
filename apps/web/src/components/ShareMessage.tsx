'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, Field, inputClass } from './ui';

export type Source = 'email' | 'whatsapp' | 'instagram' | 'sms' | 'other';

export interface MessageTemplate {
  id: string;
  label: string;
  source: Source;
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

const SOURCES: { value: Source; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'sms', label: 'Text message' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
];

const blank = (initialText = ''): MessageTemplate => ({
  id: 'blank',
  label: 'Blank',
  // Shared from the phone's share sheet: we can't tell which app it came from.
  source: initialText ? 'other' : 'whatsapp',
  from: '',
  subject: '',
  body: initialText,
});

/**
 * "Share with Helm": paste a message from any app. Helm can't read WhatsApp or Instagram on its
 * own, so the person shares what matters. In demo mode, labelled sample messages fill the form.
 */
export function ShareMessage({
  templates = [],
  initialText = '',
}: {
  templates?: MessageTemplate[];
  initialText?: string;
}) {
  const router = useRouter();
  const demo = templates.length > 0;
  const [draft, setDraft] = useState<MessageTemplate>(
    initialText || !demo ? blank(initialText) : templates[0]!,
  );
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
        source: draft.source,
        from: draft.from || 'Unknown sender',
        subject: draft.subject,
        body: draft.body,
        receivedAt: new Date().toISOString(),
      }),
    });
    const out = (await res.json().catch(() => ({}))) as { inboxMessageId?: string; error?: string };
    if (!res.ok || !out.inboxMessageId) return setError(out.error ?? 'Could not send it.');
    setSentAt(Date.now());
    setInboxId(out.inboxMessageId);
  }

  return (
    <Card className={demo ? 'ring-2 ring-sea-600/30' : ''}>
      <h2 className="text-lg font-semibold">
        {demo ? 'Share with Helm (demo messages)' : 'Share a message with Helm'}
      </h2>
      <p className="mt-1 text-sm">
        Paste a message from WhatsApp, Instagram, texts or anywhere. Helm can&apos;t read those apps
        by itself; it only sees what you share. It reads the message as information, never as
        instructions.
      </p>
      {demo && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Demo messages">
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
          <Button
            variant={draft.id === 'blank' ? 'primary' : 'ghost'}
            aria-pressed={draft.id === 'blank'}
            onClick={() => setDraft(blank())}
            className="text-sm"
          >
            My own
          </Button>
        </div>
      )}
      {demo && draft.id !== 'blank' && (
        <p className="mt-2 text-sm font-medium text-sea-800/80 dark:text-sea-100/80">
          Demo message: made up for the demo, not from a real account.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-3">
        <Field label="Where is it from?" htmlFor="share-source">
          <select
            id="share-source"
            className={inputClass}
            value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value as Source })}
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="From"
          htmlFor="share-from"
          hint="A name is enough, e.g. Landlord or Prof. Lee."
        >
          <input
            id="share-from"
            className={inputClass}
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        {draft.source === 'email' && (
          <Field label="Subject" htmlFor="share-subject">
            <input
              id="share-subject"
              className={inputClass}
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </Field>
        )}
        <Field label="Message" htmlFor="share-body">
          <textarea
            id="share-body"
            rows={5}
            required
            className={inputClass}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </Field>
      </div>
      <Button
        className="mt-3 w-full"
        onClick={send}
        disabled={inboxId !== null || !draft.body.trim()}
      >
        {inboxId ? 'Your agent is reading it…' : 'Send to my agent'}
      </Button>
      <div aria-live="polite" className="mt-3 text-sm">
        {status?.status === 'processed' && (
          <p>
            <strong>{DECISION[status.decision ?? ''] ?? status.decision}.</strong> {status.summary}{' '}
            {status.reason}
            {status.injectionSuspected && (
              <span className="mt-1 block font-medium text-flare">
                This message tried to give the agent instructions. It was treated as plain text.
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
