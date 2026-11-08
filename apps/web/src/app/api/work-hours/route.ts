import { WorkHours } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { syncAgentSettings } from '@/lib/provisioning';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

/** Set the work window and days off. Written to the agent's settings file for time-blocking. */
export async function PUT(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, WorkHours);
  if (body instanceof Response) return body;
  const workHours = { ...body, offDays: [...new Set(body.offDays)].sort() };
  const db = await getDb();
  const [updated] = await db
    .update(schema.users)
    .set({ workHoursJson: workHours })
    .where(eq(schema.users.id, user.id))
    .returning();
  const synced = await syncAgentSettings(db, updated!, maritimeOrNull());
  return json({ workHours, synced });
}
