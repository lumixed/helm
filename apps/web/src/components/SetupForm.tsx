'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button, Field, inputClass } from './ui';

interface Profile {
  name: string;
  timezone: string;
  briefTimeLocal: string;
  channel: 'in_app' | 'telegram';
  onboarded: boolean;
}

export function SetupForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [profile.timezone];
    }
  }, [profile.timezone]);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // First visit: suggest the device's timezone.
  useEffect(() => {
    if (!profile.onboarded)
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || profile.timezone);
  }, [profile.onboarded, profile.timezone]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: f.get('name'),
        timezone: f.get('timezone'),
        briefTimeLocal: f.get('briefTimeLocal'),
        channel: f.get('channel'),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: 'error', text: data.error ?? 'Could not save. Please try again.' });
      return;
    }
    setMessage({ kind: 'ok', text: 'Saved.' });
    if (!profile.onboarded) router.push('/today');
    else router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field label="Name" htmlFor="name">
        <input
          id="name"
          name="name"
          defaultValue={profile.name}
          maxLength={80}
          autoComplete="given-name"
          className={inputClass}
        />
      </Field>
      <Field label="Timezone" htmlFor="timezone" hint="Deadlines and your brief use this timezone.">
        <select
          id="timezone"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className={inputClass}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Morning brief time"
        htmlFor="briefTimeLocal"
        hint="Helm wakes up and tells you what to do today."
      >
        <input
          id="briefTimeLocal"
          name="briefTimeLocal"
          type="time"
          required
          defaultValue={profile.briefTimeLocal}
          className={inputClass}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Where should Helm reach you?</legend>
        <label className="flex min-h-11 items-center gap-3 rounded-xl px-3 ring-1 ring-sea-600/30">
          <input
            type="radio"
            name="channel"
            value="in_app"
            defaultChecked={profile.channel === 'in_app'}
            className="h-5 w-5"
          />
          In the Helm app only
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-xl px-3 ring-1 ring-sea-600/30">
          <input
            type="radio"
            name="channel"
            value="telegram"
            defaultChecked={profile.channel === 'telegram'}
            className="h-5 w-5"
          />
          Telegram too (you link it in the next step)
        </label>
      </fieldset>
      <div aria-live="polite">
        {message && (
          <p
            role={message.kind === 'error' ? 'alert' : undefined}
            className={
              message.kind === 'error' ? 'text-flare' : 'text-emerald-700 dark:text-emerald-400'
            }
          >
            {message.text}
          </p>
        )}
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : profile.onboarded ? 'Save settings' : 'Continue'}
      </Button>
    </form>
  );
}
