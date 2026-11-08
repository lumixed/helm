import { RoutineSentRequest } from '@helm/shared';
import { agentRequest } from '@/lib/agent-request';
import { json } from '@/lib/http';
import { sendToUser } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/** Agent → backend: a routine fired (Maritime cron). Send its text to the person's phone. */
export async function POST(req: Request): Promise<Response> {
  const r = await agentRequest(req, RoutineSentRequest);
  if (!r.ok) return r.error;
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, '');
  const delivered = await sendToUser(
    r.db,
    r.agent.userId,
    r.body.text,
    base?.startsWith('https://') ? [[{ text: 'Open Helm', url: `${base}/today` }]] : [],
  ).catch(() => false);
  return json({ delivered });
}
