import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { fail } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** The screen Helm is asking about, or the final one. Only ever shown to its owner. */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(404, 'No such task');
  const [row] = await (
    await getDb()
  )
    .select({ png: schema.webTasks.screenshotB64 })
    .from(schema.webTasks)
    .where(and(eq(schema.webTasks.id, id), eq(schema.webTasks.userId, user.id)));
  if (!row?.png) return fail(404, 'No screenshot');
  return new Response(new Uint8Array(Buffer.from(row.png, 'base64')), {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' },
  });
}
