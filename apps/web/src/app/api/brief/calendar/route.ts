import { getDb } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { addBlocksResult, requestAddBlocks } from '@/lib/calendar-blocks';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Add today's work blocks to Google Calendar (the agent does the writing). */
export async function POST(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const transport = agentTransport();
  if (!transport) return fail(503, 'Agents are not configured on this server.');
  try {
    const r = await requestAddBlocks(await getDb(), user, transport);
    return 'error' in r ? fail(r.status, r.error) : json(r, 202);
  } catch (err) {
    console.error('[calendar] could not reach agent', err);
    return fail(502, 'Could not reach your agent. Try again in a moment.');
  }
}

/** Has the agent answered? `?requestId=` from the POST. */
export async function GET(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const requestId = new URL(req.url).searchParams.get('requestId');
  if (!requestId?.startsWith('calendar:blocks:')) return fail(400, 'requestId is required');
  return json(await addBlocksResult(await getDb(), user, requestId));
}
