import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';

export const dynamic = 'force-dynamic';

/** Demo/dev only: read back what agents reported. Disabled unless DEMO_MODE=true. */
export async function GET(req: Request) {
  if (process.env.DEMO_MODE !== 'true') return new Response('Not found', { status: 404 });
  const studentId = new URL(req.url).searchParams.get('studentId');
  const db = await getDb();
  const q = db
    .select()
    .from(schema.agentEvents)
    .orderBy(desc(schema.agentEvents.occurredAt))
    .limit(200);
  const events = studentId ? await q.where(eq(schema.agentEvents.userId, studentId)) : await q;
  return Response.json({ events });
}
