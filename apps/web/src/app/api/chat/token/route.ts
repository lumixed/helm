import { CHAT_TTL_S, mintChatToken } from '@/lib/chat';
import { fail, json } from '@/lib/http';
import { localAgentDir } from '@/lib/provisioning';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

/**
 * A short-lived token (15 min, chat only) that opens only the signed-in person's agent, so the
 * browser can talk to it directly. Local development has no Maritime: use the relay.
 */
export async function POST(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const maritime = maritimeOrNull();
  if (localAgentDir() || !maritime) return json({ mode: 'relay' });
  try {
    const t = await mintChatToken(await (await import('@/db')).getDb(), user, maritime, CHAT_TTL_S);
    return json({
      mode: 'direct',
      token: t.token,
      agentId: t.agentId,
      expiresAt: t.expiresAt,
      apiUrl: (process.env.MARITIME_API_URL ?? 'https://api.maritime.sh').replace(/\/+$/, ''),
    });
  } catch (err) {
    console.warn('[chat] token failed', String(err).slice(0, 200));
    return json({ mode: 'relay' });
  }
}
