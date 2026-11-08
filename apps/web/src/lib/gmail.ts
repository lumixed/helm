import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { encodeAgentMessage, type AgentInboxMessageRequest } from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { AgentRow, User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import type { MaritimeClient } from './maritime';
import { recordSent } from './maritime-webhooks';

/**
 * Real Gmail, read-only (PRD v3). The backend runs the OAuth dance once, then puts the refresh
 * token ONLY into the user's own agent as an encrypted Maritime env var and forgets it. The agent
 * reads mail itself; email bodies never leave its VM.
 */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
/** Lets Helm save drafts the person asks for. Google's scope also allows sending; Helm's code never sends. */
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const GOOGLE_HOSTS = ['oauth2.googleapis.com', 'gmail.googleapis.com'];

export const GMAIL_ENV = {
  refreshToken: 'GMAIL_REFRESH_TOKEN',
  clientId: 'GOOGLE_CLIENT_ID',
  clientSecret: 'GOOGLE_CLIENT_SECRET',
} as const;

export function gmailConfig(env: NodeJS.ProcessEnv = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const base = env.APP_BASE_URL?.replace(/\/+$/, '');
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/api/gmail/callback` };
}

function key(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET must be set (16+ chars)');
  return createHmac('sha256', s).update('helm-gmail:state').digest('base64url');
}

/** OAuth state: user id + expiry, signed, so the callback can't be replayed for someone else. */
export function signState(userId: string, now = Date.now()): string {
  const payload = `${userId}.${Math.floor(now / 1000) + 600}`;
  return `${payload}.${createHmac('sha256', key()).update(payload).digest('base64url')}`;
}

export function verifyState(state: string, now = Date.now()): string | null {
  const i = state.lastIndexOf('.');
  if (i < 0) return null;
  const payload = state.slice(0, i);
  const want = Buffer.from(createHmac('sha256', key()).update(payload).digest('base64url'));
  const got = Buffer.from(state.slice(i + 1));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [userId, exp] = payload.split('.');
  return userId && Number(exp) * 1000 > now ? userId : null;
}

export function authUrl(userId: string, cfg = gmailConfig()!): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: `${GMAIL_SCOPE} ${GMAIL_COMPOSE_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signState(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type Fetch = typeof fetch;

/** Exchange the code, read the address, hand the token to the agent, and start a first sync. */
export async function connectGmail(
  db: Db,
  user: User,
  agent: AgentRow,
  maritime: MaritimeClient,
  transport: AgentTransport,
  code: string,
  opts: { fetch?: Fetch } = {},
): Promise<{ email: string }> {
  const cfg = gmailConfig();
  if (!cfg) throw new Error('Gmail is not set up on this server');
  if (!agent.maritimeAgentId || agent.maritimeAgentId === 'local')
    throw new Error('Gmail needs your agent on Maritime');
  const f = opts.fetch ?? fetch;
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const tok = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    error_description?: string;
  };
  if (!res.ok || !tok.access_token)
    throw new Error(`Google refused: ${tok.error_description ?? `HTTP ${res.status}`}`);
  if (!tok.refresh_token)
    throw new Error(
      'Google sent no refresh token. Remove Helm in your Google account and connect again.',
    );
  if (!tok.scope?.includes(GMAIL_SCOPE)) throw new Error('Gmail read access was not granted.');
  const prof = await f('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${tok.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const email =
    ((await prof.json().catch(() => ({}))) as { emailAddress?: string }).emailAddress ??
    'your Gmail';

  // The only copy of the refresh token goes into this user's agent, encrypted.
  await maritime.setEnv(agent.maritimeAgentId, GMAIL_ENV.refreshToken, tok.refresh_token, true);
  await maritime.setEnv(agent.maritimeAgentId, GMAIL_ENV.clientId, cfg.clientId, false);
  await maritime.setEnv(agent.maritimeAgentId, GMAIL_ENV.clientSecret, cfg.clientSecret, true);
  await maritime.reloadEnv(agent.maritimeAgentId);
  await db
    .update(schema.users)
    .set({ gmailAddress: email, gmailConnectedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await requestSync(db, user.id, agent.maritimeAgentId, transport, 'connected').catch(
    (err: unknown) => console.warn('[gmail] first sync not started', String(err)),
  );
  return { email };
}

export async function requestSync(
  db: Db,
  userId: string,
  maritimeAgentId: string,
  transport: AgentTransport,
  reason: 'connected' | 'manual',
) {
  const requestId = `gmail:${reason}:${Date.now()}`;
  await transport.send(
    maritimeAgentId,
    encodeAgentMessage({
      v: 1,
      type: 'gmail.sync',
      requestId,
      studentId: userId,
      payload: { reason },
    }),
  );
  await recordSent(db, userId, maritimeAgentId, requestId, 'gmail.sync');
  return requestId;
}

/** Remove the token from the agent. (Google access can also be removed in the Google account.) */
export async function disconnectGmail(
  db: Db,
  user: User,
  agent: AgentRow | null,
  maritime: MaritimeClient | null,
) {
  if (agent?.maritimeAgentId && agent.maritimeAgentId !== 'local' && maritime) {
    await maritime.deleteEnv(agent.maritimeAgentId, GMAIL_ENV.refreshToken).catch(() => {});
    await maritime.reloadEnv(agent.maritimeAgentId).catch(() => {});
  }
  await db
    .update(schema.users)
    .set({ gmailAddress: null, gmailConnectedAt: null })
    .where(eq(schema.users.id, user.id));
}

/**
 * Agent → backend: register an email the agent read itself. Same email (Gmail id) → same row.
 * Stores sender, subject, time and a hash; never the body.
 */
export async function registerAgentEmail(db: Db, userId: string, r: AgentInboxMessageRequest) {
  const bodyHash = createHash('sha256').update(`${r.source}:${r.externalId}`).digest('hex');
  const [created] = await db
    .insert(schema.inboxMessages)
    .values({
      userId,
      source: r.source,
      fromAddr: r.from,
      subject: r.subject,
      receivedAt: new Date(r.receivedAt),
      bodyHash,
      status: 'sent',
      requestId: `gmail-msg:${r.externalId}`,
    })
    .onConflictDoNothing()
    .returning({ id: schema.inboxMessages.id, processedAt: schema.inboxMessages.processedAt });
  if (created) return { inboxMessageId: created.id, alreadyProcessed: false };
  const [row] = await db
    .select({ id: schema.inboxMessages.id, processedAt: schema.inboxMessages.processedAt })
    .from(schema.inboxMessages)
    .where(
      and(eq(schema.inboxMessages.userId, userId), eq(schema.inboxMessages.bodyHash, bodyHash)),
    );
  return { inboxMessageId: row!.id, alreadyProcessed: Boolean(row!.processedAt) };
}
