import { randomUUID } from 'node:crypto';
import { encodeAgentMessage } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { fail, json } from '@/lib/http';
import { recordSent } from '@/lib/maritime-webhooks';
import { currentUser } from '@/lib/session';
import { dismissWaiting, getWaiting } from '@/lib/waiting';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** "Draft a nudge": wakes the agent to save a follow-up draft in Gmail. Never sends. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(404, 'Not found');
  const db = await getDb();
  const item = await getWaiting(db, user.id, id);
  if (!item) return fail(404, 'Not found');
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  const transport = agentTransport();
  if (!agent?.maritimeAgentId || !transport) return fail(409, 'Your agent is not ready yet.');
  const requestId = `followup:${randomUUID()}`;
  try {
    await transport.send(
      agent.maritimeAgentId,
      encodeAgentMessage({
        v: 1,
        type: 'followup.draft',
        requestId,
        studentId: user.id,
        payload: { threadId: item.threadId },
      }),
    );
  } catch {
    return fail(502, 'Could not reach your agent. Try again in a moment.');
  }
  await recordSent(db, user.id, agent.maritimeAgentId, requestId, 'followup.draft');
  return json({ requestId }, 202);
}

/** "Done": stop showing it. */
export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(404, 'Not found');
  if (!(await dismissWaiting(await getDb(), user.id, id))) return fail(404, 'Not found');
  return json({ ok: true });
}
