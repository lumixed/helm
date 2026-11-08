import { redirect } from 'next/navigation';
import { HelmMark, IconShield } from '@/components/icons';
import { SignInForm } from '@/components/SignInForm';
import { Card } from '@/components/ui';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const LAYERS = [
  {
    title: 'Its own computer',
    body: 'Your agent runs in a private VM on Maritime. Nobody else’s agent shares it.',
  },
  {
    title: 'Can only reach what it needs',
    body: 'A network allowlist, enforced outside the agent, blocks every other site.',
  },
  {
    title: 'Asks before it acts',
    body: 'Nothing is handed in without your tap, and you can hold it until the last minute.',
  },
];

export default async function SignInPage() {
  const user = await currentUser();
  if (user) redirect(user.onboardedAt ? '/today' : '/setup');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5">
      <header className="flex h-16 items-center gap-2 text-ink">
        <HelmMark />
        <span className="text-[17px] font-semibold tracking-tight">Helm</span>
      </header>

      <section className="flex flex-col items-center gap-6 pt-10 pb-12 text-center sm:pt-20">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-soft">
          <IconShield width={14} height={14} />
          Private by design, built on Maritime
        </span>
        <h1 className="max-w-3xl text-[40px] leading-[46px] font-normal tracking-[-1.2px] text-ink sm:text-[64px] sm:leading-[72px] sm:tracking-[-2.4px]">
          Your private assistant for everything you owe.
        </h1>
        <p className="max-w-xl text-lg text-muted sm:text-xl">
          Helm reads your email and the messages you share with it, tells you each morning what to
          do today, and handles routine hand-ins with your OK.
        </p>
      </section>

      <div className="mx-auto w-full max-w-md">
        <Card>
          <h2 className="mb-5 text-[17px] font-semibold tracking-tight text-ink">Get started</h2>
          <SignInForm />
        </Card>
      </div>

      <section aria-label="How Helm keeps you safe" className="grid gap-4 py-16 sm:grid-cols-3">
        {LAYERS.map((l) => (
          <div key={l.title} className="rounded-card border border-line bg-surface p-5">
            <h3 className="text-sm font-semibold text-ink">{l.title}</h3>
            <p className="mt-1 text-sm text-muted">{l.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
