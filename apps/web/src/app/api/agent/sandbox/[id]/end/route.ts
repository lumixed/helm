import { SandboxEndRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { endSandbox, sandboxesFromEnv } from '@/lib/sandboxes';

export const dynamic = 'force-dynamic';

/** Agent → backend: done with the sandbox. Maritime deletes it with its disk. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const r = await agentRequest(req, SandboxEndRequest);
  if (!r.ok) return r.error;
  const client = sandboxesFromEnv();
  if (!client) return fail(503, 'Sandboxes are not set up on this server.');
  const ok = await endSandbox(r.db, r.agent.userId, (await ctx.params).id, client, r.body);
  return ok ? json({ ended: true }) : fail(404, 'Not your sandbox.');
}
