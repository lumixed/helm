import { AgentEventsRequest } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { bearer, findAgentByToken } from '@/lib/agent-auth';

export const dynamic = 'force-dynamic';

/** Agent → backend: timeline events, results and alerts (PRD section 10). */
export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return Response.json({ error: 'missing bearer token' }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const body = AgentEventsRequest.safeParse(json);
  if (!body.success) {
    return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });
  }

  const db = await getDb();
  const agent = await findAgentByToken(db, token);
  // The token is scoped to one student; it can only write that student's events.
  if (!agent || agent.userId !== body.data.studentId) {
    return Response.json({ error: 'invalid agent token' }, { status: 403 });
  }

  const inserted = await db
    .insert(schema.agentEvents)
    .values(
      body.data.events.map((e) => ({
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
    duplicates: body.data.events.length - inserted.length,
  });
}
