import { IntakeResultRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { saveIntakeResult } from '@/lib/assignments';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Agent → backend: structured deadlines from one syllabus. Stored unconfirmed for review. */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, IntakeResultRequest);
  if (!r.ok) return r.error;
  const saved = await saveIntakeResult(r.db, r.agent.userId, r.body.intakeId, r.body.assignments);
  return json({ saved, warnings: r.body.warnings.length });
}
