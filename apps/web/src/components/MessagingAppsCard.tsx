'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AppView } from '@/lib/desktop';
import { Button, Card, CardTitle, Chip } from './ui';

const STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'accent' | 'warn' | 'ok' | 'danger' }
> = {
  disconnected: { label: 'Not connected', tone: 'neutral' },
  linking: { label: 'Waiting for your login', tone: 'accent' },
  linked: { label: 'Connected', tone: 'ok' },
  needs_login: { label: 'Logged out', tone: 'warn' },
  error: { label: 'Needs attention', tone: 'danger' },
};

/**
 * WhatsApp and Instagram through the person's own private Maritime desktop. They log in
 * themselves (takeover link); Helm only reads the chat list and never opens, types or sends.
 */
export function MessagingAppsCard({ initial }: { initial: AppView[] }) {
  const [apps, setApps] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const res = await fetch('/api/desktop', { cache: 'no-store' });
    if (res.ok) setApps(((await res.json()) as { apps: AppView[] }).apps);
  }, []);
  const waiting = apps.some((a) => a.status === 'linking');
  useEffect(() => {
    const t = setInterval(load, waiting ? 5000 : 60_000);
    return () => clearInterval(t);
  }, [load, waiting]);

  async function run(app: string, method: 'POST' | 'DELETE', action?: 'connect' | 'check') {
    setBusy(app);
    const res = await fetch(`/api/desktop/${app}${action ? `?action=${action}` : ''}`, { method });
    const out = (await res.json().catch(() => ({}))) as {
      url?: string;
      instructions?: string;
      error?: string;
      outcome?: string;
      newMessages?: number;
    };
    setBusy(null);
    if (!res.ok) setNote((n) => ({ ...n, [app]: out.error ?? 'Try again.' }));
    else if (out.url) {
      window.open(out.url, '_blank', 'noopener');
      setNote((n) => ({ ...n, [app]: `A login window opened. ${out.instructions ?? ''}` }));
    } else if (action === 'check')
      setNote((n) => ({
        ...n,
        [app]:
          out.outcome === 'checked'
            ? out.newMessages
              ? `${out.newMessages} new message${out.newMessages === 1 ? '' : 's'} sent to your agent.`
              : 'Nothing new.'
            : out.outcome === 'person_in_control'
              ? 'You still have control of the desktop. Click Done in the login window.'
              : `Not readable right now (${out.outcome?.replace('_', ' ')}).`,
      }));
    await load();
  }

  return (
    <Card>
      <CardTitle>Messaging apps</CardTitle>
      <p className="text-sm text-ink-soft">
        Helm reads new messages through your own private browser on Maritime. You log in yourself;
        Helm never sees your password. It only reads the chat list: it never opens a chat, types or
        sends. Prototype: WhatsApp and Instagram limit automated use, so a test account is safest.
      </p>
      <ul className="mt-3 flex flex-col gap-4">
        {apps.map((a) => (
          <li key={a.app} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-ink">
                {a.label}
                {a.beta && <span className="ml-2 text-sm font-normal">(beta, untested)</span>}
              </p>
              <Chip tone={STATUS[a.status]?.tone ?? 'neutral'}>
                {STATUS[a.status]?.label ?? a.status}
              </Chip>
            </div>
            {a.status === 'linked' && (
              <p className="text-sm">
                Reading new messages regularly
                {a.lastCheckLabel ? `; last checked ${a.lastCheckLabel}` : ''}.
              </p>
            )}
            {a.status === 'linking' && (
              <p className="text-sm">
                {a.instructions} Helm checks every 20 seconds whether you&apos;re in.
              </p>
            )}
            {a.lastError && a.status !== 'linked' && (
              <p className="text-sm text-danger">{a.lastError}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {a.status === 'linked' ? (
                <>
                  <Button
                    variant="ghost"
                    disabled={busy === a.app}
                    onClick={() => run(a.app, 'POST', 'check')}
                  >
                    Check now
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy === a.app}
                    onClick={() => run(a.app, 'DELETE')}
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    disabled={busy === a.app}
                    onClick={() => run(a.app, 'POST', 'connect')}
                  >
                    {a.status === 'linking' ? 'Open the login again' : `Connect ${a.label}`}
                  </Button>
                  {a.status !== 'disconnected' && (
                    <Button
                      variant="ghost"
                      disabled={busy === a.app}
                      onClick={() => run(a.app, 'DELETE')}
                    >
                      Cancel
                    </Button>
                  )}
                </>
              )}
            </div>
            {note[a.app] && (
              <p aria-live="polite" className="text-sm">
                {note[a.app]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
