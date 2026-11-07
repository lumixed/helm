import { randomUUID } from 'node:crypto';
import { encodeAgentMessage } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { recordSent } from '@/lib/maritime-webhooks';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** "Send my brief now": wakes the student's agent with a brief.generate message. */
export async function POST(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  if (!agent?.maritimeAgentId) return fail(409, 'Your agent is still being set up.');
  const transport = agentTransport();
  if (!transport) return fail(503, 'Agents are not configured on this server.');
  const requestId = `brief:manual:${randomUUID()}`;
  try {
    await transport.send(
      agent.maritimeAgentId,
      encodeAgentMessage({
        v: 1,
        type: 'brief.generate',
        requestId,
        studentId: user.id,
        payload: { trigger: 'manual' },
      }),
    );
  } catch (err) {
    console.error('[brief] could not reach agent', err);
    return fail(502, 'Could not reach your agent. Try again in a moment.');
  }
  await recordSent(db, user.id, agent.maritimeAgentId, requestId, 'brief.generate');
  return json({ requestId, requestedAt: new Date().toISOString() }, 202);
}
