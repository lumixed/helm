import { WaitingReportRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { json } from '@/lib/http';
import { saveWaitingReport } from '@/lib/waiting';

export const dynamic = 'force-dynamic';

/** Agent → backend: unanswered sent mail it found, and threads that got a reply since. */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, WaitingReportRequest);
  if (!r.ok) return r.error;
  const { added } = await saveWaitingReport(r.db, r.agent.userId, r.body);
  return json({ added: added.length });
}
