import { AgentStatus } from '@/components/AgentStatus';
import { GmailCard } from '@/components/GmailCard';
import { SetupForm } from '@/components/SetupForm';
import { SignOutButton } from '@/components/SignOutButton';
import { TelegramCard } from '@/components/TelegramCard';
import { Card, CardTitle, Shell } from '@/components/ui';
import { gmailConfig } from '@/lib/gmail';
import { requireProfile } from '@/lib/page-data';
import { currentUser } from '@/lib/session';
import { telegramToken } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const { user, agent } = await requireProfile();
  const full = (await currentUser())!;
  return (
    <Shell
      title={user.onboarded ? 'Settings' : 'Set up Helm'}
      subtitle={
        user.onboarded
          ? 'Your profile, connections and private agent.'
          : 'Step 1 of 2 · A few details so your brief arrives at the right time.'
      }
      nav={user.onboarded}
      actions={<SignOutButton />}
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
          {gmailConfig() && <GmailCard address={full.gmailAddress} />}
          {telegramToken() && <TelegramCard linked={user.telegramLinked} />}
          <Card>
            <details>
              <summary className="cursor-pointer text-[17px] font-semibold tracking-tight text-ink">
                Put Helm on your phone&apos;s home screen
              </summary>
              <p className="mt-3 text-sm text-ink-soft">
                iPhone: open Helm in Safari, tap Share, then <strong>Add to Home Screen</strong>.
                Android: open the Chrome menu, then <strong>Install app</strong>. On Android you can
                then share any message to Helm from the share sheet.
              </p>
            </details>
          </Card>
        </section>
      )}

      <AgentStatus initial={agent} />
    </Shell>
  );
}
