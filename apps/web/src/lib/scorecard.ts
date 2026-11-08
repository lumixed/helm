import { and, desc, eq, like, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { AgentRow, User } from '@/db/schema';
import { listApps } from './desktop';
import { formatWhen } from './format';
import { externalIdFor } from './provisioning';

/**
 * "Under the hood: Maritime" (PRD v2 section 6). Every row is built from live data: our database
 * and read-only Maritime API calls. A feature is "active" only if the data shows it running.
 * Secret values are never read or shown, only counts.
 */
export type RowStatus = 'active' | 'partial' | 'not_active' | 'unknown';

export interface ScoreRow {
  id: string;
  feature: string;
  how: string;
  status: RowStatus;
  evidence: { label: string; value: string }[];
  note?: string;
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

const list = <T>(v: unknown): T[] =>
  (Array.isArray(v) ? v : ((v as { results?: T[] })?.results ?? [])) as T[];
const short = (id: string) => `${id.slice(0, 8)}…`;

/** Run one probe; failures become "couldn't load", never invented data. */
async function probe<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; v: T } | { ok: false; err: string }> {
  try {
    return { ok: true, v: await fn() };
  } catch (err) {
    return { ok: false, err: err instanceof Error ? err.message : String(err) };
  }
}

export async function buildScorecard(
  db: Db,
  user: User,
  agent: AgentRow | null,
): Promise<ScoreRow[]> {
  const get = maritimeGet();
  const mid =
    agent?.maritimeAgentId && agent.maritimeAgentId !== 'local' ? agent.maritimeAgentId : null;
  const ext = externalIdFor(user.id);
  const tz = user.timezone;
  const when = (d: Date | string | number) => formatWhen(new Date(d), tz);

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const from = monthStart.toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const [remote, triggers, env, files, network, activity, policy, usage, hooks, logs] =
    await Promise.all([
      probe(async () =>
        get && mid
          ? get<{ status: string; imageName?: string }>(`/api/agents/${mid}`)
          : Promise.reject(new Error('no agent')),
      ),
      probe(async () =>
        get && mid
          ? list<{
              type: string;
              enabled: boolean;
              config?: { schedule?: string; tz?: string; label?: string; source?: string };
            }>(await get(`/api/agents/${mid}/triggers`))
          : Promise.reject(new Error('no agent')),
      ),
      probe(async () =>
        get && mid
          ? list<{ key: string; isSecret: boolean }>(await get(`/api/agents/${mid}/env`))
          : Promise.reject(new Error('no agent')),
      ),
      probe(async () =>
        get && mid
          ? get<{
              root: string;
              entries: { name: string; size: number; mtime?: number; modifiedAt?: number }[];
            }>(`/api/agents/${mid}/files/list?path=/data`)
          : Promise.reject(new Error('no agent')),
      ),
      probe(async () =>
        get && mid
          ? get<{ internet: { mode: string; allow: string[] }; enforcement?: string }>(
              `/api/v1/network/workloads/agent/${mid}`,
            )
          : Promise.reject(new Error('no agent')),
      ),
      probe(async () =>
        get && mid
          ? list<{ host: string; outcome: string; at: string }>(
              (
                await get<{ items: unknown[] }>(
                  `/api/v1/network/activity?workloadKind=agent&workloadId=${mid}&limit=100`,
                )
              ).items,
            )
          : Promise.reject(new Error('no agent')),
      ),
      probe(async () =>
        get
          ? get<{ policy: Record<string, number> | null }>(
              `/api/v1/end-users/${encodeURIComponent(ext)}/policy`,
            )
          : Promise.reject(new Error('no key')),
      ),
      probe(async () =>
        get && mid
          ? (list<{ agentId: string; computeMinutes: number; llmCostCents: number }>(
              (await get<{ agents: unknown[] }>(`/api/v1/usage?from=${from}&to=${to}`)).agents,
            ).find((a) => a.agentId === mid) ?? null)
          : null,
      ),
      probe(async () =>
        get
          ? list<{ url: string; isActive?: boolean }>(await get('/api/v1/webhooks'))
          : Promise.reject(new Error('no key')),
      ),
      probe(async () =>
        get && mid
          ? list<{ timestamp: string; message: string }>(
              await get(`/api/agents/${mid}/logs?limit=100`),
            )
          : Promise.reject(new Error('no agent')),
      ),
    ]);

  const events = await db
    .select({
      type: schema.agentEvents.type,
      reason: schema.agentEvents.reason,
      at: schema.agentEvents.occurredAt,
      payload: schema.agentEvents.payloadJson,
      requestId: schema.agentEvents.requestId,
    })
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.userId, user.id))
    .orderBy(desc(schema.agentEvents.occurredAt))
    .limit(300);
  const lifecycle = await db
    .select({
      kind: schema.maritimeEvents.kind,
      at: schema.maritimeEvents.occurredAt,
      payload: schema.maritimeEvents.payloadJson,
    })
    .from(schema.maritimeEvents)
    .where(
      and(
        eq(schema.maritimeEvents.userId, user.id),
        sql`${schema.maritimeEvents.kind} not like 'helm.%'`,
      ),
    )
    .orderBy(desc(schema.maritimeEvents.occurredAt))
    .limit(50);
  const netTests = await db
    .select({ at: schema.maritimeEvents.occurredAt, payload: schema.maritimeEvents.payloadJson })
    .from(schema.maritimeEvents)
    .where(
      and(
        eq(schema.maritimeEvents.userId, user.id),
        like(schema.maritimeEvents.kind, 'helm.network_test'),
      ),
    )
    .orderBy(desc(schema.maritimeEvents.occurredAt))
    .limit(10);

  const wakes = events.filter((e) => e.type === 'agent.woke');
  const lastWake = wakes[0];
  const cronWakes = wakes.filter((e) => e.payload.source === 'scheduled');
  const hookWakes = wakes.filter((e) => e.payload.source === 'webhook');
  const rows: ScoreRow[] = [];
  const unavailable = (r: { ok: false; err: string }) => `couldn't load (${r.err})`;

  // 1. End users: one agent per person.
  rows.push({
    id: 'end-users',
    feature: 'End users: one agent per person',
    how: 'Each person gets their own agent, created at sign-up and keyed by their Helm id.',
    status: mid ? 'active' : 'not_active',
    evidence: [
      { label: 'End-user id', value: ext.replace(/^(user_.{8}).*$/, '$1…') },
      { label: 'Agent', value: mid ? short(mid) : 'none yet' },
      {
        label: 'Status',
        value: remote.ok
          ? remote.v.status
          : mid
            ? unavailable(remote)
            : (agent?.status ?? 'not provisioned'),
      },
    ],
  });

  // 2. Persistent /data.
  const newest = files.ok
    ? Math.max(0, ...files.v.entries.map((e) => e.mtime ?? e.modifiedAt ?? 0))
    : 0;
  rows.push({
    id: 'data',
    feature: 'Persistent /data disk',
    how: 'Memory, the event queue, settings and uploaded documents live on the agent’s own disk and survive sleep.',
    status: files.ok ? 'active' : mid ? 'unknown' : 'not_active',
    evidence: files.ok
      ? [
          { label: 'Items in /data', value: String(files.v.entries.length) },
          { label: 'Last write', value: newest ? when(newest * 1000) : 'unknown' },
        ]
      : [{ label: '/data', value: mid ? unavailable(files) : 'no agent' }],
  });

  // 3. Sleep and wake.
  const latency =
    typeof lastWake?.payload.latencyMs === 'number'
      ? `${(lastWake.payload.latencyMs / 1000).toFixed(1)}s`
      : null;
  const sleeps = lifecycle.filter((l) => l.kind === 'agent.sleeping').length;
  const WOKEN = /Agent woken \(snapshot, (\d+)ms, reason=(\w+)/;
  const platformWakes = logs.ok
    ? logs.v.map((l) => ({ at: l.timestamp, m: WOKEN.exec(l.message) })).filter((w) => w.m)
    : [];
  const scheduledWakes = platformWakes.filter((w) => w.m![2] === 'autonomous').length;
  rows.push({
    id: 'sleep-wake',
    feature: 'Sleep and wake',
    how: 'The agent sleeps when idle and wakes within seconds for the brief, a message or a hand-in.',
    status: lastWake ? 'active' : 'not_active',
    evidence: [
      {
        label: 'Last wake',
        value: lastWake ? `${when(lastWake.at)} · ${lastWake.reason}` : 'none yet',
      },
      ...(latency ? [{ label: 'Wake latency', value: `${latency} after the trigger` }] : []),
      ...(platformWakes[0]
        ? [
            {
              label: 'Last wake per Maritime',
              value: `${when(platformWakes[0].at)} · restored from snapshot in ${(Number(platformWakes[0].m![1]) / 1000).toFixed(1)}s (${platformWakes[0].m![2]})`,
            },
            { label: 'Scheduled wakes in recent log', value: String(scheduledWakes) },
          ]
        : []),
      { label: 'Wakes recorded', value: String(wakes.length) },
      { label: 'Sleeps reported by Maritime', value: String(sleeps) },
    ],
  });

  // 4. Cron and webhook triggers. Each reminder is its own cron (GET /schedules → byo:reminder-<id>).
  const crons = triggers.ok ? triggers.v.filter((t) => t.type === 'cron' && t.enabled) : [];
  const reminderTitles = new Map(
    (
      await db
        .select({ id: schema.reminders.id, title: schema.reminders.title })
        .from(schema.reminders)
        .where(eq(schema.reminders.userId, user.id))
    ).map((r) => [r.id, r.title]),
  );
  const cronLabel = (label?: string) => {
    const m = /reminder-([0-9a-f-]{36})/.exec(label ?? '');
    if (!m) return label ?? 'cron';
    return `Reminder: ${reminderTitles.get(m[1]!) ?? 'removed'}`;
  };
  const reminderFires = events.filter((e) => e.type === 'reminder.fired');
  const byCron = reminderFires.filter((e) => e.payload.firedBy === 'maritime_cron');
  rows.push({
    id: 'triggers',
    feature: 'Cron and webhook triggers',
    how: 'The morning brief, every reminder (one cron each, in the person’s timezone) and a safety-net check run on platform cron; emails, documents and hand-ins arrive by webhook.',
    status:
      crons.length > 0 && hookWakes.length > 0
        ? 'active'
        : crons.length > 0 || hookWakes.length > 0
          ? 'partial'
          : triggers.ok || !mid
            ? 'not_active'
            : 'unknown',
    evidence: [
      ...(triggers.ok
        ? crons.map((t) => ({
            label: cronLabel(t.config?.label),
            value: `${t.config?.schedule ?? '?'} (${t.config?.tz ?? 'UTC'})`,
          }))
        : [{ label: 'Triggers', value: mid ? unavailable(triggers) : 'no agent' }]),
      {
        label: 'Cron wakes',
        value: cronWakes[0] ? `${cronWakes.length}, last ${when(cronWakes[0].at)}` : 'none yet',
      },
      {
        label: 'Webhook wakes',
        value: hookWakes[0] ? `${hookWakes.length}, last ${when(hookWakes[0].at)}` : 'none yet',
      },
      ...(reminderFires.length
        ? [
            {
              label: 'Reminders sent',
              value: `${byCron.length} woken by Maritime cron${byCron[0] ? ` (last ${when(byCron[0].at)}, ${Number(byCron[0].payload.lateS ?? 0)}s after the minute)` : ''}, ${reminderFires.length - byCron.length} by the safety net`,
            },
          ]
        : []),
    ],
  });

  // 5. Encrypted env.
  const secrets = env.ok ? env.v.filter((e) => e.isSecret).length : null;
  rows.push({
    id: 'env',
    feature: 'Encrypted secrets',
    how: 'The agent’s own token and API keys are encrypted env vars, injected only into this person’s VM. Values are never shown here.',
    status: secrets ? 'active' : env.ok || !mid ? 'not_active' : 'unknown',
    evidence: [
      {
        label: 'Secrets on this agent',
        value:
          secrets !== null
            ? String(secrets)
            : mid
              ? unavailable(env as { ok: false; err: string })
              : 'no agent',
      },
    ],
  });

  // 6. Files API + scoped tokens (chat).
  const uploads = events.filter((e) => e.type === 'intake.parsed').length;
  const mints = await db
    .select({ at: schema.maritimeEvents.occurredAt })
    .from(schema.maritimeEvents)
    .where(
      and(
        eq(schema.maritimeEvents.userId, user.id),
        eq(schema.maritimeEvents.kind, 'helm.token_minted'),
      ),
    )
    .orderBy(desc(schema.maritimeEvents.occurredAt))
    .limit(200);
  rows.push({
    id: 'files',
    feature: 'Files API and scoped tokens',
    how: 'Documents go straight to the person’s agent; the app keeps only the dates it finds.',
    status:
      uploads > 0 && mints.length > 0
        ? 'active'
        : uploads > 0 || mints.length > 0
          ? 'partial'
          : 'not_active',
    evidence: [
      { label: 'Documents read by the agent', value: String(uploads) },
      {
        label: 'Short-lived chat tokens (eu_)',
        value: mints.length
          ? `${mints.length} minted · chat only · last ${when(mints[0]!.at.getTime())}`
          : 'none yet',
      },
    ],
    note: mints.length
      ? 'Chat tokens open only this person’s agent and expire in minutes. Where Maritime doesn’t allow this site’s address for browsers, Helm relays chat with the same kind of token.'
      : 'Open Ask to chat with your agent; a short-lived token is minted per session.',
  });

  // 7. Policy caps.
  const p = policy.ok ? policy.v.policy : null;
  const mllm = env.ok ? env.v.some((e) => e.key === 'OPENAI_API_KEY') : false;
  rows.push({
    id: 'policy',
    feature: 'Spend and wake caps',
    how: 'A per-person policy caps AI spend, wakes per hour, idle time and machine size.',
    status: p ? (mllm ? 'active' : 'partial') : policy.ok ? 'not_active' : 'unknown',
    evidence: p
      ? [
          {
            label: 'AI spend cap',
            value:
              p.llm_spend_cap_cents_per_month != null
                ? `$${(p.llm_spend_cap_cents_per_month / 100).toFixed(2)} / month`
                : 'none',
          },
          { label: 'Wakes per hour', value: String(p.wakes_per_hour ?? 'default') },
          {
            label: 'Idle sleep',
            value: p.idle_sleep_seconds != null ? `${p.idle_sleep_seconds}s` : 'default',
          },
          {
            label: 'Machine',
            value: `${p.mem_mb ?? '?'} MB · ${p.vcpus ?? '?'} vCPU · ${p.disk_gb ?? '?'} GB`,
          },
          {
            label: 'Awake this month',
            value:
              usage.ok && usage.v ? `${usage.v.computeMinutes.toFixed(0)} min` : 'not reported yet',
          },
        ]
      : [{ label: 'Policy', value: policy.ok ? 'none set' : unavailable(policy) }],
    note: mllm
      ? undefined
      : 'The AI cap applies to Maritime LLM calls. This agent uses Gemini directly, so the AI cap does not limit it yet.',
  });

  // 8. Lifecycle webhooks.
  const sub = hooks.ok ? hooks.v.find((h) => h.url.endsWith('/api/maritime/webhook')) : undefined;
  rows.push({
    id: 'lifecycle',
    feature: 'Lifecycle webhooks',
    how: 'Maritime tells the app when the agent wakes, sleeps or errors; the timeline shows it.',
    status: lifecycle.length > 0 ? 'active' : sub ? 'partial' : hooks.ok ? 'not_active' : 'unknown',
    evidence: [
      {
        label: 'Subscription',
        value: sub
          ? sub.isActive === false
            ? 'disabled'
            : 'active'
          : hooks.ok
            ? 'none'
            : unavailable(hooks),
      },
      { label: 'Events received', value: String(lifecycle.length) },
      ...(lifecycle[0]
        ? [{ label: 'Latest', value: `${lifecycle[0].kind} · ${when(lifecycle[0].at)}` }]
        : []),
    ],
  });

  // 9. Egress allowlist.
  const blocked = activity.ok ? activity.v.filter((a) => a.outcome === 'blocked') : [];
  const lastTest = netTests.find((t) => t.payload.reached === false);
  rows.push({
    id: 'egress',
    feature: 'Network allowlist',
    how: 'The agent can reach only the Helm app and its AI model. Maritime enforces this on the host, outside the VM.',
    status: network.ok
      ? network.v.internet.mode === 'list'
        ? 'active'
        : 'not_active'
      : mid
        ? 'unknown'
        : 'not_active',
    evidence: network.ok
      ? [
          {
            label: 'Mode',
            value: network.v.internet.mode === 'list' ? 'allowlist' : network.v.internet.mode,
          },
          { label: 'Allowed hosts', value: network.v.internet.allow.join(', ') || 'none' },
          {
            label: 'Blocked attempts (recent)',
            value: activity.ok ? String(blocked.length) : unavailable(activity),
          },
          ...(lastTest
            ? [
                {
                  label: 'Last red-team test',
                  value: `${String(lastTest.payload.destination)} refused · ${when(lastTest.at)}`,
                },
              ]
            : []),
        ]
      : [{ label: 'Network', value: mid ? unavailable(network) : 'no agent' }],
  });

  // 10. Ephemeral sandbox.
  const sandboxRuns = events.filter((e) => e.type === 'sandbox.created').length;
  rows.push({
    id: 'sandbox',
    feature: 'Throwaway sandboxes',
    how: 'Untrusted files are opened in a sandbox that is deleted with its disk afterwards.',
    status: sandboxRuns > 0 ? 'active' : 'not_active',
    evidence: [{ label: 'Sandbox runs', value: String(sandboxRuns) }],
    note: sandboxRuns > 0 ? undefined : 'Files are read inside the person’s own agent VM today.',
  });

  // 11. Linux desktop.
  const apps = await listApps(db, user).catch(() => []);
  const connected = apps.filter((a) => a.status === 'linked');
  rows.push({
    id: 'desktop',
    feature: 'Linux desktop and takeover',
    how: 'A private desktop per person reads messaging apps in a real browser; the person takes over for logins.',
    status:
      connected.length > 0
        ? 'active'
        : apps.some((a) => a.status !== 'disconnected')
          ? 'partial'
          : 'not_active',
    evidence: apps.length
      ? apps.map((a) => ({
          label: a.label,
          value: `${a.status}${a.lastCheckLabel ? ` · checked ${a.lastCheckLabel}` : ''}`,
        }))
      : [{ label: 'Desktop', value: 'not set up' }],
  });

  return rows;
}
