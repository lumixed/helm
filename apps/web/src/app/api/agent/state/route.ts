import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentFromToken } from '@/lib/agent-request';
import { agentState } from '@/lib/briefs';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Agent → backend: the student's open assignments and recent changes (no files, no raw text). */
export async function GET(req: Request): Promise<Response> {
  const r = await agentFromToken(req);
  if (!r.ok) return r.error;
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  if (!user) return fail(404, 'student not found');
  return json(await agentState(r.db, user));
}
