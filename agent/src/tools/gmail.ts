import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Read-only Gmail from inside the agent's VM (PRD v3). The refresh token is an encrypted
 * Maritime env var on this agent only. Bodies are read here and never leave the VM; only
 * metadata, a hash and the structured result go to the backend.
 */
export interface GmailCreds {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export function gmailCredsFromEnv(env: NodeJS.ProcessEnv = process.env): GmailCreds | null {
  const { GMAIL_REFRESH_TOKEN: r, GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = env;
  return r && id && secret ? { refreshToken: r, clientId: id, clientSecret: secret } : null;
}

export interface GmailEmail {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
}

type Fetch = typeof fetch;
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function accessToken(c: GmailCreds, f: Fetch = fetch): Promise<string> {
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !j.access_token)
    throw new GmailError(j.error === 'invalid_grant' ? 'revoked' : 'auth');
  return j.access_token;
}

export class GmailError extends Error {
  constructor(readonly kind: 'revoked' | 'auth' | 'api') {
    super(`gmail ${kind}`);
  }
}

/** Recent inbox mail since `afterEpochS`, skipping promotions and social tabs. Newest first. */
export async function listRecent(token: string, afterEpochS: number, max = 10, f: Fetch = fetch) {
  const q = `in:inbox after:${afterEpochS} -category:promotions -category:social`;
  const res = await f(`${GMAIL}/messages?maxResults=${max}&q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new GmailError(res.status === 401 ? 'auth' : 'api');
  return (((await res.json()) as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
}

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
}

const b64 = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** Plain text of a message: text/plain if present, else text/html with tags removed. */
export function bodyText(p: Part): string {
  const find = (part: Part, type: string): string | null => {
    if (part.mimeType === type && part.body?.data) return b64(part.body.data);
    for (const c of part.parts ?? []) {
      const t = find(c, type);
      if (t) return t;
    }
    return null;
  };
  const plain = find(p, 'text/plain');
  if (plain) return plain;
  const html = find(p, 'text/html');
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export async function getEmail(token: string, id: string, f: Fetch = fetch): Promise<GmailEmail> {
  const res = await f(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new GmailError('api');
  const m = (await res.json()) as { id: string; internalDate?: string; payload: Part };
  const h = (name: string) =>
    m.payload.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? '';
  return {
    id: m.id,
    from: h('from').slice(0, 320) || 'unknown sender',
    subject: h('subject').slice(0, 1000),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    body: bodyText(m.payload).slice(0, 100_000),
  };
}

/** Which Gmail messages this agent already handled, on its persistent /data disk. */
export class GmailState {
  constructor(private file: string) {}
  async load(): Promise<{ lastSyncS: number; seen: string[] }> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as {
        lastSyncS: number;
        seen: string[];
      };
    } catch {
      return { lastSyncS: 0, seen: [] };
    }
  }
  async save(s: { lastSyncS: number; seen: string[] }) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(
      this.file,
      JSON.stringify({ lastSyncS: s.lastSyncS, seen: s.seen.slice(-500) }),
    );
  }
}

/** RFC 2822 message, base64url: what the Gmail API takes for a draft. */
export function rawMessage(d: { to?: string | null; subject: string; body: string }): string {
  const headers = [
    ...(d.to ? [`To: ${d.to.replace(/[\r\n]/g, '')}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(d.subject.replace(/[\r\n]/g, ' ')).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const msg = `${headers.join('\r\n')}\r\n\r\n${Buffer.from(d.body).toString('base64')}`;
  return Buffer.from(msg).toString('base64url');
}

/**
 * Save a draft in the person's Gmail (users.drafts.create). This is the ONLY write Helm makes to
 * Gmail; it never calls send. Needs the gmail.compose permission.
 */
export async function createDraft(
  token: string,
  d: { to?: string | null; subject: string; body: string },
  f: Fetch = fetch,
): Promise<{ id: string }> {
  const res = await f(`${GMAIL}/drafts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { raw: rawMessage(d) } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 403) throw new GmailError('auth');
  if (!res.ok) throw new GmailError('api');
  return { id: ((await res.json()) as { id: string }).id };
}
