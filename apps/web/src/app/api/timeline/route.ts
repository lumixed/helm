import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Everything the student's agent did and why (PRD M8), newest first. */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const events = await db
    .select({
      id: schema.agentEvents.id,
      type: schema.agentEvents.type,
      reason: schema.agentEvents.reason,
      occurredAt: schema.agentEvents.occurredAt,
      payload: schema.agentEvents.payloadJson,
    })
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.userId, user.id))
    .orderBy(desc(schema.agentEvents.occurredAt))
    .limit(200);
  return json({
    events: events.map((e) => ({ ...e, atLabel: formatTime(e.occurredAt, user.timezone) })),
    timezone: user.timezone,
  });
}
