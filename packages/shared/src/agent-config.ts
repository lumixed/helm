import { z } from 'zod';

/**
 * Per-student settings the backend writes to the agent's private disk at
 * /data/helm/config.json (Maritime Files API). The agent re-reads it on every message, so
 * changes apply without a restart. Env vars with the same meaning are the fallback.
 *
 * Why a file and not env vars: setting agent env needs an API key with the `secrets` scope,
 * and env passed at create time is ignored for end-user agents (verified 2026-11-07).
 */
export const AGENT_CONFIG_PATH = '/data/helm/config.json';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const AgentRuntimeConfig = z.object({
  v: z.literal(1).default(1),
  studentId: z.string().min(1).max(128),
  backendUrl: z.url(),
  agentToken: z.string().min(20).max(200),
  timezone: z.string().min(1).max(64).default('America/Vancouver'),
  briefTime: z.string().regex(HHMM).default('07:30'),
  heartbeatCron: z.string().default('*/15 * * * *'),
  demoMode: z.boolean().default(false),
});
export type AgentRuntimeConfig = z.infer<typeof AgentRuntimeConfig>;
export type AgentRuntimeConfigInput = z.input<typeof AgentRuntimeConfig>;
