import { z } from 'zod';
import { getDb } from '@/db';
import { confirmAssignments } from '@/lib/assignments';
import { fail, json, readBody } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const Confirm = z.object({
  keepIds: z.array(z.uuid()).max(500),
  dropIds: z.array(z.uuid()).max(500).default([]),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, Confirm);
  if (body instanceof Response) return body;
  const db = await getDb();
  return json({ confirmed: await confirmAssignments(db, user.id, body.keepIds, body.dropIds) });
}
