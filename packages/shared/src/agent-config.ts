import { z } from 'zod';

/**
 * Per-student settings that can change after the agent exists (brief time, timezone). The backend
 * writes them to the agent's private disk at /data/helm/config.json through the Maritime Files
 * API, and the agent re-reads the file on every message, so changes apply without a restart.
 *
 * Secrets (agent token, Gemini key, portal login) are NOT in this file. They are passed as
 * encrypted env vars when the agent is created (`initialEnvVars`), see docs/maritime-notes.md.
 * Every field is optional; missing ones fall back to env vars.
 */
export const AGENT_CONFIG_PATH = '/data/helm/config.json';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const AgentRuntimeConfig = z.object({
  v: z.literal(1).default(1),
  /** Overrides HELM_BACKEND_URL, so a corrected app URL reaches existing agents. */
  backendUrl: z.url().optional(),
  timezone: z.string().min(1).max(64).optional(),
  briefTime: z.string().regex(HHMM).optional(),
  heartbeatCron: z.string().optional(),
  demoMode: z.boolean().optional(),
  /** LOCAL DEVELOPMENT ONLY (HELM_LOCAL_AGENT_URL). Production passes these as encrypted env. */
  studentId: z.string().min(1).max(128).optional(),
  agentToken: z.string().min(20).max(200).optional(),
});
export type AgentRuntimeConfig = z.infer<typeof AgentRuntimeConfig>;
export type AgentRuntimeConfigInput = z.input<typeof AgentRuntimeConfig>;

/** Env var names the backend sets at agent creation. */
export const AGENT_ENV = {
  studentId: 'HELM_STUDENT_ID',
  backendUrl: 'HELM_BACKEND_URL',
  agentToken: 'HELM_AGENT_TOKEN',
  geminiKey: 'GEMINI_API_KEY',
  geminiModel: 'GEMINI_MODEL',
  portalUrl: 'PORTAL_URL',
  portalUsername: 'PORTAL_USERNAME',
  portalPassword: 'PORTAL_PASSWORD',
  timezone: 'TZ',
  briefTime: 'HELM_BRIEF_TIME',
  demoMode: 'DEMO_MODE',
} as const;
