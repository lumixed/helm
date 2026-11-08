import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentFromToken } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { weekFacts } from '@/lib/week';

export const dynamic = 'force-dynamic';

/** Agent → backend: the facts for this person's weekly review. */
export async function GET(req: Request): Promise<Response> {
  const r = await agentFromToken(req);
  if (!r.ok) return r.error;
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  if (!user) return fail(404, 'No such person');
  return json({ facts: await weekFacts(r.db, user), name: user.name });
}
