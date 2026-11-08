import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Close the "Get Helm ready" checklist for this person. */
export async function POST(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  await db
    .update(schema.users)
    .set({ setupDismissedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  return json({ ok: true });
}
