import { getDb } from '@/db';
import { computersFromEnv } from '@/lib/computers';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { WebTaskError, forgetTasksDesktop } from '@/lib/web-tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Delete the private tasks desktop and every site login on it. */
export async function DELETE(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const computers = computersFromEnv();
  if (!computers) return fail(503, 'Private desktops are not set up on this server.');
  try {
    return json({ deleted: await forgetTasksDesktop(await getDb(), user, computers) });
  } catch (err) {
    if (err instanceof WebTaskError) return fail(err.status, err.message);
    throw err;
  }
}
