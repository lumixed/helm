import { redirect } from 'next/navigation';
import { SubmissionsBoard } from '@/components/SubmissionsBoard';
import { Shell } from '@/components/ui';
import { getDb } from '@/db';
import { listAssignments } from '@/lib/assignments';
import { requireProfile } from '@/lib/page-data';
import { portalFailures } from '@/lib/portal';
import { currentUser } from '@/lib/session';
import { listSubmissions } from '@/lib/submissions';

export const dynamic = 'force-dynamic';

export default async function SubmissionsPage() {
  const { user } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  const db = await getDb();
  const full = (await currentUser())!;
  const [assignments, submissions, failures] = await Promise.all([
    listAssignments(db, user.id, user.timezone, { review: false }),
    listSubmissions(db, full),
    portalFailures(db, user.id),
  ]);
  const now = Date.now();
  const options = assignments
    .filter(
      (a) =>
        a.dueAt &&
        new Date(a.dueAt).getTime() > now &&
        (a.status === 'todo' || a.status === 'in_progress'),
    )
    .map((a) => ({
      id: a.id,
      label: `${a.courseCode ? `${a.courseCode} · ` : ''}${a.title} (due ${a.dueLocal?.replace('T', ' ')})`,
      allowed: a.allowedFileTypes,
    }));
  return (
    <Shell
      title="Hand in"
      subtitle="Helm hands in your finished work on time, with your OK, and keeps the receipt."
    >
      <SubmissionsBoard
        initial={submissions}
        assignments={options}
        demo={process.env.DEMO_MODE === 'true'}
        failNext={failures.failNext}
      />
    </Shell>
  );
}
