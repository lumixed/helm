import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { AgentRow, User } from '@/db/schema';
import { externalIdFor } from './provisioning';

/** Per-person limits set on Maritime and this month's usage (PRD v2 WP-3). Read-only. */
export interface PolicySummary {
  capCents: number | null;
  wakesPerHour: number | null;
  idleSleepSeconds: number | null;
  machine: string | null;
  awakeMinutesThisMonth: number | null;
  /** True when the agent's LLM calls go through Maritime LLM, the only calls the AI cap limits. */
  capCoversLlm: boolean;
}

type Get = <T>(path: string) => Promise<T>;

function maritimeGet(): Get | null {
  const key = process.env.MARITIME_API_KEY;
  if (!key) return null;
  const base = (process.env.MARITIME_API_URL ?? 'https://api.maritime.sh').replace(/\/+$/, '');
  return async <T>(path: string) => {
    const res = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  };
}

const asList = <T>(v: unknown): T[] =>
  (Array.isArray(v) ? v : ((v as { results?: T[] })?.results ?? [])) as T[];

const monthStart = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export async function policySummary(
  user: User,
  agent: AgentRow | null,
): Promise<PolicySummary | null> {
  const get = maritimeGet();
  if (!get) return null;
  const mid =
    agent?.maritimeAgentId && agent.maritimeAgentId !== 'local' ? agent.maritimeAgentId : null;
  const from = monthStart().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [policy, usage, env] = await Promise.allSettled([
    get<{ policy: Record<string, number> | null }>(
      `/api/v1/end-users/${encodeURIComponent(externalIdFor(user.id))}/policy`,
    ),
    mid
      ? get<{ agents: unknown[] }>(`/api/v1/usage?from=${from}&to=${to}`).then(
          (u) =>
            asList<{ agentId: string; computeMinutes: number }>(u.agents).find(
              (a) => a.agentId === mid,
            ) ?? null,
        )
      : Promise.resolve(null),
    mid
      ? get<unknown>(`/api/agents/${mid}/env`).then((e) => asList<{ key: string }>(e))
      : Promise.resolve([]),
  ]);
  if (policy.status !== 'fulfilled' || !policy.value.policy) return null;
  const p = policy.value.policy;
  return {
    capCents: p.llm_spend_cap_cents_per_month ?? null,
    wakesPerHour: p.wakes_per_hour ?? null,
    idleSleepSeconds: p.idle_sleep_seconds ?? null,
    machine: p.mem_mb ? `${p.mem_mb} MB · ${p.vcpus ?? '?'} vCPU · ${p.disk_gb ?? '?'} GB` : null,
    awakeMinutesThisMonth:
      usage.status === 'fulfilled' && usage.value ? Math.round(usage.value.computeMinutes) : null,
    capCoversLlm: env.status === 'fulfilled' && env.value.some((e) => e.key === 'OPENAI_API_KEY'),
  };
}

/** Did Maritime pause this person's AI calls this month (agent.llm_limit_reached)? */
export async function llmPausedThisMonth(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.maritimeEvents.id })
    .from(schema.maritimeEvents)
    .where(
      and(
        eq(schema.maritimeEvents.userId, userId),
        eq(schema.maritimeEvents.kind, 'agent.llm_limit_reached'),
        gte(schema.maritimeEvents.occurredAt, monthStart()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
