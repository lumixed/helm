import { eventStore } from '@/lib/event-store';

export const dynamic = 'force-dynamic';

/** Demo/dev only: read back what agents reported. Disabled unless DEMO_MODE=true. */
export function GET(req: Request) {
  if (process.env.DEMO_MODE !== 'true') return new Response('Not found', { status: 404 });
  const studentId = new URL(req.url).searchParams.get('studentId') ?? undefined;
  return Response.json({ events: eventStore.list(studentId) });
}
