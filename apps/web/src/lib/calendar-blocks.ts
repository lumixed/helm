import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { encodeAgentMessage } from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import { todaysBrief } from './briefs';
import { recordSent } from './maritime-webhooks';

/**
 * "Add to Google Calendar": the person's tap is the consent, per day. The backend only forwards
 * today's planned blocks; the agent writes them with its own Google key, which never leaves it.
 */
export async function requestAddBlocks(
  db: Db,
  user: User,
  transport: AgentTransport,
  now = new Date(),
): Promise<{ requestId: string; count: number } | { error: string; status: number }> {
  if (!user.gmailAddress) return { error: 'Connect Google in Settings first.', status: 409 };
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  if (!agent?.maritimeAgentId) return { error: 'Your agent is still being set up.', status: 409 };
  const brief = await todaysBrief(db, user, now);
  const blocks = (brief?.blocks ?? []).filter((b) => new Date(b.end) > now);
  if (!brief || !blocks.length) return { error: 'No work blocks left today to add.', status: 409 };
  const requestId = `calendar:blocks:${randomUUID()}`;
  await transport.send(
    agent.maritimeAgentId,
    encodeAgentMessage({
      v: 1,
      type: 'calendar.add_blocks',
      requestId,
      studentId: user.id,
      payload: { forDate: brief.forDate, blocks: blocks.slice(0, 12) },
    }),
  );
  await recordSent(db, user.id, agent.maritimeAgentId, requestId, 'calendar.add_blocks');
  return { requestId, count: Math.min(blocks.length, 12) };
}

/** The agent's answer for one request, once it has reported back. */
export async function addBlocksResult(db: Db, user: User, requestId: string) {
  const [ev] = await db
    .select()
    .from(schema.agentEvents)
    .where(
      and(
        eq(schema.agentEvents.userId, user.id),
        eq(schema.agentEvents.requestId, requestId),
        inArray(schema.agentEvents.type, ['calendar.blocks_added', 'agent.error']),
      ),
    )
    .limit(1);
  if (!ev) return { done: false as const };
  return { done: true as const, ok: ev.type === 'calendar.blocks_added', message: ev.reason };
}
