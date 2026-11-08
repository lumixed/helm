import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { json } from '@/lib/http';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { schema } from '@/db';
import { relayChat } from '@/lib/chat';
import { maritimeOrNull } from '@/lib/student';
import { holdSubmission, submitNow, tick, tickDepsFor } from '@/lib/submissions';
import { handleUpdate, telegramToken, webhookSecret } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Telegram → Helm: chat linking and the Hold / Submit now buttons. Checks Telegram's secret. */
export async function POST(req: Request): Promise<Response> {
  if (!telegramToken()) return new Response('Not found', { status: 404 });
  const given = Buffer.from(req.headers.get('x-telegram-bot-api-secret-token') ?? '');
  const want = Buffer.from(webhookSecret());
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return new Response('forbidden', { status: 403 });
  const update = await req.json().catch(() => null);
  if (!update) return json({ ok: true });
  const db = await getDb();
  // The agent can take a while to answer a chat message; reply to Telegram right away and do
  // the work after (Telegram re-sends updates that aren't acknowledged quickly).
  after(() => processUpdate(db, update));
  // Always 200, or Telegram retries the same update.
  return json({ ok: true });
}

async function processUpdate(
  db: Awaited<ReturnType<typeof getDb>>,
  update: Parameters<typeof handleUpdate>[1],
) {
  try {
    await handleUpdate(db, update, {
      chat: async (userId, text) => {
        const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
        if (!user) return 'Account not found.';
        return relayChat(db, user, text, 'telegram', {
          maritime: maritimeOrNull(),
          localAgentUrl: process.env.VERCEL ? null : process.env.HELM_LOCAL_AGENT_URL,
          apiUrl: process.env.MARITIME_API_URL,
        });
      },
      hold: async (userId, id) => {
        await holdSubmission(db, userId, id);
      },
      submitNow: async (userId, id) => {
        await submitNow(db, userId, id);
        await tick(db, tickDepsFor(db, agentTransport()), userId);
      },
    });
  } catch (err) {
    console.error('[telegram] update failed', err);
  }
}
