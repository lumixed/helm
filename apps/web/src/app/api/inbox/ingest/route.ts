import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { fail, json, readBody } from '@/lib/http';
import { IngestBody, ingestEmail } from '@/lib/inbox';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Raw email text in (PRD M6; also the demo's "Simulate professor email"). The text is handed to
 * the student's agent and is not stored here: the backend keeps sender, subject, time and a hash.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, IngestBody);
  if (body instanceof Response) return body;
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  if (!agent?.maritimeAgentId) return fail(409, 'Your agent is still being set up.');
  const transport = agentTransport();
  if (!transport) return fail(503, 'Agents are not configured on this server.');
  try {
    const r = await ingestEmail(db, user, agent.maritimeAgentId, transport, body);
    return json(r, r.duplicate ? 200 : 202);
  } catch (err) {
    console.error('[inbox] could not reach agent', err);
    return fail(502, 'Could not reach your agent. Try again in a moment.');
  }
}
