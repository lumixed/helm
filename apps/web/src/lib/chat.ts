import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { User } from '@/db/schema';
import type { MaritimeClient } from './maritime';
import { externalIdFor } from './provisioning';

/**
 * Chat with your own agent (PRD S2, v2 WP-2). The browser gets a short-lived eu_ token that opens
 * only this person's agent, for chat only, and talks to it directly. Where Maritime doesn't allow
 * the site's address for browsers (CORS), Helm relays the message using a token minted the same
 * way: the backend never uses its master key for chat and never stores the text.
 */
export const CHAT_TTL_S = 900;
const RELAY_TTL_S = 60;

export async function mintChatToken(
  db: Db,
  user: User,
  maritime: MaritimeClient,
  ttlSeconds = CHAT_TTL_S,
) {
  const t = await maritime.mintToken(externalIdFor(user.id), { scopes: ['chat'], ttlSeconds });
  // Evidence for the scorecard: scope and lifetime only, never the token.
  await db.insert(schema.maritimeEvents).values({
    userId: user.id,
    maritimeAgentId: t.agentId,
    kind: 'helm.token_minted',
    payloadJson: {
      scopes: ['chat'],
      ttlSeconds,
      summary: `Chat token, ${Math.round(ttlSeconds / 60)} min`,
    },
    occurredAt: new Date(),
  });
  return t;
}

export interface RelayDeps {
  maritime: MaritimeClient | null;
  /** Local development: the agent on this machine. */
  localAgentUrl?: string | null;
  apiUrl?: string;
  fetch?: typeof fetch;
}

/** Send one message to the person's agent and return its answer. */
export async function relayChat(
  db: Db,
  user: User,
  message: string,
  conversationId: string,
  deps: RelayDeps,
): Promise<string> {
  const f = deps.fetch ?? fetch;
  if (deps.localAgentUrl) {
    const r = await f(`${deps.localAgentUrl.replace(/\/+$/, '')}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, source: 'front_door', conversation_id: conversationId }),
      signal: AbortSignal.timeout(45_000),
    });
    return ((await r.json()) as { response?: string }).response ?? 'No answer.';
  }
  if (!deps.maritime) throw new Error('Agents are not configured on this server.');
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  if (!agent?.maritimeAgentId) throw new Error('Your agent is still being set up.');
  const t = await mintChatToken(db, user, deps.maritime, RELAY_TTL_S);
  const base = (deps.apiUrl ?? 'https://api.maritime.sh').replace(/\/+$/, '');
  const r = await f(`${base}/api/agents/${encodeURIComponent(t.agentId)}/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${t.token}`,
      'content-type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ message, conversation_id: conversationId }),
    signal: AbortSignal.timeout(45_000),
  });
  const j = (await r.json().catch(() => ({}))) as { response?: string | null; error?: string };
  if (!r.ok) throw new Error(`agent chat ${r.status}`);
  return j.response ?? 'Your agent did not answer. Try again in a moment.';
}
