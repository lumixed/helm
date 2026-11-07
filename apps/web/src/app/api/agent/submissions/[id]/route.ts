import { agentFromToken } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { portalBaseUrl } from '@/lib/portal';
import { SubmissionError, agentJob } from '@/lib/submissions';

export const dynamic = 'force-dynamic';

/** Agent → backend: one submission job, only for this agent's own student. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await agentFromToken(req);
  if (!r.ok) return r.error;
  const portal = portalBaseUrl();
  if (!portal) return fail(503, 'Portal URL is not configured');
  try {
    return json(await agentJob(r.db, r.agent.userId, (await ctx.params).id, portal));
  } catch (err) {
    if (err instanceof SubmissionError) return fail(err.status, err.message);
    throw err;
  }
}
