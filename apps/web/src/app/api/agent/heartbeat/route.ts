import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { schema } from '@/db';
import { agentFromToken } from '@/lib/agent-request';
import { agentTransport } from '@/lib/agent-transport';
import { checkDue, desktopDepsFromEnv } from '@/lib/desktop';
import { json } from '@/lib/http';
import { tick, tickDepsFor } from '@/lib/submissions';
import { syncAgentSettings } from '@/lib/provisioning';
import { catchUpReminders } from '@/lib/reminders';
import { maritimeOrNull } from '@/lib/student';
import { advanceDueWebTasks, webTaskDepsFromEnv } from '@/lib/web-tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Agent → backend, on its platform-cron heartbeat: the safety net. Anything due for this student
 * (a hold notice, a submission, a retry, a run that never reported back) is acted on now.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await agentFromToken(req);
  if (!r.ok) return r.error;
  const scheduler = await tick(r.db, tickDepsFor(r.db, agentTransport()), r.agent.userId);
  // Reminders the platform cron did not deliver (Maritime is the primary; this is the net).
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  const reminders = user
    ? await catchUpReminders(r.db, user).catch((err: unknown) => {
        console.warn('[reminders] catch-up failed', String(err).slice(0, 200));
        return { sent: 0, finished: false };
      })
    : { sent: 0, finished: false };
  if (user && reminders.finished) await syncAgentSettings(r.db, user, maritimeOrNull());
  // Same heartbeat: look at this person's messaging apps when a check is due. A check takes
  // ~20 s (wake, screenshot, vision read), longer than the agent waits, so it runs after the reply.
  const deps = await desktopDepsFromEnv();
  if (deps)
    after(() =>
      checkDue(r.db, deps, r.agent.userId).catch((err: unknown) =>
        console.warn('[desktop] heartbeat check failed', String(err).slice(0, 200)),
      ),
    );
  // A website task keeps going even if the page that started it was closed.
  const taskDeps = await webTaskDepsFromEnv();
  if (taskDeps)
    after(() =>
      advanceDueWebTasks(r.db, taskDeps, r.agent.userId).catch((err: unknown) =>
        console.warn('[web-task] heartbeat failed', String(err).slice(0, 200)),
      ),
    );
  return json({ ...scheduler, reminders: reminders.sent, desktop: deps ? 'checking' : null });
}
