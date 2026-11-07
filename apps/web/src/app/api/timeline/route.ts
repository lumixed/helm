import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { formatTime } from '@/lib/format';
import { fail, json } from '@/lib/http';
import { triggerTime } from '@/lib/maritime-webhooks';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Everything the student's agent did and why (PRD M8), newest first: our agent's own events
 * merged with Maritime lifecycle webhooks (woken, sleeping, ...). Wake latency is measured from
 * the trigger (our send time, or the cron minute) to the agent's first log line.
 */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [mine, lifecycle] = await Promise.all([
    db
      .select({
        id: schema.agentEvents.id,
        type: schema.agentEvents.type,
        reason: schema.agentEvents.reason,
        requestId: schema.agentEvents.requestId,
        occurredAt: schema.agentEvents.occurredAt,
        payload: schema.agentEvents.payloadJson,
      })
      .from(schema.agentEvents)
      .where(eq(schema.agentEvents.userId, user.id))
      .orderBy(desc(schema.agentEvents.occurredAt))
      .limit(200),
    db
      .select()
      .from(schema.maritimeEvents)
      .where(eq(schema.maritimeEvents.userId, user.id))
      .orderBy(desc(schema.maritimeEvents.occurredAt))
      .limit(300),
  ]);
  const sentAt = new Map<string, Date>();
  for (const m of lifecycle)
    if (m.kind === 'helm.sent' && typeof m.payloadJson.requestId === 'string')
      sentAt.set(m.payloadJson.requestId, m.occurredAt);

  const events = [
    ...mine.map((e) => {
      let latencyMs: number | null = null;
      if (e.type === 'agent.woke' && e.requestId) {
        const t0 = triggerTime(e.requestId, sentAt);
        if (t0) latencyMs = Math.max(0, e.occurredAt.getTime() - t0.getTime());
      }
      return {
        id: e.id,
        type: e.type,
        reason: e.reason,
        occurredAt: e.occurredAt,
        payload: { ...e.payload, ...(latencyMs !== null ? { latencyMs } : {}) },
        origin: 'agent' as const,
      };
    }),
    ...lifecycle
      .filter((m) => m.kind !== 'helm.sent')
      .map((m) => ({
        id: m.id,
        type: `maritime:${m.kind}`,
        reason: String(m.payloadJson.summary ?? m.kind),
        occurredAt: m.occurredAt,
        payload: m.payloadJson,
        origin: 'maritime' as const,
      })),
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 250)
    .map((e) => ({ ...e, atLabel: formatTime(e.occurredAt, user.timezone) }));
  return json({ events, timezone: user.timezone });
}
