import { getDb } from '@/db';
import { listAssignments } from '@/lib/assignments';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** ?review=1 → extracted rows waiting for the student to confirm; default → confirmed ones. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const review = new URL(req.url).searchParams.get('review') === '1';
  const db = await getDb();
  return json({
    assignments: await listAssignments(db, user.id, user.timezone, { review }),
    timezone: user.timezone,
  });
}
