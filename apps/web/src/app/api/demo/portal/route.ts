import { z } from 'zod';
import { getDb } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { portalFailures, setPortalFailures } from '@/lib/portal';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const Body = z.object({
  failNext: z.number().int().min(0).max(10),
  mode: z.enum(['503', 'timeout']),
});

/** DEMO ONLY: "Inject portal failure" makes the next N demo-portal submits fail. */
export async function POST(req: Request): Promise<Response> {
  if (process.env.DEMO_MODE !== 'true') return new Response('Not found', { status: 404 });
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  const db = await getDb();
  await setPortalFailures(db, user.id, body.failNext, body.mode);
  return json(await portalFailures(db, user.id));
}
