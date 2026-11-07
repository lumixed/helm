import { getDb } from '@/db';
import { todaysBrief } from '@/lib/briefs';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  return json({ brief: await todaysBrief(await getDb(), user) });
}
