import { z } from 'zod';
import { getDb } from '@/db';
import { fail, json, readBody } from '@/lib/http';
import { applyChange, dismissChange } from '@/lib/inbox';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const Body = z.object({
  action: z.enum(['apply', 'dismiss']),
  /** When Helm couldn't tell which assignment an email meant, the student picks it. */
  assignmentId: z.string().max(100).optional(),
});

/** The student confirms or dismisses a change Helm found in an email. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  const db = await getDb();
  if (body.action === 'dismiss')
    return (await dismissChange(db, user.id, id))
      ? json({ status: 'dismissed' })
      : fail(409, 'This change was already handled.');
  const r = await applyChange(db, user.id, id, body.assignmentId ?? null);
  return r.ok ? json({ status: 'applied', assignmentId: r.assignmentId }) : fail(409, r.error);
}
