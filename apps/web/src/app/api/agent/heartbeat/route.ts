import { agentFromToken } from '@/lib/agent-request';
import { agentTransport } from '@/lib/agent-transport';
import { json } from '@/lib/http';
import { tick, tickDepsFor } from '@/lib/submissions';

export const dynamic = 'force-dynamic';

/**
 * Agent → backend, on its platform-cron heartbeat: the safety net. Anything due for this student
 * (a hold notice, a submission, a retry, a run that never reported back) is acted on now.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await agentFromToken(req);
  if (!r.ok) return r.error;
  return json(await tick(r.db, tickDepsFor(r.db, agentTransport()), r.agent.userId));
}
