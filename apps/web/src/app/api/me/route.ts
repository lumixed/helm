import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import {
  deleteStudent,
  ensureStudentAgent,
  provisionEnvFromProcess,
  refreshAgent,
  writeAgentSettings,
} from '@/lib/provisioning';
import { clearSessionCookie, currentUser } from '@/lib/session';
import { maritimeOrNull, ProfileUpdate, publicProfile } from '@/lib/student';

export const dynamic = 'force-dynamic';

/** Profile + live agent status. Also retries provisioning if it failed or never ran. */
export async function GET() {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const maritime = maritimeOrNull();
  let agent = null;
  if (maritime) {
    agent = await refreshAgent(db, user, maritime);
    if (!agent || (agent.status === 'error' && !agent.maritimeAgentId)) {
      agent = await ensureStudentAgent(db, user, maritime, provisionEnvFromProcess());
    }
  }
  return json(publicProfile(user, agent));
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, ProfileUpdate);
  if (body instanceof Response) return body;

  const db = await getDb();
  const [updated] = await db
    .update(schema.users)
    .set({ ...body, onboardedAt: user.onboardedAt ?? new Date() })
    .where(eq(schema.users.id, user.id))
    .returning();

  // Brief time / timezone changes reach the agent's schedule through its settings file (M5).
  const maritime = maritimeOrNull();
  let synced = false;
  if (maritime && (body.timezone || body.briefTimeLocal)) {
    try {
      await writeAgentSettings(db, updated!, maritime);
      synced = true;
    } catch (err) {
      console.warn('[me] settings sync failed; will retry on next status check', String(err));
      await db
        .update(schema.agents)
        .set({ configWrittenAt: null })
        .where(eq(schema.agents.userId, user.id));
    }
  }
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  return json({ ...publicProfile(updated!, agent ?? null), synced });
}

/** Delete my account: removes my agent at Maritime and all my data (PRD section 16). */
export async function DELETE() {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const maritime = maritimeOrNull();
  if (!maritime)
    return fail(503, 'Maritime is not configured, so your agent cannot be deleted yet.');
  try {
    await deleteStudent(db, user.id, maritime);
  } catch (err) {
    return fail(
      502,
      `Could not delete your agent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await clearSessionCookie();
  return json({ ok: true });
}
