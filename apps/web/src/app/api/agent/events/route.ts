import { AgentEventsRequest } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentRequest } from '@/lib/agent-request';

export const dynamic = 'force-dynamic';

/** Agent → backend: timeline events, results and alerts (PRD section 10). */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, AgentEventsRequest);
  if (!r.ok) return r.error;
  const { db, agent, body } = r;

  const inserted = await db
    .insert(schema.agentEvents)
    .values(
      body.events.map((e) => ({
        userId: agent.userId,
        agentId: agent.agentId,
        eventId: e.eventId,
        requestId: e.requestId ?? null,
        type: e.type,
        reason: e.reason,
        payloadJson: e.payload,
        occurredAt: new Date(e.occurredAt),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.agentEvents.id });

  await db
    .update(schema.agents)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.agents.id, agent.agentId));

  return Response.json({
    accepted: inserted.length,
    duplicates: body.events.length - inserted.length,
  });
}
