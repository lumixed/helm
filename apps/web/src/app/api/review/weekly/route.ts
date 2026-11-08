import { encodeAgentMessage } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { fail, json } from '@/lib/http';
import { recordSent } from '@/lib/maritime-webhooks';
import { currentUser } from '@/lib/session';
import { latestWeeklyReview, manualReviewRequestId } from '@/lib/week';

export const dynamic = 'force-dynamic';

/** When the latest review was written (the page polls this after "Write it now"). */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const r = await latestWeeklyReview(await getDb(), user.id);
  return json({ latest: r ? { id: r.id, createdAt: r.createdAt.toISOString() } : null });
}

/** "Write it now": wakes the person's agent with a review.weekly message. */
export async function POST(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  if (!agent?.maritimeAgentId) return fail(409, 'Your agent is still being set up.');
  const transport = agentTransport();
  if (!transport) return fail(503, 'Agents are not configured on this server.');
  const requestId = manualReviewRequestId();
  try {
    await transport.send(
      agent.maritimeAgentId,
      encodeAgentMessage({
        v: 1,
        type: 'review.weekly',
        requestId,
        studentId: user.id,
        payload: { trigger: 'manual' },
      }),
    );
  } catch (err) {
    console.error('[review] could not reach agent', err);
    return fail(502, 'Could not reach your agent. Try again in a moment.');
  }
  await recordSent(db, user.id, agent.maritimeAgentId, requestId, 'review.weekly');
  return json({ requestId, requestedAt: new Date().toISOString() }, 202);
}
