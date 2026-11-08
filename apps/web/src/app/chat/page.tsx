import { redirect } from 'next/navigation';
import { ChatPanel } from '@/components/ChatPanel';
import { Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const { user } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  return (
    <Shell
      title="Ask Helm"
      subtitle="Talk to your private agent about your plan, or ask it to remind you about anything."
    >
      <ChatPanel name={user.name} />
    </Shell>
  );
}
