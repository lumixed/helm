import { runtime } from './config';

/** Authenticated POST to the student's backend, with a few quick retries. */
export async function postBackend(
  pathname: string,
  body: unknown,
  opts: { fetch?: typeof fetch; attempts?: number } = {},
): Promise<Response> {
  const rt = runtime();
  if (!rt.backendUrl || !rt.agentToken) throw new Error('Backend is not configured on this agent');
  let last: unknown;
  for (let i = 0; i < (opts.attempts ?? 3); i++) {
    try {
      const res = await (opts.fetch ?? fetch)(`${rt.backendUrl}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${rt.agentToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Authenticated GET to the student's backend. */
export async function getBackend(
  pathname: string,
  opts: { fetch?: typeof fetch } = {},
): Promise<Response> {
  const rt = runtime();
  if (!rt.backendUrl || !rt.agentToken) throw new Error('Backend is not configured on this agent');
  return (opts.fetch ?? fetch)(`${rt.backendUrl}${pathname}`, {
    headers: { authorization: `Bearer ${rt.agentToken}` },
    signal: AbortSignal.timeout(15_000),
  });
}
