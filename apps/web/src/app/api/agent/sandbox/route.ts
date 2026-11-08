import { SandboxLeaseRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { leaseSandbox, sandboxesFromEnv } from '@/lib/sandboxes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Agent → backend: "I need a throwaway sandbox to open an untrusted file." The backend creates it
 * with its own key and returns only that sandbox's address and per-sandbox secret.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, SandboxLeaseRequest);
  if (!r.ok) return r.error;
  const client = sandboxesFromEnv();
  if (!client) return fail(503, 'Sandboxes are not set up on this server.');
  try {
    return json(await leaseSandbox(r.db, r.agent.userId, client, r.body.purpose, r.body.label));
  } catch (err) {
    console.warn('[sandbox] create failed', String(err).slice(0, 200));
    return fail(502, 'No sandbox available right now.');
  }
}
