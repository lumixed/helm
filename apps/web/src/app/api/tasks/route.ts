import { z } from 'zod';
import { getDb } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import {
  WebTaskError,
  createWebTask,
  listWebTasks,
  webTaskDepsFromEnv,
  webTaskView,
} from '@/lib/web-tasks';

export const dynamic = 'force-dynamic';

const Create = z.object({ instruction: z.string().max(1000), url: z.string().max(500) });

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  return json({ tasks: await listWebTasks(await getDb(), user) });
}

/** The person starts a website task. */
export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  if (!(await webTaskDepsFromEnv()))
    return fail(503, 'Private desktops are not set up on this server.');
  const body = await readBody(req, Create);
  if (body instanceof Response) return body;
  try {
    return json(
      { task: webTaskView(await createWebTask(await getDb(), user, body), user.timezone) },
      201,
    );
  } catch (err) {
    if (err instanceof WebTaskError) return fail(err.status, err.message);
    throw err;
  }
}
