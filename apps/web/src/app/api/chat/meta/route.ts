import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Which model wrote the latest chat answer (from the agent's own timeline event). */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const [e] = await (
    await getDb()
  )
    .select({ at: schema.agentEvents.occurredAt, payload: schema.agentEvents.payloadJson })
    .from(schema.agentEvents)
    .where(and(eq(schema.agentEvents.userId, user.id), eq(schema.agentEvents.type, 'chat.replied')))
    .orderBy(desc(schema.agentEvents.occurredAt))
    .limit(1);
  if (!e) return json({ latest: null });
  const model = typeof e.payload.model === 'string' ? e.payload.model : null;
  return json({
    latest: {
      at: e.at.toISOString(),
      model,
      // Maritime LLM serves OpenAI models; Gemini is the fallback.
      via: model ? (model.startsWith('gemini') ? 'Gemini' : 'Maritime LLM') : null,
      ms: typeof e.payload.ms === 'number' ? e.payload.ms : null,
    },
  });
}
