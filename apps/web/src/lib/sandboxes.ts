import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import { recordHelmEvent } from './submissions';

/**
 * Maritime ephemeral sandboxes (PRD v2 WP-6), shapes verified in the 2026-11-07 spike
 * (docs/maritime-notes.md). Server-side only: the key never reaches an agent.
 */
export interface SandboxClient {
  create(name: string): Promise<{ id: string; dataPlaneUrl: string; secret: string }>;
  end(id: string): Promise<void>;
}

const API = 'https://api.maritime.sh/api/sandboxes/ephemeral';

export function sandboxClient(apiKey: string, f: typeof fetch = fetch): SandboxClient {
  const h = { authorization: `Bearer ${apiKey}` };
  return {
    async create(name) {
      const r = await f(API, {
        method: 'POST',
        headers: {
          ...h,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          name,
          // Gone after 2 idle minutes even if nobody ends it; never longer than 10.
          idleMinutes: 2,
          timeLimitMinutes: 10,
          size: 'small',
          // The parser needs no network at all.
          network: { egress: 'none' },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const j = (await r.json().catch(() => ({}))) as {
        id?: string;
        dataPlaneUrl?: string;
        secret?: string;
        code?: string;
        message?: string;
      };
      if (!r.ok || !j.id || !j.dataPlaneUrl || !j.secret)
        throw new Error(
          `sandbox create ${r.status}: ${[j.code, j.message].filter(Boolean).join(' ') || 'no data'}`,
        );
      return { id: j.id, dataPlaneUrl: j.dataPlaneUrl, secret: j.secret };
    },
    async end(id) {
      const r = await f(`${API}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { ...h, 'idempotency-key': crypto.randomUUID() },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`sandbox end ${r.status}`);
    },
  };
}

export function sandboxesFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxClient | null {
  const key = env.MARITIME_SANDBOX_KEY || env.MARITIME_API_KEY;
  return key ? sandboxClient(key) : null;
}

/** Create a sandbox for this person and record it. Returns what the agent needs, nothing more. */
export async function leaseSandbox(
  db: Db,
  userId: string,
  client: SandboxClient,
  purpose: 'parse_document',
  label: string,
) {
  // Sandbox names take lower-case letters, digits and dashes only (an underscore is refused).
  const sb = await client.create(
    `helm-${purpose.replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
  );
  await db.insert(schema.sandboxRuns).values({ userId, sandboxId: sb.id, purpose });
  await recordHelmEvent(
    db,
    userId,
    'sandbox.created',
    `Created a throwaway sandbox to open "${label}" (no internet, deleted after use)`,
    { sandboxId: sb.id, purpose },
    `helm:sandbox:${sb.id}:created`,
  );
  return { sandboxId: sb.id, dataPlaneUrl: sb.dataPlaneUrl, secret: sb.secret };
}

/** End a sandbox this person owns: Maritime deletes it with its disk. Safe to repeat. */
export async function endSandbox(
  db: Db,
  userId: string,
  sandboxId: string,
  client: SandboxClient,
  result: { ok: boolean; summary: string },
) {
  const [run] = await db
    .select()
    .from(schema.sandboxRuns)
    .where(and(eq(schema.sandboxRuns.sandboxId, sandboxId), eq(schema.sandboxRuns.userId, userId)));
  if (!run) return false;
  await client.end(sandboxId);
  if (run.status !== 'running') return true;
  await db
    .update(schema.sandboxRuns)
    .set({
      status: result.ok ? 'ended' : 'failed',
      endedAt: new Date(),
      resultSummary: result.summary,
    })
    .where(eq(schema.sandboxRuns.id, run.id));
  await recordHelmEvent(
    db,
    userId,
    'sandbox.ended',
    `Deleted the sandbox with its disk${result.ok ? '' : ' (the file could not be read there)'}: ${result.summary}`,
    { sandboxId, purpose: run.purpose, ok: result.ok },
    `helm:sandbox:${sandboxId}:ended`,
  );
  return true;
}
