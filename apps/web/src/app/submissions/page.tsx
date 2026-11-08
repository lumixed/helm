import Link from 'next/link';
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
      actions={
        <nav aria-label="Main" className="flex gap-1">
          <Link
            href="/today"
            className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
          >
            Today
          </Link>
          <Link
            href="/timeline"
            className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
          >
            Timeline
          </Link>
        </nav>
      }
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
