import { SubmissionResultRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { SubmissionError, recordResult } from '@/lib/submissions';

export const dynamic = 'force-dynamic';

/** Agent → backend: the outcome of one submission attempt. Repeats are ignored. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await agentRequest(req, SubmissionResultRequest);
  if (!r.ok) return r.error;
  try {
    return json(await recordResult(r.db, r.agent.userId, (await ctx.params).id, r.body));
  } catch (err) {
    if (err instanceof SubmissionError) return fail(err.status, err.message);
    throw err;
  }
}
