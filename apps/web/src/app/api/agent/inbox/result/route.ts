import { InboxResultRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { saveInboxResult } from '@/lib/inbox';

export const dynamic = 'force-dynamic';

/**
 * Agent → backend: the structured meaning of one email. The backend applies its own rule to
 * decide whether it applies, waits for the student, or goes to review.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, InboxResultRequest);
  if (!r.ok) return r.error;
  const out = await saveInboxResult(r.db, r.agent.userId, r.body);
  return out ? json(out) : fail(404, 'inbox message not found');
}
