import { demoFeedIcs, verifyDemoFeedToken } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

/**
 * DEMO PORTAL calendar feed (.ics), shaped like a Canvas "Calendar Feed": an unguessable link
 * per person, no login. Fictional course "DEMO 101", dates relative to today.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const userId = verifyDemoFeedToken((await ctx.params).token.replace(/\.ics$/, ''));
  if (!userId) return new Response('Not found', { status: 404 });
  return new Response(demoFeedIcs(userId), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' },
  });
}
