import { Routines } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { syncAgentSettings } from '@/lib/provisioning';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

/**
 * Set the evening check-in and weekly review. Saved, then written to the agent's settings file,
 * where each becomes its own Maritime cron (GET /schedules).
 */
export async function PUT(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, Routines);
  if (body instanceof Response) return body;
  const db = await getDb();
  const [updated] = await db
    .update(schema.users)
    .set({ routinesJson: body })
    .where(eq(schema.users.id, user.id))
    .returning();
  const synced = await syncAgentSettings(db, updated!, maritimeOrNull());
  return json({ routines: body, synced });
}
