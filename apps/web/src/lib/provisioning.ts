import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  AGENT_CONFIG_PATH,
  AGENT_ENV,
  AgentRuntimeConfig,
  type AgentRuntimeConfigInput,
} from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { AgentRow, User } from '@/db/schema';
import { generateAgentToken } from './agent-auth';
import { ensureEgressPolicy } from './network';
import { portalBaseUrl, portalCredentials } from './portal';
import {
  MaritimeError,
  type EnvSeed,
  type MaritimeAgentStatus,
  type MaritimeClient,
} from './maritime';

/**
 * Per-student limits (PRD v2 WP-3). The AI cap applies to Maritime LLM calls; wakes_per_hour is
 * well above what the demo needs (brief + heartbeat + a few events per hour).
 */
export const STUDENT_POLICY = {
  llm_spend_cap_cents_per_month: 300,
  wakes_per_hour: 120,
  idle_sleep_seconds: 300,
  mem_mb: 2048,
  vcpus: 1,
  disk_gb: 5,
} as const;

/** Maritime end-user id for a Helm student (PRD M2). */
export const externalIdFor = (userId: string) => `user_${userId}`;

export interface ProvisionEnv {
  appBaseUrl: string;
  /** Prebuilt agent image (fast: ~1 min to ready). Preferred. */
  agentImage?: string;
  /** Or a source upload from `maritime agents upload-source` (slow: builds, ~4 min). */
  agentUploadKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  demoMode: boolean;
}

export function provisionEnvFromProcess(): ProvisionEnv {
  const e = process.env;
  if (!e.APP_BASE_URL) throw new Error('APP_BASE_URL is not set');
  return {
    appBaseUrl: e.APP_BASE_URL.replace(/\/+$/, ''),
    agentImage: e.MARITIME_AGENT_IMAGE || undefined,
    agentUploadKey: e.MARITIME_AGENT_UPLOAD_KEY || undefined,
    geminiApiKey: e.GEMINI_API_KEY || undefined,
    geminiModel: e.GEMINI_MODEL || undefined,
    demoMode: e.DEMO_MODE === 'true',
  };
}

const STATUS_MAP: Record<MaritimeAgentStatus, AgentRow['status']> = {
  active: 'ready',
  sleeping: 'asleep',
  deploying: 'provisioning',
  stopped: 'asleep',
  error: 'error',
};

/**
 * MARITIME_AGENT_IMAGE=auto: use the image of the newest active agent named "helm-image-*". Those
 * agents are built by scripts/upgrade-agents.sh, so shipping a new agent needs no env change.
 */
let imageCache: { at: number; image: string } | null = null;
export async function latestReleaseImage(
  maritime: MaritimeClient,
  now = Date.now(),
): Promise<string> {
  if (imageCache && now - imageCache.at < 5 * 60_000) return imageCache.image;
  const releases = (await maritime.listAgents())
    .filter((a) => a.name.startsWith('helm-image-') && a.imageName && a.status !== 'error')
    .sort(
      (a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
        b.name.localeCompare(a.name, undefined, { numeric: true }),
    );
  const image = releases[0]?.imageName;
  if (!image) throw new Error('No helm-image-* agent found. Run scripts/upgrade-agents.sh first.');
  imageCache = { at: now, image };
  return image;
}

/**
 * Get or create the student's agent. Safe to call on every sign-in and page load:
 * one `agents` row per user (unique), and Maritime's createAgent is idempotent on externalId.
 */
export async function ensureStudentAgent(
  db: Db,
  user: User,
  maritime: MaritimeClient,
  env: ProvisionEnv,
): Promise<AgentRow> {
  const existing = await getAgentRow(db, user.id);
  if (existing?.maritimeAgentId) return existing;
  if (
    existing &&
    existing.status !== 'error' &&
    Date.now() - existing.createdAt.getTime() < 60_000
  ) {
    return existing; // another request is provisioning right now
  }

  // The raw token only lives in this function and in the agent's encrypted env.
  const { token, hash } = generateAgentToken();
  let row: AgentRow;
  if (existing) {
    [row] = (await db
      .update(schema.agents)
      .set({ agentTokenHash: hash, status: 'provisioning', lastError: null })
      .where(eq(schema.agents.id, existing.id))
      .returning()) as [AgentRow];
  } else {
    const inserted = await db
      .insert(schema.agents)
      .values({ userId: user.id, agentTokenHash: hash })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return (await getAgentRow(db, user.id))!; // lost a race; fine
    row = inserted[0]!;
  }

  const externalId = externalIdFor(user.id);
  try {
    if (env.agentImage === 'auto') env = { ...env, agentImage: await latestReleaseImage(maritime) };
    if (!env.agentImage && !env.agentUploadKey) {
      throw new Error('Set MARITIME_AGENT_IMAGE (or "auto") or MARITIME_AGENT_UPLOAD_KEY');
    }
    await maritime.upsertEndUser(externalId, {
      displayName: user.name || 'Helm student',
      metadata: { helmUserId: user.id },
      tags: env.demoMode ? ['helm', 'demo'] : ['helm'],
    });
    const { agent, created } = await maritime.createEndUserAgent(externalId, {
      ...(env.agentImage ? { imageName: env.agentImage } : { uploadS3Key: env.agentUploadKey }),
      idleTtlSeconds: 300,
      useMaritimeLlm: process.env.MARITIME_LLM !== 'off',
      initialEnvVars: agentEnv(user, token, env),
    });
    if (!created) {
      // An agent already existed at Maritime (e.g. a crash after create). Its env holds a token we
      // no longer know. Surface it instead of failing silently later (PRD principle 3).
      await setAgent(db, row.id, {
        maritimeAgentId: agent.id,
        status: 'error',
        lastError: 'Agent already existed with an older token. Delete it in Maritime and retry.',
      });
      return (await getAgentRow(db, user.id))!;
    }
    await setAgent(db, row.id, {
      maritimeAgentId: agent.id,
      status: STATUS_MAP[agent.status] ?? 'provisioning',
      // The portal login went in with the initial env.
      portalEnvAt: portalEnv(user.id).length ? new Date() : null,
    });
    // Bounded cost and wakes per student (PRD S8). Needs no special scope; failure is non-fatal.
    await maritime
      .setPolicy(externalId, STUDENT_POLICY)
      .catch((err: unknown) => console.warn('[provision] setPolicy failed', String(err)));
  } catch (err) {
    await setAgent(db, row.id, { status: 'error', lastError: describe(err) });
  }
  return (await getAgentRow(db, user.id))!;
}

/** Refresh status from Maritime and write the settings file once the agent is up. */
export async function refreshAgent(
  db: Db,
  user: User,
  maritime: MaritimeClient,
): Promise<AgentRow | null> {
  const row = await getAgentRow(db, user.id);
  if (!row?.maritimeAgentId) return row;
  try {
    const remote = await maritime.getAgent(row.maritimeAgentId);
    const status = STATUS_MAP[remote.status] ?? row.status;
    const lastError = row.lastError?.startsWith('Agent already existed') ? row.lastError : null;
    await setAgent(db, row.id, { status: lastError ? 'error' : status, lastError });
    if (!lastError && (status === 'ready' || status === 'asleep') && settingsStale(row, user)) {
      await writeAgentSettings(db, user, maritime);
    }
    if (!lastError) {
      await ensureEgressPolicy(db, row, maritime).catch((err: unknown) =>
        console.warn('[network] allowlist not applied yet', String(err)),
      );
      await ensurePortalEnv(db, row, maritime).catch((err: unknown) =>
        console.warn('[portal] login not set on agent yet', String(err)),
      );
    }
  } catch (err) {
    if (err instanceof MaritimeError && err.status === 404) {
      await setAgent(db, row.id, { status: 'error', lastError: 'Agent not found at Maritime' });
    } else {
      console.warn('[provision] refresh failed', String(err));
    }
  }
  return getAgentRow(db, user.id);
}

/** The settings file content for a student. Contains no secrets. */
export function agentSettings(user: User, appBaseUrl = process.env.APP_BASE_URL): string {
  const settings: AgentRuntimeConfigInput = {
    v: 1,
    ...(appBaseUrl ? { backendUrl: appBaseUrl.replace(/\/+$/, '') } : {}),
    timezone: user.timezone,
    briefTime: user.briefTimeLocal,
    demoMode: process.env.DEMO_MODE === 'true',
  };
  return JSON.stringify(AgentRuntimeConfig.parse(settings), null, 2);
}

const hashSettings = (content: string) => createHash('sha256').update(content).digest('hex');

/** True when the agent's settings file is missing or out of date. */
export function settingsStale(row: AgentRow, user: User): boolean {
  return row.configHash !== hashSettings(agentSettings(user));
}

/** Push changeable settings (backend URL, brief time, timezone) to the agent's disk. Wakes it. */
export async function writeAgentSettings(
  db: Db,
  user: User,
  maritime: MaritimeClient,
): Promise<void> {
  const row = await getAgentRow(db, user.id);
  if (!row?.maritimeAgentId) return;
  const content = agentSettings(user);
  await maritime.mkdir(
    row.maritimeAgentId,
    AGENT_CONFIG_PATH.slice(0, AGENT_CONFIG_PATH.lastIndexOf('/')),
  );
  await maritime.writeFile(row.maritimeAgentId, AGENT_CONFIG_PATH, content);
  await setAgent(db, row.id, { configWrittenAt: new Date(), configHash: hashSettings(content) });
}

/** Delete a student everywhere: their Maritime end user (agents, tokens) and all Helm data. */
export async function deleteStudent(
  db: Db,
  userId: string,
  maritime: MaritimeClient,
): Promise<void> {
  try {
    await maritime.deleteEndUser(externalIdFor(userId));
  } catch (err) {
    if (!(err instanceof MaritimeError && err.status === 404)) throw err;
  }
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

export function agentEnv(user: User, token: string, env: ProvisionEnv) {
  const seeds: EnvSeed[] = [
    { key: AGENT_ENV.studentId, value: user.id, isSecret: false },
    { key: AGENT_ENV.backendUrl, value: env.appBaseUrl, isSecret: false },
    { key: AGENT_ENV.agentToken, value: token, isSecret: true },
    { key: AGENT_ENV.timezone, value: user.timezone, isSecret: false },
    { key: AGENT_ENV.briefTime, value: user.briefTimeLocal, isSecret: false },
    { key: AGENT_ENV.demoMode, value: String(env.demoMode), isSecret: false },
  ];
  if (env.geminiApiKey)
    seeds.push({ key: AGENT_ENV.geminiKey, value: env.geminiApiKey, isSecret: true });
  if (env.geminiModel)
    seeds.push({ key: AGENT_ENV.geminiModel, value: env.geminiModel, isSecret: false });
  seeds.push(...portalEnv(user.id));
  return seeds;
}

/** The student's own demo-portal login, only ever stored as encrypted env on their agent. */
export function portalEnv(userId: string): EnvSeed[] {
  const portal = portalBaseUrl();
  if (!portal) return [];
  let c: ReturnType<typeof portalCredentials>;
  try {
    c = portalCredentials(userId);
  } catch (err) {
    // No AUTH_SECRET: the agent is still useful without a portal login. Never block provisioning.
    console.warn('[portal] no portal login for this agent', String(err));
    return [];
  }
  return [
    { key: AGENT_ENV.portalUrl, value: portal, isSecret: false },
    { key: AGENT_ENV.portalUsername, value: c.username, isSecret: true },
    { key: AGENT_ENV.portalPassword, value: c.password, isSecret: true },
  ];
}

/** Agents created before M7 get their portal login through the env API, once. */
export async function ensurePortalEnv(db: Db, row: AgentRow, maritime: MaritimeClient) {
  if (row.portalEnvAt || !row.maritimeAgentId || row.maritimeAgentId === 'local') return false;
  const seeds = portalEnv(row.userId);
  if (seeds.length === 0) return false;
  for (const s of seeds) await maritime.setEnv(row.maritimeAgentId, s.key, s.value, s.isSecret);
  await maritime.reloadEnv(row.maritimeAgentId);
  await setAgent(db, row.id, { portalEnvAt: new Date() });
  return true;
}

async function getAgentRow(db: Db, userId: string): Promise<AgentRow | null> {
  const [row] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.userId, userId))
    .limit(1);
  return row ?? null;
}

async function setAgent(db: Db, id: string, values: Partial<typeof schema.agents.$inferInsert>) {
  await db.update(schema.agents).set(values).where(eq(schema.agents.id, id));
}

function describe(err: unknown): string {
  if (err instanceof MaritimeError) {
    if (err.status === 402) return 'Maritime billing needs attention (trial or plan).';
    if (err.status === 429) return 'Maritime is busy (too many agents awake). Retry shortly.';
    return `Maritime error ${err.status}: ${err.detail}`.slice(0, 500);
  }
  return String(err instanceof Error ? err.message : err).slice(0, 500);
}

/**
 * Local development: one agent on this machine (`pnpm dev:agent`) instead of Maritime. The agent
 * gets its identity through the settings file, which is acceptable only on a developer machine.
 */
export async function ensureLocalAgent(db: Db, user: User, dataDir: string): Promise<AgentRow> {
  const { token, hash } = generateAgentToken();
  const existing = await getAgentRow(db, user.id);
  if (existing)
    await setAgent(db, existing.id, {
      agentTokenHash: hash,
      maritimeAgentId: 'local',
      status: 'ready',
      lastError: null,
    });
  else
    await db
      .insert(schema.agents)
      .values({ userId: user.id, agentTokenHash: hash, maritimeAgentId: 'local', status: 'ready' });
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(dataDir, 'helm', 'config.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const settings = {
    ...(JSON.parse(agentSettings(user)) as object),
    studentId: user.id,
    agentToken: token,
  };
  await fs.writeFile(file, JSON.stringify(AgentRuntimeConfig.parse(settings), null, 2));
  const row = (await getAgentRow(db, user.id))!;
  await setAgent(db, row.id, {
    configWrittenAt: new Date(),
    configHash: hashSettings(agentSettings(user)),
  });
  return (await getAgentRow(db, user.id))!;
}

export function localAgentDir(): string | null {
  return process.env.HELM_LOCAL_AGENT_URL &&
    process.env.HELM_LOCAL_AGENT_DATA_DIR &&
    !process.env.VERCEL
    ? process.env.HELM_LOCAL_AGENT_DATA_DIR
    : null;
}
