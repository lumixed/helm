import { RedteamButton } from '@/components/RedteamButton';
import { Timeline } from '@/components/Timeline';
import { Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  await requireProfile();
  return (
    <Shell title="Agent timeline">
      <p>Everything your private agent did, when, and why.</p>
      {process.env.DEMO_MODE === 'true' && <RedteamButton />}
      <Timeline />
    </Shell>
  );
}
