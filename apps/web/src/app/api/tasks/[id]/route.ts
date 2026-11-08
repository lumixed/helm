import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import {
  WebTaskError,
  advanceWebTask,
  respondToWebTask,
  webTaskDepsFromEnv,
  webTaskView,
} from '@/lib/web-tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('advance') }),
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('takeover') }),
  z.object({ action: z.literal('answer'), text: z.string().max(500) }),
]);

/** Page polls call advance while a task runs; everything else is the person answering it. */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(404, 'No such task');
  const deps = await webTaskDepsFromEnv();
  if (!deps) return fail(503, 'Private desktops are not set up on this server.');
  const body = await readBody(req, Action);
  if (body instanceof Response) return body;
  const db = await getDb();
  try {
    if (body.action === 'advance') {
      const [own] = await db
        .select({ id: schema.webTasks.id })
        .from(schema.webTasks)
        .where(and(eq(schema.webTasks.id, id), eq(schema.webTasks.userId, user.id)));
      if (!own) return fail(404, 'No such task');
      return json({ task: webTaskView(await advanceWebTask(db, id, deps), user.timezone) });
    }
    return json({
      task: webTaskView(await respondToWebTask(db, user, id, body, deps), user.timezone),
    });
  } catch (err) {
    if (err instanceof WebTaskError) return fail(err.status, err.message);
    throw err;
  }
}
