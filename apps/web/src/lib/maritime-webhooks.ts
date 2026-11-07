import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { MaritimeClient } from './maritime';

const SECRET_KEY = 'maritime_webhook';

/** Verify `X-Maritime-Signature: sha256=<hex>` (HMAC-SHA256 of the raw body). Fails closed. */
export function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string | null | undefined,
): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function webhookSecret(db: Db): Promise<string | null> {
  if (process.env.MARITIME_WEBHOOK_SECRET) return process.env.MARITIME_WEBHOOK_SECRET;
  const [row] = await db
    .select()
    .from(schema.appSecrets)
    .where(eq(schema.appSecrets.key, SECRET_KEY));
  return row?.value ?? null;
}

let ensured = false;

/**
 * Make sure Maritime sends lifecycle events to this app. Idempotent: keeps one subscription for
 * our URL and stores its signing secret (returned once) in the database, never in logs.
 */
export async function ensureWebhookSubscription(
  db: Db,
  maritime: MaritimeClient,
  appBaseUrl: string,
): Promise<'exists' | 'created' | 'skipped'> {
  if (ensured || process.env.MARITIME_WEBHOOK_SECRET) return 'skipped';
  if (!appBaseUrl.startsWith('https://')) return 'skipped'; // Maritime only delivers to public https URLs
  const url = `${appBaseUrl.replace(/\/+$/, '')}/api/maritime/webhook`;
  const [stored] = await db
    .select()
    .from(schema.appSecrets)
    .where(eq(schema.appSecrets.key, SECRET_KEY));
  const subs = await maritime.listWebhooks();
  const mine = subs.filter((s) => s.url === url);
  if (stored && mine.some((s) => s.id === stored.ref && s.isActive !== false)) {
    ensured = true;
    return 'exists';
  }
  // Lost secret or disabled endpoint: replace the subscription.
  for (const s of mine) await maritime.deleteWebhook(s.id).catch(() => undefined);
  const created = await maritime.createWebhook(url); // all events
  await db
    .insert(schema.appSecrets)
    .values({ key: SECRET_KEY, value: created.secret, ref: created.id })
    .onConflictDoUpdate({
      target: schema.appSecrets.key,
      set: { value: created.secret, ref: created.id },
    });
  ensured = true;
  return 'created';
}

/** Plain-language timeline line for a lifecycle event. */
export function describeLifecycle(kind: string, data: Record<string, unknown>): string {
  switch (kind) {
    case 'agent.woken':
      return 'Maritime woke your agent';
    case 'agent.sleeping':
      return 'Your agent went to sleep (idle)';
    case 'agent.deployed':
      return 'Your agent finished deploying';
    case 'agent.error':
      return `Your agent hit an error${typeof data.failure_kind === 'string' ? ` (${data.failure_kind})` : ''}`;
    case 'agent.restarted':
      return 'Your agent restarted';
    case 'agent.stopped':
      return 'Your agent was stopped';
    case 'agent.llm_limit_reached':
      return 'Paused: your monthly AI budget is used up';
    case 'end_user.created':
      return 'Your private agent account was created on Maritime';
    case 'end_user.deleted':
      return 'Your Maritime account and agent were deleted';
    default:
      return kind;
  }
}

/** Our own marker: when the app handed a message to the agent (for wake latency). */
export async function recordSent(
  db: Db,
  userId: string,
  maritimeAgentId: string,
  requestId: string,
  type: string,
) {
  await db
    .insert(schema.maritimeEvents)
    .values({
      userId,
      maritimeAgentId,
      kind: 'helm.sent',
      deliveryId: `sent:${requestId}`,
      payloadJson: { requestId, type },
      occurredAt: new Date(),
    })
    .onConflictDoNothing();
}

/**
 * When did the trigger for this request happen? For our own messages, the "sent" marker; for
 * platform cron, the scheduled minute encoded in the request id (cron:brief@2026-11-07T22:45).
 */
export function triggerTime(requestId: string, sentAt: Map<string, Date>): Date | null {
  const m = /@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/.exec(requestId);
  if (m) return new Date(`${m[1]}:00Z`);
  return sentAt.get(requestId) ?? null;
}
