import { BriefRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { saveBrief } from '@/lib/briefs';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Agent → backend: a finished brief. Stored once per request (retries are ignored). */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, BriefRequest);
  if (!r.ok) return r.error;
  const id = await saveBrief(r.db, r.agent.userId, r.body.requestId, r.body.brief);
  return json({ stored: id !== null, id });
}
