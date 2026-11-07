import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AgentStatus } from '@/components/AgentStatus';
import { Card, Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const { user, agent } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  return (
    <Shell
      title={user.name ? `Today, ${user.name}` : 'Today'}
      actions={
        <Link
          href="/setup"
          className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
        >
          Settings
        </Link>
      }
    >
      <Card>
        <h2 className="text-lg font-semibold">Your brief</h2>
        <p className="mt-2">
          Add your syllabi and Helm will tell you what to do each morning at {user.briefTimeLocal} (
          {user.timezone.replaceAll('_', ' ')}).
        </p>
      </Card>
      <AgentStatus initial={agent} />
    </Shell>
  );
}
