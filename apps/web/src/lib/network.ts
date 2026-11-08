import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { AgentRow } from '@/db/schema';
import type { MaritimeClient } from './maritime';

/**
 * The only hosts a student's agent may reach (PRD v2 WP-5). Enforced by Maritime on the host,
 * outside the VM, so a compromised agent can't send data anywhere else. The Maritime platform
 * itself (including its LLM proxy) stays reachable in every mode.
 *   - the Helm backend (events, results, the demo portal),
 *   - the LLM API the agent calls directly (Gemini),
 *   - anything extra in EGRESS_ALLOWLIST (comma-separated).
 */
export function egressAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts = new Set<string>();
  if (env.APP_BASE_URL) hosts.add(new URL(env.APP_BASE_URL).hostname);
  for (const h of (env.EGRESS_LLM_HOSTS ?? 'generativelanguage.googleapis.com').split(','))
    if (h.trim()) hosts.add(h.trim());
  for (const h of (env.EGRESS_ALLOWLIST ?? '').split(',')) if (h.trim()) hosts.add(h.trim());
  // Canvas calendar feeds (S3): the agent fetches the person's own feed.
  hosts.add('*.instructure.com');
  // Throwaway sandboxes (WP-6): each one's data plane is api-<id>.<region>.sb.mtm.sh.
  if (env.SANDBOX_PARSING !== 'off') hosts.add('*.sb.mtm.sh');
  // Read-only Gmail (PRD v3): only Google's token endpoint and the Gmail API, nothing else.
  if (env.GOOGLE_CLIENT_ID)
    for (const h of ['oauth2.googleapis.com', 'gmail.googleapis.com']) hosts.add(h);
  return [...hosts].sort();
}

export const networkHash = (allow: string[]) =>
  createHash('sha256').update(JSON.stringify(allow)).digest('hex').slice(0, 16);

/** Apply the allowlist if it isn't in force yet. Idempotent; safe on every status check. */
export async function ensureEgressPolicy(
  db: Db,
  row: AgentRow,
  maritime: MaritimeClient,
  allow = egressAllowlist(),
): Promise<'applied' | 'unchanged' | 'skipped'> {
  if (!row.maritimeAgentId || row.maritimeAgentId === 'local' || allow.length === 0)
    return 'skipped';
  if (process.env.EGRESS_MODE === 'all') return 'skipped'; // emergency switch while debugging
  const hash = networkHash(allow);
  if (row.networkHash === hash) return 'unchanged';
  await maritime.putNetwork(row.maritimeAgentId, {
    internet: { mode: 'list', allow, deny: [], presetId: null },
  });
  await db.update(schema.agents).set({ networkHash: hash }).where(eq(schema.agents.id, row.id));
  return 'applied';
}
