import { z } from 'zod';
import { getDb } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { isExpoPushToken, registerPushToken } from '@/lib/push';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const Register = z.object({
  token: z.string().max(200).refine(isExpoPushToken, 'Not an Expo push token'),
  platform: z.enum(['ios', 'android']).default('ios'),
});

/** Called by the native app (inside its signed-in web view) to receive push notifications. */
export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, Register);
  if (body instanceof Response) return body;
  await registerPushToken(await getDb(), user.id, body.token, body.platform);
  return json({ ok: true });
}
