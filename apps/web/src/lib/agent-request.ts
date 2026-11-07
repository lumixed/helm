import { z } from 'zod';
import { getDb, type Db } from '@/db';
import { bearer, findAgentByToken } from './agent-auth';
import { fail } from './http';

/**
 * Parse and authorize an agent-facing request: valid bearer token, body matches the schema, and
 * the token belongs to the student named in the body (an agent can only touch its own student).
 */
export type AgentRequest<T> =
  | { ok: false; error: Response }
  | { ok: true; db: Db; agent: { agentId: string; userId: string }; body: T };

export async function agentRequest<T extends z.ZodType<{ studentId: string }>>(
  req: Request,
  schema: T,
): Promise<AgentRequest<z.infer<T>>> {
  const token = bearer(req);
  if (!token) return { ok: false, error: fail(401, 'missing bearer token') };
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { ok: false, error: fail(400, 'invalid JSON') };
  }
  const body = schema.safeParse(json);
  if (!body.success) return { ok: false, error: fail(400, z.prettifyError(body.error)) };
  const db = await getDb();
  const agent = await findAgentByToken(db, token);
  if (!agent || agent.userId !== body.data.studentId)
    return { ok: false, error: fail(403, 'invalid agent token') };
  return { ok: true, db, agent, body: body.data as z.infer<T> };
}
