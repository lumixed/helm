import { z } from 'zod';
import { fail, json, readBody } from '@/lib/http';
import { checkPortalLogin, signPortalSession } from '@/lib/portal';

export const dynamic = 'force-dynamic';

const Body = z.object({ username: z.string().max(100), password: z.string().max(200) });

/** DEMO PORTAL login. Returns a session token (used as a bearer token by the agent). */
export async function POST(req: Request): Promise<Response> {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  const userId = checkPortalLogin(body.username, body.password);
  if (!userId) return fail(401, 'Wrong username or password.');
  return json({ token: signPortalSession(userId), expiresInS: 14 * 24 * 3600 });
}
