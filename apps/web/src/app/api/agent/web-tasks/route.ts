import { WebTaskProposeRequest } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { WebTaskError, createWebTask } from '@/lib/web-tasks';

export const dynamic = 'force-dynamic';

/** Agent → backend: asked for in chat. Saved as ready; only the person can start it. */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, WebTaskProposeRequest);
  if (!r.ok) return r.error;
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  if (!user) return fail(404, 'No such person');
  try {
    const task = await createWebTask(
      r.db,
      user,
      { instruction: r.body.instruction, url: r.body.url, origin: 'chat' },
      { start: false },
    );
    return json({ id: task.id, site: task.allowedHosts[0] }, 201);
  } catch (err) {
    if (err instanceof WebTaskError) return fail(err.status, err.message);
    throw err;
  }
}
