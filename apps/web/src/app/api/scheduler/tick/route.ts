import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { bearer } from '@/lib/agent-auth';
import { fail, json } from '@/lib/http';
import { tick, tickDepsFor } from '@/lib/submissions';

export const dynamic = 'force-dynamic';

/**
 * Advance the scheduler for every student. For an external pinger or Vercel Cron with
 * `Authorization: Bearer $CRON_SECRET`. Safe to call any number of times.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const given = bearer(req) ?? '';
  if (
    !secret ||
    given.length !== secret.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  )
    return fail(401, 'unauthorized');
  const db = await getDb();
  return json(await tick(db, tickDepsFor(db, agentTransport())));
}
export const GET = handle;
export const POST = handle;
