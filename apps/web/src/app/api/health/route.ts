export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, service: 'helm-web', time: new Date().toISOString() });
}
