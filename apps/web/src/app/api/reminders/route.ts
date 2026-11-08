import { getDb } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { syncAgentSettings } from '@/lib/provisioning';
import {
  ReminderError,
  ReminderInput,
  createReminder,
  reminderView,
  reminderViews,
} from '@/lib/reminders';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  return json({ reminders: await reminderViews(await getDb(), user) });
}

/** Add a reminder; it reaches the agent's schedules (Maritime cron) right away. */
export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, ReminderInput);
  if (body instanceof Response) return body;
  const db = await getDb();
  try {
    const row = await createReminder(db, user, body, 'you');
    const synced = await syncAgentSettings(db, user, maritimeOrNull());
    return json({ reminder: reminderView(row, user.timezone), synced }, 201);
  } catch (err) {
    if (err instanceof ReminderError) return fail(err.status, err.message);
    throw err;
  }
}
