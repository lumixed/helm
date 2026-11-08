import { WeeklyReviewRequest } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { agentRequest } from '@/lib/agent-request';
import { fail, json } from '@/lib/http';
import { sendToUser } from '@/lib/telegram';
import { saveWeeklyReview, weeklyReviewMessage } from '@/lib/week';

export const dynamic = 'force-dynamic';

/** Agent → backend: the written weekly review. Helm recomputes the facts; the agent only words it. */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, WeeklyReviewRequest);
  if (!r.ok) return r.error;
  const [user] = await r.db.select().from(schema.users).where(eq(schema.users.id, r.agent.userId));
  if (!user) return fail(404, 'No such person');
  const row = await saveWeeklyReview(r.db, user, r.body);
  const link = process.env.APP_BASE_URL?.replace(/\/+$/, '');
  await sendToUser(
    r.db,
    user.id,
    weeklyReviewMessage(row),
    link ? [[{ text: 'Open my week', url: `${link}/week` }]] : [],
  ).catch(() => false);
  return json({ stored: true, id: row.id });
}
