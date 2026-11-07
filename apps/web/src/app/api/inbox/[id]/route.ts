import { getDb } from '@/db';
import { fail, json } from '@/lib/http';
import { inboxStatus } from '@/lib/inbox';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Where one email is (sent, processed, decision). Never returns the email text. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const s = await inboxStatus(await getDb(), user.id, (await ctx.params).id);
  return s ? json(s) : fail(404, 'Not found');
}
