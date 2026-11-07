import { z } from 'zod';
import { getDb, schema } from '@/db';
import type { User } from '@/db/schema';
import { fail, json, readBody } from '@/lib/http';
import {
  ensureLocalAgent,
  ensureStudentAgent,
  localAgentDir,
  provisionEnvFromProcess,
} from '@/lib/provisioning';
import { setSessionCookie } from '@/lib/session';
import { maritimeOrNull, publicProfile } from '@/lib/student';

export const dynamic = 'force-dynamic';

const SignIn = z.object({
  email: z.email().max(254),
  name: z.string().trim().max(80).optional(),
});

export async function POST(req: Request) {
  const body = await readBody(req, SignIn);
  if (body instanceof Response) return body;

  const db = await getDb();
  const email = body.email.trim().toLowerCase();
  const [user] = (await db
    .insert(schema.users)
    .values({ email, name: body.name ?? '' })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: body.name ? { name: body.name } : { email },
    })
    .returning()) as [User];
  await setSessionCookie(user.id);

  // Provision the student's private agent right away (PRD J1 step 1). Idempotent.
  const maritime = maritimeOrNull();
  let agent = null;
  const localDir = localAgentDir();
  if (localDir) {
    agent = await ensureLocalAgent(db, user, localDir);
  } else if (maritime) {
    try {
      agent = await ensureStudentAgent(db, user, maritime, provisionEnvFromProcess());
    } catch (err) {
      console.error('[signin] provisioning failed', err);
      return fail(500, 'Signed in, but your agent could not be set up. Try again in a minute.');
    }
  }
  return json({ ...publicProfile(user, agent), next: user.onboardedAt ? '/today' : '/setup' });
}
