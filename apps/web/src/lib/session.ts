import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { User } from '@/db/schema';

/**
 * Minimal email sign-in (PRD A6: "do not block on auth"). A signed, HTTP-only cookie holds the
 * user id. There is no email verification yet: fine for a demo with fictional data, and Auth0
 * (S6) can replace it without touching the rest of the app.
 */
export const SESSION_COOKIE = 'helm_session';
const MAX_AGE_S = 60 * 60 * 24 * 14;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET must be set (16+ chars)');
  return s;
}

export function signSession(userId: string, now = Date.now(), key = secret()): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Math.floor(now / 1000) + MAX_AGE_S }),
  ).toString('base64url');
  const sig = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(
  value: string | undefined,
  now = Date.now(),
  key = secret(),
): string | null {
  if (!value) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', key).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      uid: string;
      exp: number;
    };
    return exp * 1000 > now && typeof uid === 'string' ? uid : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string) {
  (await cookies()).set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in student, or null. */
export async function currentUser(): Promise<User | null> {
  const uid = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, uid)).limit(1);
  return user ?? null;
}
