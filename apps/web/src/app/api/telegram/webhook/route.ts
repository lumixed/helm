import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { json } from '@/lib/http';
import { holdSubmission, submitNow, tick, tickDepsFor } from '@/lib/submissions';
import { handleUpdate, telegramToken, webhookSecret } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

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
  try {
    await handleUpdate(db, update, {
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
  // Always 200, or Telegram retries the same update.
  return json({ ok: true });
}
