import Link from 'next/link';
import { Timeline } from '@/components/Timeline';
import { Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  await requireProfile();
  return (
    <Shell
      title="Agent timeline"
      actions={
        <Link
          href="/today"
          className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
        >
          Today
        </Link>
      }
    >
      <p>Everything your private agent did, when, and why.</p>
      <Timeline />
    </Shell>
  );
}
