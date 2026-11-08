import fs from 'node:fs/promises';
import path from 'node:path';
import { maritimeOrNull } from './student';
import { MaritimeError, type MaritimeClient } from './maritime';

/**
 * Maritime accepts 30 webhook calls a minute per caller per agent. A burst (several messages read
 * from a desktop at once, a calendar sync, a hand-in) can hit that: wait as long as Maritime asks
 * and try again, within a bounded time. Nothing is stored while waiting (messages can carry email
 * or message text, which the backend never keeps).
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  opts: { budgetMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof MaritimeError) || err.status !== 429) throw err;
      const wait = Math.min((err.retryAfterS ?? 2 ** attempt) * 1000 + Math.random() * 250, 10_000);
      if (Date.now() + wait > deadline) throw err;
      await sleep(wait);
    }
  }
}

/**
 * How the backend reaches a student's agent. In production that is Maritime (Files API +
 * webhook). For local development, set HELM_LOCAL_AGENT_URL and HELM_LOCAL_AGENT_DATA_DIR to talk
 * to an agent running on this machine (`pnpm dev:agent`) with the same message protocol.
 */
export interface AgentTransport {
  kind: 'maritime' | 'local';
  /** Put a file on the agent's disk. `agentPath` is under /data. */
  putFile(maritimeAgentId: string, agentPath: string, bytes: Uint8Array): Promise<void>;
  /** Deliver a protocol message. Returns once accepted (delivery may be async). */
  send(maritimeAgentId: string, message: string): Promise<void>;
}

const tokens = new Map<string, string>();

export function maritimeTransport(m: MaritimeClient): AgentTransport {
  return {
    kind: 'maritime',
    async putFile(agentId, agentPath, bytes) {
      await m.uploadFile(agentId, {
        bytes,
        filename: path.posix.basename(agentPath),
        destDir: path.posix.dirname(agentPath),
      });
    },
    async send(agentId, message) {
      let token = tokens.get(agentId);
      if (!token) {
        token = await m.webhookToken(agentId);
        tokens.set(agentId, token);
      }
      await withRateLimitRetry(() => m.invokeWebhook(agentId, token!, message));
    },
  };
}

export function localTransport(agentUrl: string, dataDir: string): AgentTransport {
  return {
    kind: 'local',
    async putFile(_id, agentPath, bytes) {
      const target = path.join(dataDir, agentPath.replace(/^\/data\//, ''));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    },
    async send(_id, message) {
      // Like Maritime's webhook: accepted now, handled in the background.
      void fetch(`${agentUrl.replace(/\/+$/, '')}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, source: 'webhook' }),
      }).catch((err: unknown) => console.error('[local-agent] send failed', err));
    },
  };
}

export function agentTransport(): AgentTransport | null {
  const url = process.env.HELM_LOCAL_AGENT_URL;
  const dir = process.env.HELM_LOCAL_AGENT_DATA_DIR;
  if (url && dir && !process.env.VERCEL) return localTransport(url, dir);
  const m = maritimeOrNull();
  return m ? maritimeTransport(m) : null;
}
