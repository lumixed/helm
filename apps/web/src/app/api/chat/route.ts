import { z } from 'zod';
import { getDb } from '@/db';
import { relayChat } from '@/lib/chat';
import { fail, json, readBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .default('default'),
});

/** Relay for when the browser can't reach Maritime directly. The text is not stored. */
export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  try {
    const response = await relayChat(await getDb(), user, body.message, body.conversationId, {
      maritime: maritimeOrNull(),
      localAgentUrl: process.env.VERCEL ? null : process.env.HELM_LOCAL_AGENT_URL,
      apiUrl: process.env.MARITIME_API_URL,
    });
    return json({ response, via: 'relay' });
  } catch (err) {
    console.warn('[chat] relay failed', String(err).slice(0, 200));
    return fail(502, 'Could not reach your agent. Try again in a moment.');
  }
}
