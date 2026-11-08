import { ReminderCreateRequest, describeRule } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { syncAgentSettings } from '@/lib/provisioning';
import { ReminderError, createReminder, reminderView } from '@/lib/reminders';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

/** Agent → backend: the person asked for a reminder in chat ("remind me to pay rent on the 1st"). */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, ReminderCreateRequest);
  if (!r.ok) return r.error;
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  if (!user) return fail(404, 'No such person');
  try {
    const row = await createReminder(
      r.db,
      user,
      { title: r.body.title, rule: r.body.rule },
      'chat',
    );
    const synced = await syncAgentSettings(r.db, user, maritimeOrNull());
    const view = reminderView(row, user.timezone);
    return json({ reminder: view, description: describeRule(row.ruleJson), synced }, 201);
  } catch (err) {
    if (err instanceof ReminderError) return fail(err.status, err.message);
    throw err;
  }
}
