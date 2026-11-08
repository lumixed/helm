'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card } from './ui';

const RESULT: Record<string, { text: string; bad?: boolean }> = {
  connected: { text: 'Gmail connected. Your agent is reading your recent mail now.' },
  cancelled: { text: 'Gmail was not connected.', bad: true },
  error: { text: 'Could not connect Gmail. Try again.', bad: true },
};

/** Real Gmail, read-only. The token lives only in the user's agent, never on Helm's servers. */
export function GmailCard({ address, result }: { address: string | null; result?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const banner = result ? RESULT[result] : undefined;
  return (
    <Card>
      <h2 className="text-[17px] font-semibold tracking-tight text-ink">Email</h2>
      {banner && (
        <p role="status" className={`mt-1 text-sm ${banner.bad ? 'text-danger' : ''}`}>
          {banner.text}
        </p>
      )}
      {address ? (
        <>
          <p className="mt-1">
            Reading <strong>{address}</strong> (read-only for reading). Your agent checks it every
            15 minutes and saves email drafts only when you ask in chat. The access key lives only
            in your private agent, not on Helm&apos;s servers, and emails never leave it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await fetch('/api/gmail/sync', { method: 'POST' });
                setBusy(false);
                setMsg(
                  res.ok
                    ? 'Checking now. New items appear here and on your timeline.'
                    : 'Could not reach your agent.',
                );
              }}
            >
              Check Gmail now
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await fetch('/api/gmail/sync', { method: 'DELETE' });
                setBusy(false);
                router.refresh();
              }}
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1">
            Let your agent read your Gmail and today’s calendar (read-only) to catch deadlines,
            bills and appointments, and save email drafts you ask for. Google&apos;s permission
            screen says &ldquo;send&rdquo; because drafts and sending share one permission; Helm
            only ever saves drafts, and never sends or deletes anything.
          </p>
          <a
            href="/api/gmail/connect"
            className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-2 font-medium text-white hover:bg-ink"
          >
            Connect Gmail
          </a>
        </>
      )}
      {msg && (
        <p aria-live="polite" className="mt-2 text-sm">
          {msg}
        </p>
      )}
    </Card>
  );
}
