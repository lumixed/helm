import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { listAssignments } from '@/lib/assignments';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Status of one syllabus intake: reading, done (rows ready for review) or error. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  const db = await getDb();
  const [event] = await db
    .select({
      type: schema.agentEvents.type,
      reason: schema.agentEvents.reason,
      payload: schema.agentEvents.payloadJson,
    })
    .from(schema.agentEvents)
    .where(
      and(
        eq(schema.agentEvents.userId, user.id),
        sql`${schema.agentEvents.payloadJson} ->> 'intakeId' = ${id}`,
        sql`${schema.agentEvents.type} in ('intake.parsed', 'agent.error')`,
      ),
    )
    .orderBy(desc(schema.agentEvents.occurredAt))
    .limit(1);
  if (!event) return json({ status: 'reading' });
  if (event.type === 'agent.error') return json({ status: 'error', message: event.reason });
  const rows = await listAssignments(db, user.id, user.timezone, { intakeId: id });
  return json({ status: 'done', message: event.reason, count: rows.length });
}
