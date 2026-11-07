import { cookies } from 'next/headers';
import { bearer } from './agent-auth';
import { PORTAL_COOKIE, verifyPortalSession } from './portal';
import { SESSION_COOKIE, verifySession } from './session';

/**
 * Who is calling the demo portal: a portal session (the agent, after logging in with its own
 * credentials; or a browser cookie), or a signed-in Helm student using the portal by hand.
 */
export async function portalUser(
  req: Request,
): Promise<{ userId: string; via: 'agent' | 'manual' } | null> {
  const token = bearer(req);
  if (token) {
    const uid = verifyPortalSession(token);
    return uid ? { userId: uid, via: 'agent' } : null;
  }
  const jar = await cookies();
  const portal = verifyPortalSession(jar.get(PORTAL_COOKIE)?.value);
  if (portal) return { userId: portal, via: 'manual' };
  const helm = verifySession(jar.get(SESSION_COOKIE)?.value);
  return helm ? { userId: helm, via: 'manual' } : null;
}
