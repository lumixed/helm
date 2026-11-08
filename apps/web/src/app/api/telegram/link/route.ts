import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { botUsername, ensureTelegramWebhook, linkCode, telegramToken } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/** "Connect Telegram": a t.me deep link with a signed code that links this chat to the student. */
export async function POST(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  if (!telegramToken()) return fail(503, 'Telegram is not set up on this server yet.');
  const base = process.env.APP_BASE_URL;
  if (!base) return fail(503, 'APP_BASE_URL is not set');
  try {
    await ensureTelegramWebhook(await getDb(), base);
    return json({ url: `https://t.me/${await botUsername()}?start=${linkCode(user.id)}` });
  } catch (err) {
    console.error('[telegram] link failed', err);
    return fail(502, 'Telegram did not answer. Try again in a moment.');
  }
}

/** Disconnect Telegram. */
export async function DELETE(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  await (
    await getDb()
  )
    .update(schema.users)
    .set({ telegramChatId: null, channel: 'in_app' })
    .where(eq(schema.users.id, user.id));
  return json({ linked: false });
}
