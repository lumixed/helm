import { TaskCreateRequest } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { addTaskFromChat } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

/** Agent → backend: the person told their agent about something to do by a time. */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, TaskCreateRequest);
  if (!r.ok) return r.error;
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  if (!user) return fail(404, 'No such person');
  return json(await addTaskFromChat(r.db, user, r.body), 201);
}
