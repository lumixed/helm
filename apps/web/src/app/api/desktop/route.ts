import { getDb } from '@/db';
import { checkDue, desktopDepsFromEnv, listApps } from '@/lib/desktop';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Messaging apps and their state. While a login is pending, also looks whether it finished. */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const deps = await desktopDepsFromEnv();
  const before = await listApps(db, user);
  if (deps && before.some((a) => a.status === 'linking'))
    await checkDue(db, deps, user.id).catch((err: unknown) =>
      console.warn('[desktop] check failed', String(err)),
    );
  return json({ available: Boolean(deps), apps: await listApps(db, user) });
}
