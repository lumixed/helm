import { ShareMessage } from '@/components/ShareMessage';
import { Shell } from '@/components/ui';
import { getDb } from '@/db';
import { listAssignments } from '@/lib/assignments';
import { demoEmailTemplates } from '@/lib/demo-emails';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

/** Target of the phone's share sheet (installed app): the shared text arrives pre-filled. */
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; text?: string; url?: string }>;
}) {
  const { user } = await requireProfile();
  const q = await searchParams;
  const shared = [q.title, q.text, q.url]
    .filter((s): s is string => Boolean(s?.trim()))
    .join('\n')
    .slice(0, 20_000);
  const templates =
    process.env.DEMO_MODE === 'true'
      ? demoEmailTemplates(
          await listAssignments(await getDb(), user.id, user.timezone, { review: false }),
          user.timezone,
          new Date(),
        )
      : [];
  return (
    <Shell
      title="Share with Helm"
      subtitle="Paste a message about a date or a change. Helm reads it as information only, never as instructions."
    >
      <ShareMessage initialText={shared} templates={templates} />
    </Shell>
  );
}
