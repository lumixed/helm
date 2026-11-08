import Link from 'next/link';
import { ShareMessage } from '@/components/ShareMessage';
import { Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

/** Target of the phone's share sheet (installed app): the shared text arrives pre-filled. */
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; text?: string; url?: string }>;
}) {
  await requireProfile();
  const q = await searchParams;
  const shared = [q.title, q.text, q.url]
    .filter((s): s is string => Boolean(s?.trim()))
    .join('\n')
    .slice(0, 20_000);
  return (
    <Shell
      title="Share with Helm"
      actions={
        <Link
          href="/today"
          className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
        >
          Today
        </Link>
      }
    >
      <ShareMessage initialText={shared} />
    </Shell>
  );
}
