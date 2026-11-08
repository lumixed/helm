import { eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';

/**
 * Native push for the Helm iPhone/Android app (Expo). Every phone notification already goes
 * through telegram.sendToUser; that function also calls sendPushToUser, so push and Telegram
 * always carry the same message.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export const isExpoPushToken = (t: string) => TOKEN_RE.test(t);

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
export function setPushFetch(f: Fetch) {
  fetchImpl = f;
}

export async function registerPushToken(db: Db, userId: string, token: string, platform: string) {
  await db
    .insert(schema.pushTokens)
    .values({ userId, token, platform })
    .onConflictDoUpdate({ target: schema.pushTokens.token, set: { userId, platform } });
}

/** Where tapping the notification should land in the app. */
export function pushPath(text: string, buttons: { data?: string; url?: string }[][] = []): string {
  const flat = buttons.flat();
  const url = flat.find((b) => b.url)?.url;
  if (url) {
    try {
      const u = new URL(url);
      if (u.origin === new URL(process.env.APP_BASE_URL ?? 'http://x').origin)
        return u.pathname + u.search;
    } catch {
      /* not a URL */
    }
  }
  if (
    flat.some((b) => /^(hold|now|release|cancel):/.test(b.data ?? '')) ||
    /hand(ed)? in|submi/i.test(text)
  )
    return '/submissions';
  return '/today';
}

/**
 * Send to every registered phone of this person. Returns true if at least one push was accepted.
 * Tokens Expo reports as no longer registered are removed.
 */
export async function sendPushToUser(
  db: Db,
  userId: string,
  text: string,
  buttons: { data?: string; url?: string }[][] = [],
): Promise<boolean> {
  const tokens = await db
    .select()
    .from(schema.pushTokens)
    .where(eq(schema.pushTokens.userId, userId));
  if (tokens.length === 0) return false;
  const [title, ...rest] = text.split('\n').filter((l) => l.trim());
  const body = rest.join(' ').replace(/\s+/g, ' ').trim().slice(0, 240) || title!;
  const path = pushPath(text, buttons);
  const messages = tokens.map((t) => ({
    to: t.token,
    title: (rest.length ? title! : 'Helm').slice(0, 120),
    body,
    sound: 'default',
    data: { path },
  }));
  try {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    const tickets = out.data ?? [];
    const dead = tickets.flatMap((t, i) =>
      t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? [tokens[i]!.token] : [],
    );
    if (dead.length)
      await db.delete(schema.pushTokens).where(inArray(schema.pushTokens.token, dead));
    const ok = tickets.some((t) => t.status === 'ok');
    if (ok)
      await db
        .update(schema.pushTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.pushTokens.userId, userId));
    return ok;
  } catch (err) {
    console.warn('[push] send failed', String(err).slice(0, 200));
    return false;
  }
}
