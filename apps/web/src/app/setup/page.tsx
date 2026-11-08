import { AgentStatus } from '@/components/AgentStatus';
import { GmailCard } from '@/components/GmailCard';
import { MessagingAppsCard } from '@/components/MessagingAppsCard';
import { computersFromEnv } from '@/lib/computers';
import { listApps } from '@/lib/desktop';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { LimitsCard } from '@/components/LimitsCard';
import { getDb, schema } from '@/db';
import { policySummary } from '@/lib/limits';
import { SetupForm } from '@/components/SetupForm';
import { SignOutButton } from '@/components/SignOutButton';
import { TelegramCard } from '@/components/TelegramCard';
import { Card, CardTitle, Shell } from '@/components/ui';
import { gmailConfig } from '@/lib/gmail';
import { requireProfile } from '@/lib/page-data';
import { currentUser } from '@/lib/session';
import { telegramToken } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const { gmail } = await searchParams;
  const { user, agent } = await requireProfile();
  const full = (await currentUser())!;
  const [agentRow] = await (
    await getDb()
  )
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.userId, full.id));
  const limits = user.onboarded ? await policySummary(full, agentRow ?? null) : null;
  // Inside the Helm phone app there is nothing to install.
  const inApp = ((await headers()).get('user-agent') ?? '').includes('HelmApp/');
  return (
    <Shell
      title={user.onboarded ? 'Settings' : 'Set up Helm'}
      subtitle={
        user.onboarded
          ? 'Your profile, connections and private agent.'
          : 'Step 1 of 2 · A few details so your brief arrives at the right time.'
      }
      nav={user.onboarded}
      actions={user.onboarded ? undefined : <SignOutButton />}
    >
      <Card>
        <CardTitle>Profile and brief</CardTitle>
        <SetupForm profile={user} />
      </Card>

      {user.onboarded && (
        <section aria-labelledby="connections-h" className="flex flex-col gap-3">
          <h2 id="connections-h" className="pt-2 text-[17px] font-semibold tracking-tight text-ink">
            Connections
          </h2>
          {gmailConfig() && <GmailCard address={full.gmailAddress} result={gmail} />}
          {computersFromEnv() && process.env.GEMINI_API_KEY && (
            <MessagingAppsCard initial={await listApps(await getDb(), full)} />
          )}
          {telegramToken() && <TelegramCard linked={user.telegramLinked} />}
          {!inApp && (
            <Card>
              <details>
                <summary className="cursor-pointer text-[17px] font-semibold tracking-tight text-ink">
                  Put Helm on your phone&apos;s home screen
                </summary>
                <p className="mt-3 text-sm text-ink-soft">
                  iPhone: open Helm in Safari, tap Share, then <strong>Add to Home Screen</strong>.
                  Android: open the Chrome menu, then <strong>Install app</strong>. On Android you
                  can then share any message to Helm from the share sheet.
                </p>
              </details>
            </Card>
          )}
        </section>
      )}

      <AgentStatus initial={agent} />
      {limits && <LimitsCard p={limits} />}
      {user.onboarded && (
        <a
          href="/maritime"
          className="rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong"
        >
          <span className="block font-semibold text-ink">Under the hood →</span>
          <span className="mt-0.5 block text-sm text-muted">
            See how your agent is isolated on Maritime, with live evidence.
          </span>
        </a>
      )}
      {user.onboarded && (
        <div className="flex justify-center pt-2">
          <SignOutButton />
        </div>
      )}
    </Shell>
  );
}
