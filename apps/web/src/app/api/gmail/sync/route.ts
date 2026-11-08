import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { disconnectGmail, requestSync } from '@/lib/gmail';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

/** "Check Gmail now": wakes the agent to read new mail. */
export async function POST(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  if (!user.gmailConnectedAt) return fail(409, 'Connect Gmail first.');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  const transport = agentTransport();
  if (!agent?.maritimeAgentId || !transport) return fail(409, 'Your agent is still being set up.');
  try {
    return json(
      { requestId: await requestSync(db, user.id, agent.maritimeAgentId, transport, 'manual') },
      202,
    );
  } catch {
    return fail(502, 'Could not reach your agent.');
  }
}

/** Disconnect Gmail: removes the token from the agent. */
export async function DELETE(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  await disconnectGmail(db, user, agent ?? null, maritimeOrNull());
  return json({ connected: false });
}
