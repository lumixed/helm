/**
 * Minimal Maritime REST client for the calls Helm needs. We call REST directly because the SDK
 * (maritime-sdk 0.11) does not pass `framework` or `uploadS3Key` when creating an end user's agent.
 * Endpoints and fields verified 2026-11-07; see docs/maritime-notes.md.
 */
export class MaritimeError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly path: string,
  ) {
    super(`Maritime ${path} -> ${status}: ${detail}`);
  }
}

export type MaritimeAgentStatus = 'sleeping' | 'active' | 'deploying' | 'error' | 'stopped';

export interface MaritimeAgent {
  id: string;
  name: string;
  status: MaritimeAgentStatus;
  externalId: string | null;
  imageName?: string | null;
}

export interface EnvSeed {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface CreateAgentInput {
  imageName?: string;
  uploadS3Key?: string;
  idleTtlSeconds?: number;
  initialEnvVars?: EnvSeed[];
}

export interface MaritimeClient {
  upsertEndUser(
    externalId: string,
    body: {
      displayName?: string;
      metadata?: Record<string, string | number | boolean>;
      tags?: string[];
    },
  ): Promise<void>;
  createEndUserAgent(
    externalId: string,
    input: CreateAgentInput,
  ): Promise<{ agent: MaritimeAgent; created: boolean }>;
  getAgent(agentId: string): Promise<MaritimeAgent>;
  mkdir(agentId: string, path: string): Promise<void>;
  writeFile(agentId: string, path: string, content: string): Promise<void>;
  webhookToken(agentId: string): Promise<string>;
  invokeWebhook(agentId: string, token: string, body: string): Promise<void>;
  setPolicy(externalId: string, policy: Record<string, number>): Promise<void>;
  deleteEndUser(externalId: string): Promise<void>;
}

export function maritimeFromEnv(): MaritimeClient {
  const key = process.env.MARITIME_API_KEY;
  if (!key) throw new Error('MARITIME_API_KEY is not set');
  return createMaritimeClient({ apiKey: key, baseUrl: process.env.MARITIME_API_URL });
}

export function createMaritimeClient(opts: {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}): MaritimeClient {
  const base = (opts.baseUrl ?? 'https://api.maritime.sh').replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch;

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    auth = true,
  ): Promise<{ status: number; data: T }> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* plain text */
    }
    if (!res.ok) {
      const detail =
        typeof data === 'object' && data && 'detail' in data
          ? String((data as { detail: unknown }).detail)
          : text.slice(0, 300);
      throw new MaritimeError(res.status, detail, path);
    }
    return { status: res.status, data: data as T };
  }

  const enc = encodeURIComponent;
  return {
    async upsertEndUser(externalId, body) {
      await call('PUT', `/api/v1/end-users/${enc(externalId)}`, body);
    },
    async createEndUserAgent(externalId, input) {
      const { status, data } = await call<MaritimeAgent>(
        'POST',
        `/api/v1/end-users/${enc(externalId)}/agents`,
        {
          framework: 'custom',
          ...input,
        },
      );
      return { agent: data, created: status === 201 };
    },
    async getAgent(agentId) {
      return (await call<MaritimeAgent>('GET', `/api/agents/${enc(agentId)}`)).data;
    },
    async mkdir(agentId, path) {
      await call('POST', `/api/agents/${enc(agentId)}/files/mkdir`, { path });
    },
    async writeFile(agentId, path, content) {
      await call('PUT', `/api/agents/${enc(agentId)}/files/write`, { path, content });
    },
    async webhookToken(agentId) {
      return (await call<{ token: string }>('GET', `/api/webhooks/${enc(agentId)}/token`)).data
        .token;
    },
    async invokeWebhook(agentId, token, body) {
      await call(
        'POST',
        `/api/webhooks/${enc(agentId)}`,
        body,
        { 'x-maritime-webhook-token': token },
        false,
      );
    },
    async setPolicy(externalId, policy) {
      await call('PUT', `/api/v1/end-users/${enc(externalId)}/policy`, { policy });
    },
    async deleteEndUser(externalId) {
      await call('DELETE', `/api/v1/end-users/${enc(externalId)}`);
    },
  };
}
