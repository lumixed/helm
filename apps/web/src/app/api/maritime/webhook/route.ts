import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { describeLifecycle, verifySignature, webhookSecret } from '@/lib/maritime-webhooks';

export const dynamic = 'force-dynamic';

const USER_RE = /^user_([0-9a-f-]{36})$/;

/** Maritime lifecycle webhooks → maritime_events (shown on the timeline). Signed, deduped. */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const db = await getDb();
  if (!verifySignature(raw, req.headers.get('x-maritime-signature'), await webhookSecret(db))) {
    return new Response('bad signature', { status: 401 });
  }
  let evt: {
    event?: string;
    agent_id?: string;
    external_id?: string | null;
    end_user?: { external_id?: string } | null;
    timestamp?: string;
    data?: Record<string, unknown>;
  };
  try {
    evt = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const kind = evt.event ?? req.headers.get('x-maritime-event') ?? 'unknown';
  const ext = evt.end_user?.external_id ?? evt.external_id ?? null;
  const uid = ext ? USER_RE.exec(ext)?.[1] : undefined;
  let userId: string | null = null;
  if (uid) {
    const [u] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, uid));
    userId = u?.id ?? null;
  }
  const occurredAt =
    evt.timestamp && !Number.isNaN(Date.parse(evt.timestamp))
      ? new Date(evt.timestamp)
      : new Date();
  await db
    .insert(schema.maritimeEvents)
    .values({
      userId,
      maritimeAgentId: evt.agent_id ?? null,
      kind,
      deliveryId: req.headers.get('x-maritime-delivery'),
      payloadJson: { ...(evt.data ?? {}), summary: describeLifecycle(kind, evt.data ?? {}) },
      occurredAt,
    })
    .onConflictDoNothing();
  return new Response('ok');
}
