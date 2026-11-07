import { AgentEventsRequest } from '@helm/shared';
import { z } from 'zod';
import { bearer, verifyAgentToken } from '@/lib/agent-auth';
import { eventStore } from '@/lib/event-store';

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

  // The token is scoped to one student; it can only write that student's events.
  if (!verifyAgentToken(body.data.studentId, token)) {
    return Response.json({ error: 'invalid agent token' }, { status: 403 });
  }

  const result = eventStore.add(body.data.studentId, body.data.events);
  return Response.json(result);
}
