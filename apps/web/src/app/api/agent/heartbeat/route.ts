import { after } from 'next/server';
import { agentFromToken } from '@/lib/agent-request';
import { agentTransport } from '@/lib/agent-transport';
import { checkDue, desktopDepsFromEnv } from '@/lib/desktop';
import { json } from '@/lib/http';
import { tick, tickDepsFor } from '@/lib/submissions';

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
  // Same heartbeat: look at this person's messaging apps when a check is due. A check takes
  // ~20 s (wake, screenshot, vision read), longer than the agent waits, so it runs after the reply.
  const deps = await desktopDepsFromEnv();
  if (deps)
    after(() =>
      checkDue(r.db, deps, r.agent.userId).catch((err: unknown) =>
        console.warn('[desktop] heartbeat check failed', String(err).slice(0, 200)),
      ),
    );
  return json({ ...scheduler, desktop: deps ? 'checking' : null });
}
