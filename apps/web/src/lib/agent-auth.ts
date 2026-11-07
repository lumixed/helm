import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Phase 0 agent tokens: HMAC(AGENT_EVENT_SECRET, studentId), so no database is needed yet.
 * Phase 1 replaces this with the PRD design (random 32 bytes per agent, only a hash stored),
 * keeping the same `verifyAgentToken` signature.
 */
export function deriveAgentToken(studentId: string, secret = requireSecret()): string {
  return createHmac('sha256', secret).update(`helm-agent:v1:${studentId}`).digest('base64url');
}

export function verifyAgentToken(
  studentId: string,
  token: string,
  secret = requireSecret(),
): boolean {
  const expected = Buffer.from(deriveAgentToken(studentId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim() || null;
}

function requireSecret(): string {
  const s = process.env.AGENT_EVENT_SECRET;
  if (!s || s.length < 16) throw new Error('AGENT_EVENT_SECRET must be set (16+ chars)');
  return s;
}
