import { z } from 'zod';
import { getDb } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { syncAgentSettings } from '@/lib/provisioning';
import { deleteReminder, reminderView, updateReminder } from '@/lib/reminders';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const Uuid = z.uuid();

/** Pause or resume. A paused reminder's schedule leaves the agent. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  if (!Uuid.safeParse(id).success) return fail(404, 'Not found');
  const body = await readBody(req, z.object({ enabled: z.boolean() }));
  if (body instanceof Response) return body;
  const db = await getDb();
  const row = await updateReminder(db, user.id, id, body);
  if (!row) return fail(404, 'Not found');
  const synced = await syncAgentSettings(db, user, maritimeOrNull());
  return json({ reminder: reminderView(row, user.timezone), synced });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  if (!Uuid.safeParse(id).success) return fail(404, 'Not found');
  const db = await getDb();
  if (!(await deleteReminder(db, user.id, id))) return fail(404, 'Not found');
  const synced = await syncAgentSettings(db, user, maritimeOrNull());
  return json({ ok: true, synced });
}
