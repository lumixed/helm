'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card } from './ui';

/** Connect Telegram, so the morning brief and last-chance notices reach the student's phone. */
export function TelegramCard({ linked }: { linked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/telegram/link', { method: 'POST' });
    setBusy(false);
    const out = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !out.url) return setError(out.error ?? 'Could not reach Telegram.');
    window.open(out.url, '_blank', 'noopener');
    setOpened(true);
  }
  async function disconnect() {
    setBusy(true);
    await fetch('/api/telegram/link', { method: 'DELETE' });
    setBusy(false);
    router.refresh();
  }
  return (
    <Card>
      <h2 className="text-[17px] font-semibold tracking-tight text-ink">Your phone</h2>
      {linked ? (
        <>
          <p className="mt-1">
            Telegram is connected. Your morning brief, last-chance notices and alerts arrive there.
          </p>
          <Button variant="ghost" className="mt-3" disabled={busy} onClick={disconnect}>
            Disconnect Telegram
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1">
            Get your morning brief and last-chance notices on Telegram, with Hold and Hand in now
            buttons.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={connect}>
              Connect Telegram
            </Button>
            {opened && (
              <Button variant="ghost" onClick={() => router.refresh()}>
                I tapped Start
              </Button>
            )}
          </div>
          {opened && <p className="mt-2 text-sm">In Telegram, tap Start. Then come back here.</p>}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
