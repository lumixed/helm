/**
 * Maritime Linux desktops ("computers", PRD v2 WP-7). Only the calls Helm uses; shapes verified in
 * the 2026-11-07 spike (docs/maritime-notes.md). Server-side only: needs a key that can drive
 * computers, which never goes into an agent VM.
 */
export interface Computer {
  id: string;
  status: string;
  /** agent, or human while a person holds a takeover link */
  mode: 'agent' | 'human' | string;
  lastTakeoverResult: string | null;
}

export interface ComputersClient {
  /** Get-or-create the person's desktop (idempotent on externalUserId). */
  ensure(externalUserId: string): Promise<Computer>;
  get(id: string): Promise<Computer>;
  /** Wake from sleep (about a second from a snapshot). Idempotent. */
  wake(id: string): Promise<void>;
  /** Run actions; returns nothing (screenshots come from screenshot()). */
  act(id: string, actions: Record<string, unknown>[]): Promise<void>;
  screenshot(id: string): Promise<Uint8Array>;
  sleep(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Signed link. control = takeover until the person clicks Done; watch = view only. */
  viewer(
    id: string,
    mode: 'watch' | 'control',
    ttlS: number,
    reason?: string,
  ): Promise<{ url: string; expiresAt: string }>;
}

export class ComputerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function computersClient(opts: {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}): ComputersClient {
  const base = `${(opts.baseUrl ?? 'https://api.maritime.sh').replace(/\/+$/, '')}/api/v1/computers`;
  const f = opts.fetch ?? fetch;
  async function call(method: string, path: string, body?: unknown, binary = false) {
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new ComputerError(res.status, e.error ?? 'error', e.message ?? `HTTP ${res.status}`);
    }
    if (binary) return new Uint8Array(await res.arrayBuffer());
    return res.status === 204 ? null : res.json();
  }
  const enc = encodeURIComponent;
  return {
    async ensure(externalUserId) {
      return (await call('POST', '', {
        externalUserId,
        name: `helm-${externalUserId}`.slice(0, 60),
      })) as Computer;
    },
    async get(id) {
      return (await call('GET', `/${enc(id)}`)) as Computer;
    },
    async wake(id) {
      await call('POST', `/${enc(id)}/wake`);
    },
    async act(id, actions) {
      await call('POST', `/${enc(id)}/actions`, { actions });
    },
    async screenshot(id) {
      return (await call(
        'GET',
        `/${enc(id)}/screenshot?format=jpeg&quality=80`,
        undefined,
        true,
      )) as Uint8Array;
    },
    async sleep(id) {
      await call('POST', `/${enc(id)}/sleep`);
    },
    async remove(id) {
      await call('DELETE', `/${enc(id)}`);
    },
    async viewer(id, mode, ttlS, reason) {
      return (await call('POST', `/${enc(id)}/viewer`, {
        mode,
        ttlS,
        ...(reason ? { reason } : {}),
      })) as {
        url: string;
        expiresAt: string;
      };
    },
  };
}

export function computersFromEnv(env: NodeJS.ProcessEnv = process.env): ComputersClient | null {
  const key = env.MARITIME_COMPUTERS_KEY || env.MARITIME_API_KEY;
  return key ? computersClient({ apiKey: key, baseUrl: env.MARITIME_API_URL }) : null;
}
