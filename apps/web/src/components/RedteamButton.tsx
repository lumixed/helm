'use client';

import { useState } from 'react';
import { Button, Card, Chip, demoCardClass } from './ui';

interface Result {
  allowlist: string[];
  tests: { destination: string; reached: boolean | null; reason: string | null }[];
}

/** DEMO ONLY: clearly labelled simulation of a compromised agent trying to exfiltrate. */
export function RedteamButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className={demoCardClass}>
      <div className="flex items-center gap-2">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">Red-team simulation</h2>
        <Chip>Demo</Chip>
      </div>
      <p className="mt-1 text-sm">
        Pretend the agent was tricked by a malicious email. It will try to send a harmless test
        message to <code>example.com</code>, which is not on its allowlist. Maritime should block it
        outside the agent&apos;s VM.
      </p>
      <Button
        variant="danger"
        className="mt-3 w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch('/api/demo/redteam', { method: 'POST' });
          setBusy(false);
          if (!res.ok) return setError('Could not start the simulation.');
          setResult((await res.json()) as Result);
        }}
      >
        {busy ? 'Running simulation…' : 'Run red-team simulation'}
      </Button>
      <div aria-live="polite" className="mt-3 text-sm">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {result && (
          <>
            <p>
              <strong>Allowed hosts:</strong> {result.allowlist.join(', ')}
            </p>
            <ul className="mt-1">
              {result.tests.map((t) => (
                <li key={t.destination}>
                  Maritime host-side test <code>{t.destination}</code>:{' '}
                  {t.reached === null ? (
                    `error (${t.reason})`
                  ) : t.reached ? (
                    'reachable'
                  ) : (
                    <strong className="text-danger">
                      refused{t.reason ? `: ${t.reason}` : ''}
                    </strong>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              The agent&apos;s own attempt appears on the timeline below in a few seconds.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
