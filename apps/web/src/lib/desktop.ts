import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { DesktopApp, User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import { ComputerError, type ComputersClient } from './computers';
import { formatWhen } from './format';
import { ingestEmail } from './inbox';
import { recordHelmEvent } from './submissions';
import { sendToUser } from './telegram';
import type { VisionReader } from './vision';

/**
 * Messaging apps through the person's own Maritime desktop (PRD v3, WP-7 spike: GO). The person
 * logs in themselves through a takeover link; Helm only ever opens the app's address, takes
 * screenshots of the chat list, and puts the desktop back to sleep. It never opens a chat, types
 * or sends, so a message can't make it act. New previews go through the normal message pipeline.
 */
export const APPS = {
  whatsapp: {
    label: 'WhatsApp',
    url: 'https://web.whatsapp.com',
    source: 'whatsapp' as const,
    login:
      'On your phone, open WhatsApp → Settings → Linked devices → Link a device, scan the code, then click Done.',
    beta: false,
  },
  instagram: {
    label: 'Instagram',
    url: 'https://www.instagram.com/direct/inbox/',
    source: 'instagram' as const,
    login: 'Log in to Instagram (and enter any 2FA code), then click Done.',
    beta: true,
  },
};
export type AppId = keyof typeof APPS;
export const isAppId = (s: string): s is AppId => s in APPS;

/** The desktop belongs to the same Maritime end user as the person's agent. */
export const desktopExternalId = (userId: string) => `user_${userId}`;

const MIN = 60_000;
export const checkIntervalMs = () => (process.env.DEMO_MODE === 'true' ? 2 * MIN : 15 * MIN);
/** While waiting for a login, look again at most this often. */
const LINKING_RECHECK_MS = 20_000;
const MAX_NEW_PER_CHECK = 5;

export interface DesktopDeps {
  computers: ComputersClient;
  vision: VisionReader;
  transport: AgentTransport | null;
  now?: Date;
}

const previewKey = (name: string, text: string) =>
  createHash('sha256').update(`${name}\u0000${text}`).digest('hex').slice(0, 24);

/** "Connect WhatsApp": open the app on the person's desktop and hand them a takeover link. */
export async function connectApp(db: Db, user: User, app: AppId, deps: DesktopDeps) {
  const a = APPS[app];
  const c = await deps.computers.ensure(desktopExternalId(user.id));
  if (c.mode !== 'human') {
    await deps.computers.act(c.id, [
      { action: 'key', text: 'ctrl+l', no_screenshot: true },
      { action: 'type', text: a.url, no_screenshot: true },
      { action: 'key', text: 'Return', no_screenshot: true },
      { action: 'wait', duration: 4, no_screenshot: true },
    ]);
  }
  const link = await deps.computers.viewer(c.id, 'control', 900, `Log in to ${a.label} for Helm`);
  await db
    .insert(schema.desktopApps)
    .values({ userId: user.id, app, computerId: c.id, status: 'linking' })
    .onConflictDoUpdate({
      target: [schema.desktopApps.userId, schema.desktopApps.app],
      set: { computerId: c.id, status: 'linking', lastError: null, lastCheckAt: null },
    });
  await recordHelmEvent(
    db,
    user.id,
    'desktop.takeover',
    `Opened ${a.label} on your private desktop. Waiting for you to log in (link valid until ${formatWhen(link.expiresAt, user.timezone)}).`,
    { app, computerId: c.id },
  );
  await sendToUser(
    db,
    user.id,
    `Log in to ${a.label} for Helm on your private desktop. ${a.login}`,
    [[{ text: `Open ${a.label} login`, url: link.url }]],
  );
  return { url: link.url, expiresAt: link.expiresAt, instructions: a.login };
}

export type CheckOutcome =
  | 'skipped'
  | 'person_in_control'
  | 'not_logged_in'
  | 'logged_out'
  | 'not_ready'
  | 'linked'
  | 'checked'
  | 'error';

/**
 * Look at one app's chat list. Read-only: wake, screenshot, read with the vision model, sleep.
 * The first successful read after login only sets a baseline (no flood of old messages).
 */
export async function checkApp(
  db: Db,
  row: DesktopApp,
  deps: DesktopDeps,
  opts: { force?: boolean } = {},
): Promise<{ outcome: CheckOutcome; newMessages: number }> {
  const now = deps.now ?? new Date();
  const a = APPS[row.app as AppId];
  if (!a || row.status === 'disconnected') return { outcome: 'skipped', newMessages: 0 };
  const every = row.status === 'linking' ? LINKING_RECHECK_MS : checkIntervalMs();
  if (!opts.force && row.lastCheckAt && now.getTime() - row.lastCheckAt.getTime() < every)
    return { outcome: 'skipped', newMessages: 0 };
  // Claim the check, so two callers (page poll, heartbeat) don't both run it.
  const [claimed] = await db
    .update(schema.desktopApps)
    .set({ lastCheckAt: now })
    .where(
      and(
        eq(schema.desktopApps.id, row.id),
        row.lastCheckAt
          ? eq(schema.desktopApps.lastCheckAt, row.lastCheckAt)
          : isNull(schema.desktopApps.lastCheckAt),
      ),
    )
    .returning();
  if (!claimed) return { outcome: 'skipped', newMessages: 0 };

  const set = (v: Partial<typeof schema.desktopApps.$inferInsert>) =>
    db.update(schema.desktopApps).set(v).where(eq(schema.desktopApps.id, row.id));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, row.userId));
  if (!user) return { outcome: 'error', newMessages: 0 };

  try {
    const c = await deps.computers.get(row.computerId);
    if (c.mode === 'human') return { outcome: 'person_in_control', newMessages: 0 };
    await deps.computers.wake(row.computerId);
    const read = await deps.vision(await deps.computers.screenshot(row.computerId), a.label);
    if (read.screen === 'login') {
      if (row.status === 'linked') {
        await set({ status: 'needs_login', lastError: `${a.label} logged out.` });
        await recordHelmEvent(
          db,
          row.userId,
          'alert.sent',
          `${a.label} logged out on your private desktop. Connect it again to keep reading messages.`,
          { app: row.app },
        );
        await sendToUser(
          db,
          row.userId,
          `${a.label} logged out on your Helm desktop. Open Helm and connect it again.`,
        );
        return done('logged_out');
      }
      return done('not_logged_in');
    }
    if (read.screen !== 'chat_list') return done('not_ready');

    const keys = read.chats.map((ch) => previewKey(ch.name, ch.lastMessage));
    if (row.status !== 'linked') {
      // Just logged in: remember what's there now; read only what arrives from here on.
      await set({ status: 'linked', linkedAt: now, lastError: null, seenJson: keys.slice(-300) });
      await recordHelmEvent(
        db,
        row.userId,
        'desktop.checked',
        `${a.label} connected. Helm reads new messages from now on, every ${Math.round(checkIntervalMs() / MIN)} min, without opening chats.`,
        { app: row.app, chats: read.chats.length, model: read.model },
      );
      await sendToUser(
        db,
        row.userId,
        `${a.label} connected. Helm will read new messages from now on. It never opens chats, types or sends.`,
      );
      return done('linked');
    }

    const seen = new Set(row.seenJson);
    const fresh = read.chats
      .map((ch, i) => ({ ...ch, key: keys[i]! }))
      .filter((ch) => ch.unread > 0 && ch.lastMessage.trim() && !seen.has(ch.key))
      .slice(0, MAX_NEW_PER_CHECK);
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.userId, row.userId));
    let sent = 0;
    for (const ch of fresh) {
      if (!agent?.maritimeAgentId || !deps.transport) break;
      await ingestEmail(
        db,
        user,
        agent.maritimeAgentId,
        deps.transport,
        {
          source: a.source,
          from: ch.name,
          subject: '',
          body: ch.lastMessage,
          receivedAt: now.toISOString(),
        },
        now,
      );
      seen.add(ch.key);
      sent++;
    }
    await set({ seenJson: [...seen].slice(-300), lastError: null });
    if (sent > 0 || opts.force)
      await recordHelmEvent(
        db,
        row.userId,
        'desktop.checked',
        `Checked ${a.label} on your private desktop: ${sent ? `${sent} new message${sent === 1 ? '' : 's'} sent to your agent` : 'nothing new'}.`,
        { app: row.app, chats: read.chats.length, newMessages: sent, model: read.model },
      );
    return done('checked', sent);
  } catch (err) {
    const missing = err instanceof ComputerError && err.status === 404;
    await set({
      status: missing ? 'error' : row.status,
      lastError: missing ? 'Desktop not found. Connect again.' : String(err).slice(0, 300),
    });
    return { outcome: 'error', newMessages: 0 };
  }

  async function done(outcome: CheckOutcome, newMessages = 0) {
    // Back to sleep right away: ~30 s awake per check, and it frees the awake slot.
    await deps.computers.sleep(row.computerId).catch(() => {});
    return { outcome, newMessages };
  }
}

/** Run due checks (all people, or one). Safe to call from the heartbeat, cron and page polls. */
export async function checkDue(db: Db, deps: DesktopDeps, userId?: string) {
  const rows = await db
    .select()
    .from(schema.desktopApps)
    .where(
      and(
        ...(userId ? [eq(schema.desktopApps.userId, userId)] : []),
        inArray(schema.desktopApps.status, ['linking', 'linked']),
        or(
          isNull(schema.desktopApps.lastCheckAt),
          lte(
            schema.desktopApps.lastCheckAt,
            new Date((deps.now ?? new Date()).getTime() - LINKING_RECHECK_MS),
          ),
        ),
      ),
    )
    .limit(10);
  const out: Record<string, CheckOutcome> = {};
  for (const r of rows) {
    const { outcome } = await checkApp(db, r, deps);
    if (outcome !== 'skipped') out[r.app] = outcome;
  }
  return out;
}

/** Stop reading an app. When no app is left, the desktop (and every login on it) is deleted. */
export async function disconnectApp(
  db: Db,
  userId: string,
  app: AppId,
  computers: ComputersClient | null,
) {
  const [row] = await db
    .update(schema.desktopApps)
    .set({ status: 'disconnected', seenJson: [] })
    .where(and(eq(schema.desktopApps.userId, userId), eq(schema.desktopApps.app, app)))
    .returning();
  if (!row) return false;
  const still = await db
    .select({ id: schema.desktopApps.id })
    .from(schema.desktopApps)
    .where(
      and(
        eq(schema.desktopApps.userId, userId),
        inArray(schema.desktopApps.status, ['linking', 'linked', 'needs_login']),
      ),
    );
  if (still.length === 0 && computers) await computers.remove(row.computerId).catch(() => {});
  await recordHelmEvent(
    db,
    userId,
    'desktop.checked',
    `Disconnected ${APPS[app].label}.${still.length === 0 ? ' Your private desktop and its logins were deleted.' : ''}`,
    { app },
  );
  return true;
}

export async function listApps(db: Db, user: User) {
  const rows = await db
    .select()
    .from(schema.desktopApps)
    .where(eq(schema.desktopApps.userId, user.id));
  return (Object.keys(APPS) as AppId[]).map((app) => {
    const r = rows.find((x) => x.app === app);
    return {
      app,
      label: APPS[app].label,
      beta: APPS[app].beta,
      status: (r?.status ?? 'disconnected') as string,
      lastCheckLabel: r?.lastCheckAt ? formatWhen(r.lastCheckAt, user.timezone) : null,
      lastError: r?.lastError ?? null,
      instructions: APPS[app].login,
    };
  });
}
export type AppView = Awaited<ReturnType<typeof listApps>>[number];

/** This server's desktop dependencies, or null when computers or the vision model aren't set up. */
export async function desktopDepsFromEnv(): Promise<DesktopDeps | null> {
  const { computersFromEnv } = await import('./computers');
  const { geminiVision } = await import('./vision');
  const { agentTransport } = await import('./agent-transport');
  const computers = computersFromEnv();
  const key = process.env.GEMINI_API_KEY;
  if (!computers || !key) return null;
  return { computers, vision: geminiVision(key), transport: agentTransport() };
}
