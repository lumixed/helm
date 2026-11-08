import { ReminderFiredRequest, previousOccurrence } from '@helm/shared';
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { syncAgentSettings } from '@/lib/provisioning';
import { fireReminder } from '@/lib/reminders';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

/** Agent → backend: a reminder's Maritime cron woke the agent. Send it to the person's phone. */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, ReminderFiredRequest);
  if (!r.ok) return r.error;
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  const [reminder] = await r.db
    .select()
    .from(schema.reminders)
    .where(
      and(eq(schema.reminders.id, r.body.reminderId), eq(schema.reminders.userId, r.agent.userId)),
    );
  if (!user || !reminder) return fail(404, 'No such reminder');
  // Only the occurrence that is actually due (within the agent's 30-minute window) counts.
  const now = new Date();
  const due = previousOccurrence(
    reminder.ruleJson,
    user.timezone,
    new Date(now.getTime() + 120_000),
  );
  const at = new Date(r.body.occurrenceAt);
  if (!due || due.getTime() !== at.getTime() || now.getTime() - at.getTime() > 35 * 60_000)
    return fail(409, 'That reminder is not due now');
  const res = await fireReminder(r.db, r.agent.userId, r.body.reminderId, at, 'maritime_cron', now);
  if (!res) return fail(404, 'No such reminder');
  if (res.finished) {
    // A one-off is done: take its schedule off the agent.
    await syncAgentSettings(r.db, user, maritimeOrNull());
  }
  return json(res);
}
