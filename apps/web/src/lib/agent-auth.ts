import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';

/** Random 32 bytes per agent; only the SHA-256 hash is stored (PRD section 16). */
export function generateAgentToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAgentToken(token) };
}

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim() || null;
}

/** The agent behind a token, or null. Constant work regardless of match (hash lookup). */
export async function findAgentByToken(db: Db, token: string) {
  const [row] = await db
    .select({ agentId: schema.agents.id, userId: schema.agents.userId })
    .from(schema.agents)
    .where(eq(schema.agents.agentTokenHash, hashAgentToken(token)))
    .limit(1);
  return row ?? null;
}
