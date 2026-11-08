import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { computersFromEnv } from '@/lib/computers';
import { checkApp, connectApp, desktopDepsFromEnv, disconnectApp, isAppId } from '@/lib/desktop';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ app: string }> };

/** Connect (?action=connect, default) or check now (?action=check). */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { app } = await ctx.params;
  if (!isAppId(app)) return fail(404, 'Unknown app');
  const deps = await desktopDepsFromEnv();
  if (!deps) return fail(503, 'Private desktops are not set up on this server.');
  const db = await getDb();
  const action = new URL(req.url).searchParams.get('action') ?? 'connect';
  try {
    if (action === 'check') {
      const [row] = await db
        .select()
        .from(schema.desktopApps)
        .where(and(eq(schema.desktopApps.userId, user.id), eq(schema.desktopApps.app, app)));
      if (!row || row.status === 'disconnected') return fail(409, 'Connect it first.');
      return json(await checkApp(db, row, deps, { force: true }));
    }
    return json(await connectApp(db, user, app, deps));
  } catch (err) {
    console.error('[desktop]', action, String(err).slice(0, 300));
    return fail(502, 'Your private desktop did not answer. Try again in a moment.');
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { app } = await ctx.params;
  if (!isAppId(app)) return fail(404, 'Unknown app');
  await disconnectApp(await getDb(), user.id, app, computersFromEnv());
  return json({ status: 'disconnected' });
}
