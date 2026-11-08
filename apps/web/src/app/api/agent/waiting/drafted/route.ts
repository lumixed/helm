import { z } from 'zod';
import { agentRequest } from '@/lib/agent-request';
import { json } from '@/lib/http';
import { markDrafted } from '@/lib/waiting';

export const dynamic = 'force-dynamic';

const Body = z.object({
  studentId: z.string().min(1).max(128),
  threadId: z.string().min(1).max(100),
});

/** Agent → backend: a follow-up draft was saved in the person's Gmail (not sent). */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, Body);
  if (!r.ok) return r.error;
  await markDrafted(r.db, r.agent.userId, r.body.threadId);
  return json({ ok: true });
}
