import { getDb } from '@/db';
import { fail, json } from '@/lib/http';
import { portalFind, receiptJson } from '@/lib/portal';
import { portalUser } from '@/lib/portal-auth';

export const dynamic = 'force-dynamic';

/** DEMO PORTAL: look up a submission by idempotency key (the agent checks before uploading). */
export async function GET(req: Request): Promise<Response> {
  const who = await portalUser(req);
  if (!who) return fail(401, 'Sign in to the demo portal.');
  const key = new URL(req.url).searchParams.get('idempotencyKey') ?? '';
  if (!key) return fail(400, 'idempotencyKey is required');
  const row = await portalFind(await getDb(), who.userId, key.slice(0, 200));
  return row ? json({ receipt: receiptJson(row) }) : fail(404, 'No submission with that key.');
}
