import { AgentInboxMessageRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { registerAgentEmail } from '@/lib/gmail';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Agent → backend: an email the agent read from Gmail itself (metadata and hash only). */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, AgentInboxMessageRequest);
  if (!r.ok) return r.error;
  return json(await registerAgentEmail(r.db, r.agent.userId, r.body));
}
