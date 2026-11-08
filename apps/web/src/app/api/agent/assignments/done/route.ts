import { MarkDoneRequest } from '@helm/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { recordHelmEvent } from '@/lib/submissions';

export const dynamic = 'force-dynamic';

/**
 * Agent → backend: the person said in chat (or on Telegram) that they finished an item. Only an
 * open item of their own is marked done, the same as the Done button on Today.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, MarkDoneRequest);
  if (!r.ok) return r.error;
  if (!/^[0-9a-f-]{36}$/i.test(r.body.assignmentId)) return fail(404, 'Not found');
  const [row] = await r.db
    .update(schema.assignments)
    .set({ status: 'done', progressPct: 100 })
    .where(
      and(
        eq(schema.assignments.id, r.body.assignmentId),
        eq(schema.assignments.userId, r.agent.userId),
        inArray(schema.assignments.status, ['todo', 'in_progress']),
      ),
    )
    .returning({ id: schema.assignments.id, title: schema.assignments.title });
  if (!row) return fail(404, 'Not an open item of yours');
  await recordHelmEvent(
    r.db,
    r.agent.userId,
    'change.applied',
    `Marked “${row.title}” done (you said so in chat)`,
    { assignmentId: row.id, via: 'chat' },
    `helm:done:${r.body.requestId}`,
  );
  return json({ done: true, title: row.title });
}
