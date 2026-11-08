import { sendPushToUser } from './push';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BriefContent } from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';

/**
 * Telegram (PRD v3 "check my phone every morning"): the morning brief, hold notices with
 * Hold / Submit now buttons, and alerts, sent by the backend through the Bot API. The bot token
 * stays on the server; agents never talk to Telegram (no allowlist change).
 */

const API = 'https://api.telegram.org';

export function telegramToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Tests swap the transport. */
export function setTelegramFetch(f: Fetch) {
  fetchImpl = f;
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = telegramToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const res = await fetchImpl(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const out = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!out.ok) throw new Error(`Telegram ${method}: ${out.description ?? `HTTP ${res.status}`}`);
  return out.result as T;
}

function secretKey(purpose: string): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET must be set (16+ chars)');
  return createHmac('sha256', s).update(`helm-telegram:${purpose}`).digest('base64url');
}

/** Telegram's "start" parameter: [A-Za-z0-9_-], up to 64 chars. user id (hex) + signature. */
export function linkCode(userId: string): string {
  const hex = userId.replace(/-/g, '');
  const sig = createHmac('sha256', secretKey('link')).update(hex).digest('base64url').slice(0, 22);
  return `${hex}${sig}`;
}

export function verifyLinkCode(code: string): string | null {
  const m = /^([0-9a-f]{32})([A-Za-z0-9_-]{22})$/.exec(code);
  if (!m) return null;
  const want = Buffer.from(linkCode(m[1]!).slice(32));
  const got = Buffer.from(m[2]!);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const h = m[1]!;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Shared secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
export const webhookSecret = () => secretKey('webhook').slice(0, 48);

let botName: string | null = null;
export async function botUsername(): Promise<string> {
  botName ??= (await tg<{ username: string }>('getMe', {})).username;
  return botName;
}

/** Point Telegram at this app's webhook once per URL (stored, so it isn't re-set every time). */
export async function ensureTelegramWebhook(db: Db, appBaseUrl: string) {
  const url = `${appBaseUrl.replace(/\/+$/, '')}/api/telegram/webhook`;
  const [row] = await db
    .select()
    .from(schema.appSecrets)
    .where(eq(schema.appSecrets.key, 'telegram:webhook'));
  if (row?.value === url) return;
  await tg('setWebhook', {
    url,
    secret_token: webhookSecret(),
    allowed_updates: ['message', 'callback_query'],
  });
  await db
    .insert(schema.appSecrets)
    .values({ key: 'telegram:webhook', value: url })
    .onConflictDoUpdate({ target: schema.appSecrets.key, set: { value: url } });
}

export interface Button {
  text: string;
  /** callback_data (max 64 bytes) or a URL. */
  data?: string;
  url?: string;
}

/** Send to the student's linked chat, if any. Never throws: Telegram is additive (PRD risks). */
export async function sendToUser(db: Db, userId: string, text: string, buttons: Button[][] = []) {
  // Native app push (same message), then Telegram. Either one counts as delivered to the phone.
  const pushed = await sendPushToUser(db, userId, text, buttons).catch(() => false);
  if (!telegramToken()) return pushed;
  const [u] = await db
    .select({ chat: schema.users.telegramChatId })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!u?.chat) return pushed;
  try {
    await tg('sendMessage', {
      chat_id: u.chat,
      text: text.slice(0, 4000),
      disable_web_page_preview: true,
      ...(buttons.length
        ? {
            reply_markup: {
              inline_keyboard: buttons.map((row) =>
                row.map((b) =>
                  b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data },
                ),
              ),
            },
          }
        : {}),
    });
    return true;
  } catch (err) {
    console.warn('[telegram] send failed', String(err).slice(0, 200));
    return pushed;
  }
}

/** The brief as a short message (PRD M5: <= 150 words, with a link). */
export function briefMessage(b: BriefContent, appUrl: string | undefined): string {
  const lines = [b.summary.trim()];
  if (b.focus.length) {
    lines.push('', 'Today:');
    b.focus.forEach((f, i) =>
      lines.push(
        `${i + 1}. ${f.courseCode ? `${f.courseCode} · ` : ''}${f.title}${f.minutes ? ` (${f.minutes >= 60 ? `${Math.round(f.minutes / 6) / 10}h` : `${f.minutes} min`})` : ''}`,
      ),
    );
  }
  if (b.changes.length)
    lines.push(
      '',
      `${b.changes.length} change${b.changes.length === 1 ? '' : 's'} since your last brief.`,
    );
  if (b.dueSoon.length) lines.push(`Also due in 3 days: ${b.dueSoon.length}.`);
  const words = lines.join('\n').split(/\s+/);
  let text = words.length > 150 ? `${words.slice(0, 150).join(' ')}…` : lines.join('\n');
  if (appUrl) text += `\n\nOpen Helm: ${appUrl.replace(/\/+$/, '')}/today`;
  return text;
}

type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
};

export interface UpdateActions {
  hold: (userId: string, submissionId: string) => Promise<void>;
  submitNow: (userId: string, submissionId: string) => Promise<void>;
}

/** Handle one webhook update: link/unlink a chat, or a Hold / Submit now button. */
export async function handleUpdate(db: Db, u: Update, actions: UpdateActions): Promise<string> {
  if (u.message?.text) {
    const chat = String(u.message.chat.id);
    const [cmd, arg] = u.message.text.trim().split(/\s+/, 2);
    if (cmd === '/start' && arg) {
      const userId = verifyLinkCode(arg);
      if (!userId) {
        await tg('sendMessage', {
          chat_id: chat,
          text: 'That link expired or is not valid. Open Helm and tap Connect Telegram again.',
        });
        return 'bad-code';
      }
      // One chat per student, one student per chat.
      await db
        .update(schema.users)
        .set({ telegramChatId: null })
        .where(eq(schema.users.telegramChatId, chat));
      const done = await db
        .update(schema.users)
        .set({ telegramChatId: chat, channel: 'telegram' })
        .where(eq(schema.users.id, userId))
        .returning({ id: schema.users.id });
      await tg('sendMessage', {
        chat_id: chat,
        text: done.length
          ? 'Connected. Your morning brief, last-chance notices and alerts will arrive here. Send /stop to disconnect.'
          : 'Account not found.',
      });
      return done.length ? 'linked' : 'no-user';
    }
    if (cmd === '/stop') {
      await db
        .update(schema.users)
        .set({ telegramChatId: null, channel: 'in_app' })
        .where(eq(schema.users.telegramChatId, chat));
      await tg('sendMessage', {
        chat_id: chat,
        text: 'Disconnected. Helm will only notify you in the app.',
      });
      return 'unlinked';
    }
    await tg('sendMessage', {
      chat_id: chat,
      text: 'Hi! I only send notices from Helm. Open the app to see your day.',
    });
    return 'ignored';
  }

  const cb = u.callback_query;
  if (cb?.data && cb.message) {
    const chat = String(cb.message.chat.id);
    const [u2] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.telegramChatId, chat));
    const [action, submissionId] = cb.data.split(':', 2);
    let answer = 'Not linked to Helm.';
    if (u2 && submissionId) {
      try {
        if (action === 'hold') {
          await actions.hold(u2.id, submissionId);
          answer = 'Held. Nothing will be handed in until you release it in Helm.';
        } else if (action === 'now') {
          await actions.submitNow(u2.id, submissionId);
          answer = 'Handing it in now.';
        } else answer = 'Unknown action.';
      } catch (err) {
        answer = err instanceof Error ? err.message : 'Could not do that.';
      }
      await tg('editMessageReplyMarkup', {
        chat_id: chat,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: answer.slice(0, 200) }).catch(
      () => {},
    );
    if (u2) await tg('sendMessage', { chat_id: chat, text: answer }).catch(() => {});
    return `callback:${action}`;
  }
  return 'noop';
}
