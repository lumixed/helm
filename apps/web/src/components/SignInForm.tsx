'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, inputClass } from './ui';

export function SignInForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), name: form.get('name') || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? 'Something went wrong. Please try again.');
      return;
    }
    router.push(data.next ?? '/setup');
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate={false}>
      <Field label="Email" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </Field>
      <Field label="Your name" htmlFor="name" hint="Optional. Helm uses it in your morning brief.">
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="given-name"
          maxLength={80}
          className={inputClass}
        />
      </Field>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Setting up your private agent…' : 'Continue'}
      </Button>
      <p className="text-sm text-muted">
        Demo build: there is no password or email check yet. Use fictional data only.
      </p>
    </form>
  );
}
