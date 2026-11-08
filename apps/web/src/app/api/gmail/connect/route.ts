import { authUrl, gmailConfig } from '@/lib/gmail';
import { fail } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Start "Connect Gmail (read-only)": off to Google's consent screen. */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  if (!gmailConfig()) return fail(503, 'Gmail is not set up on this server yet.');
  return Response.redirect(authUrl(user.id), 302);
}
