import { AgentStatus } from '@/components/AgentStatus';
import { SetupForm } from '@/components/SetupForm';
import { SignOutButton } from '@/components/SignOutButton';
import { Card, Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const { user, agent } = await requireProfile();
  return (
    <Shell title={user.onboarded ? 'Settings' : 'Set up Helm'} actions={<SignOutButton />}>
      <AgentStatus initial={agent} />
      <Card>
        <SetupForm profile={user} />
      </Card>
    </Shell>
  );
}
