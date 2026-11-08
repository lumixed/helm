import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import {
  CalendarError,
  connectCalendar,
  demoFeedToken,
  disconnectCalendar,
  requestCalendarSync,
} from '@/lib/calendar';
import { fail, json, readBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

const Body = z.object({
  url: z.string().trim().max(2000).optional(),
  demo: z.boolean().optional(),
});

/** Connect a calendar feed ({url}), the demo feed ({demo: true}), or ?action=sync to sync now. */
export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  const transport = agentTransport();
  if (!agent?.maritimeAgentId || !transport) return fail(409, 'Your agent is still being set up.');
  try {
    if (new URL(req.url).searchParams.get('action') === 'sync') {
      if (!user.calendarConnectedAt) return fail(409, 'Connect your calendar first.');
      return json(
        { requestId: await requestCalendarSync(db, user, agent, transport, 'manual') },
        202,
      );
    }
    const body = await readBody(req, Body);
    if (body instanceof Response) return body;
    let url = body.url;
    if (body.demo) {
      if (process.env.DEMO_MODE !== 'true') return fail(404, 'Not found');
      url = `${(process.env.APP_BASE_URL ?? '').replace(/\/+$/, '')}/mock-portal/feeds/${demoFeedToken(user.id)}`;
    }
    if (!url) return fail(400, 'Paste your calendar feed link.');
    await connectCalendar(db, user, agent, maritimeOrNull(), transport, url);
    return json({ connected: true }, 202);
  } catch (err) {
    if (err instanceof CalendarError) return fail(400, err.message);
    console.error('[calendar]', String(err).slice(0, 200));
    return fail(502, 'Could not reach your agent. Try again in a moment.');
  }
}

export async function DELETE(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  await disconnectCalendar(db, user, agent ?? null, maritimeOrNull());
  return json({ connected: false });
}
