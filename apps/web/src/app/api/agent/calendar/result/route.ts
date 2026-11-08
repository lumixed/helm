import { CalendarResultRequest } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentRequest } from '@/lib/agent-request';
import { saveCalendarResult } from '@/lib/calendar';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Agent → backend: deadlines from the person's calendar feed (no other calendar content). */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, CalendarResultRequest);
  if (!r.ok) return r.error;
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  if (!user) return fail(404, 'student not found');
  return json(await saveCalendarResult(r.db, user, r.body.items));
}
