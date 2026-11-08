'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, CardTitle, Field, inputClass } from './ui';

/**
 * Canvas calendar import. The feed link works like a password, so it goes only into the
 * person's private agent (encrypted); Helm's servers keep just the school's address.
 */
export function CalendarCard({
  host,
  syncedLabel,
  demo,
}: {
  host: string | null;
  syncedLabel: string | null;
  demo: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function call(method: 'POST' | 'DELETE', body?: object, query = '') {
    setBusy(true);
    setNote(null);
    const res = await fetch(`/api/calendar${query}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setNote(out.error ?? 'Try again.');
    if (method === 'POST')
      setNote('Your agent is reading your calendar. New deadlines appear in Review in a moment.');
    setUrl('');
    router.refresh();
  }
  return (
    <Card>
      <CardTitle>Canvas calendar</CardTitle>
      {host ? (
        <>
          <p className="text-sm text-ink-soft">
            Connected to <strong>{host}</strong>
            {syncedLabel ? `; last synced ${syncedLabel}` : ''}. Your agent checks it every hour.
            New deadlines go to Review; if Canvas moves one, Helm updates your plan and tells you.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => call('POST', undefined, '?action=sync')}
            >
              Sync now
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => call('DELETE')}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void call('POST', { url });
          }}
        >
          <p className="text-sm text-ink-soft">
            Bring in every Canvas deadline automatically. The link works like a password, so it goes
            only into your private agent, encrypted.
          </p>
          <Field
            label="Calendar feed link"
            htmlFor="cal-url"
            hint="In Canvas: Calendar → Calendar Feed (bottom right) → copy the link."
          >
            <input
              id="cal-url"
              type="url"
              inputMode="url"
              placeholder="https://yourschool.instructure.com/feeds/calendars/user_….ics"
              className={inputClass}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" disabled={busy || !url.trim()}>
              Connect Canvas
            </Button>
            {demo && (
              <Button
                type="button"
                variant="tertiary"
                disabled={busy}
                onClick={() => call('POST', { demo: true })}
              >
                Use the demo portal&apos;s calendar
              </Button>
            )}
          </div>
        </form>
      )}
      {note && (
        <p aria-live="polite" className="mt-2 text-sm">
          {note}
        </p>
      )}
    </Card>
  );
}
