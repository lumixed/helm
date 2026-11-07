import { PortalReceipt, type AgentSubmissionJob } from '@helm/shared';

/**
 * How a finished file reaches the portal (PRD v2 section 4). `http` posts the portal's form;
 * a `desktop` driver (real browser on a Maritime computer, WP-7) can implement the same
 * interface. Consent covers the submission, not the driver, and both use the same
 * idempotency key, so switching drivers can never submit twice.
 */
export interface SubmissionDriver {
  name: 'http' | 'desktop';
  submit(job: AgentSubmissionJob, file: { bytes: Uint8Array; name: string }): Promise<DriverResult>;
}

export type DriverResult =
  | { ok: true; receipt: PortalReceipt; duplicate: boolean }
  | { ok: false; error: string; retryable: boolean };

export interface PortalCreds {
  url: string;
  username: string;
  password: string;
}

export function portalCredsFromEnv(env: NodeJS.ProcessEnv = process.env): PortalCreds | null {
  if (!env.PORTAL_USERNAME || !env.PORTAL_PASSWORD) return null;
  return {
    url: env.PORTAL_URL ?? '',
    username: env.PORTAL_USERNAME,
    password: env.PORTAL_PASSWORD,
  };
}

export function httpDriver(
  creds: PortalCreds,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): SubmissionDriver {
  const f = opts.fetch ?? fetch;
  const timeout = () => AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  return {
    name: 'http',
    async submit(job, file) {
      const base = (creds.url || job.portalUrl).replace(/\/+$/, '');
      const net = (err: unknown): DriverResult => ({
        ok: false,
        error: `Couldn't reach the portal (${errText(err)}).`,
        retryable: true,
      });

      // 1. Log in with this student's own portal account (encrypted env on this VM only).
      let token: string;
      try {
        const res = await f(`${base}/api/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: creds.username, password: creds.password }),
          signal: timeout(),
        });
        if (res.status === 401)
          return { ok: false, error: 'The portal rejected the login.', retryable: false };
        if (!res.ok)
          return { ok: false, error: `Portal login failed (HTTP ${res.status}).`, retryable: true };
        token = ((await res.json()) as { token: string }).token;
      } catch (err) {
        return net(err);
      }
      const auth = { authorization: `Bearer ${token}` };

      // 2. Already there from an earlier attempt? Then that's the receipt (never upload twice).
      try {
        const res = await f(
          `${base}/api/submissions?idempotencyKey=${encodeURIComponent(job.idempotencyKey)}`,
          { headers: auth, signal: timeout() },
        );
        if (res.ok) {
          const r = PortalReceipt.safeParse(((await res.json()) as { receipt: unknown }).receipt);
          if (r.success) return { ok: true, receipt: r.data, duplicate: true };
        }
      } catch {
        /* lookup is best effort; the portal also dedupes on the key */
      }

      // 3. Upload.
      const form = new FormData();
      form.append('assignmentId', job.assignment.id);
      form.append('idempotencyKey', job.idempotencyKey);
      form.append('file', new Blob([file.bytes]), file.name);
      let res: Response;
      try {
        res = await f(`${base}/api/submit`, {
          method: 'POST',
          headers: auth,
          body: form,
          signal: timeout(),
        });
      } catch (err) {
        return net(err);
      }
      const body = (await res.json().catch(() => ({}))) as {
        receipt?: unknown;
        error?: string;
        duplicate?: boolean;
      };
      if (res.ok) {
        const r = PortalReceipt.safeParse(body.receipt);
        return r.success
          ? { ok: true, receipt: r.data, duplicate: Boolean(body.duplicate) }
          : { ok: false, error: 'The portal answered without a confirmation.', retryable: true };
      }
      const msg = body.error ?? `HTTP ${res.status}`;
      if (res.status === 409 || res.status === 422 || res.status === 413 || res.status === 404)
        return { ok: false, error: `The portal refused it: ${msg}`, retryable: false };
      return { ok: false, error: `The portal failed: ${msg}`, retryable: true };
    },
  };
}

function errText(err: unknown): string {
  const e = err as { name?: string; cause?: { code?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timed out';
  return (e?.cause?.code ?? String(err)).slice(0, 80);
}
