import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { PortalSubmission } from '@/db/schema';
import { signSession, verifySession } from './session';

/**
 * The DEMO PORTAL (PRD section 13): a clearly labelled stand-in for an LMS, served by this app at
 * /mock-portal. It keeps metadata and a hash of each file, never the file itself, and imitates
 * no real institution.
 */

function key(purpose: string): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET must be set (16+ chars)');
  return createHmac('sha256', s).update(`helm-demo-portal:${purpose}`).digest('base64url');
}

/**
 * Each student's demo-portal login. Derived from the server secret, so the backend never stores
 * it; it goes to the student's agent only as an encrypted Maritime env var.
 */
export function portalCredentials(userId: string) {
  return {
    username: userId,
    password: createHmac('sha256', key('password')).update(userId).digest('base64url').slice(0, 24),
  };
}

export function checkPortalLogin(username: string, password: string): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(username)) return null;
  const want = Buffer.from(portalCredentials(username).password);
  const got = Buffer.from(password);
  return want.length === got.length && timingSafeEqual(want, got) ? username : null;
}

/** Portal sessions are separate from Helm sessions (different signing key). */
export const PORTAL_COOKIE = 'demo_portal_session';
export const signPortalSession = (userId: string, now = Date.now()) =>
  signSession(userId, now, key('session'));
export const verifyPortalSession = (value: string | undefined, now = Date.now()) =>
  verifySession(value, now, key('session'));

export function portalBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const base =
    env.PORTAL_PUBLIC_URL ||
    (env.APP_BASE_URL && `${env.APP_BASE_URL.replace(/\/+$/, '')}/mock-portal`);
  return base ? base.replace(/\/+$/, '') : null;
}

export type PortalSubmitResult =
  | { kind: 'accepted'; receipt: PortalSubmission }
  | { kind: 'duplicate'; receipt: PortalSubmission }
  | { kind: 'already_submitted'; receipt: PortalSubmission }
  | { kind: 'late' }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; mode: '503' | 'timeout' };

/** Failure injection: true (and one fewer left) when this call should fail. */
async function takeInjectedFailure(db: Db, userId: string) {
  const [s] = await db
    .select()
    .from(schema.portalState)
    .where(eq(schema.portalState.userId, userId));
  if (!s || s.failNext <= 0) return null;
  await db
    .update(schema.portalState)
    .set({ failNext: s.failNext - 1 })
    .where(eq(schema.portalState.userId, userId));
  return s.failMode === 'timeout' ? ('timeout' as const) : ('503' as const);
}

/**
 * Accept one submission. Duplicates (same idempotency key) return the original receipt; a second
 * submission for the same assignment is refused; nothing is accepted after the due time.
 */
export async function portalSubmit(
  db: Db,
  userId: string,
  input: {
    assignmentId: string;
    idempotencyKey: string;
    fileName: string;
    fileSize: number;
    fileSha256: string;
    via: 'agent' | 'manual';
  },
  now = new Date(),
): Promise<PortalSubmitResult> {
  const injected = await takeInjectedFailure(db, userId);
  if (injected) return { kind: 'unavailable', mode: injected };

  const [dup] = await db
    .select()
    .from(schema.portalSubmissions)
    .where(
      and(
        eq(schema.portalSubmissions.userId, userId),
        eq(schema.portalSubmissions.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (dup) return { kind: 'duplicate', receipt: dup };

  if (!/^[0-9a-f-]{36}$/i.test(input.assignmentId)) return { kind: 'not_found' };
  const [a] = await db
    .select()
    .from(schema.assignments)
    .where(
      and(eq(schema.assignments.id, input.assignmentId), eq(schema.assignments.userId, userId)),
    );
  if (!a) return { kind: 'not_found' };
  if (!a.dueAt || a.dueAt.getTime() <= now.getTime()) return { kind: 'late' };

  const [inserted] = await db
    .insert(schema.portalSubmissions)
    .values({
      userId,
      assignmentId: a.id,
      idempotencyKey: input.idempotencyKey,
      confirmationId: `DP-${randomBytes(4).toString('hex').toUpperCase()}`,
      fileName: input.fileName.slice(0, 300),
      fileSize: input.fileSize,
      fileSha256: input.fileSha256,
      via: input.via,
      submittedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { kind: 'accepted', receipt: inserted };
  // Lost a race, or another submission already exists for this assignment.
  const [existing] = await db
    .select()
    .from(schema.portalSubmissions)
    .where(
      and(
        eq(schema.portalSubmissions.userId, userId),
        eq(schema.portalSubmissions.assignmentId, a.id),
      ),
    );
  return existing!.idempotencyKey === input.idempotencyKey
    ? { kind: 'duplicate', receipt: existing! }
    : { kind: 'already_submitted', receipt: existing! };
}

export async function portalFind(db: Db, userId: string, idempotencyKey: string) {
  const [row] = await db
    .select()
    .from(schema.portalSubmissions)
    .where(
      and(
        eq(schema.portalSubmissions.userId, userId),
        eq(schema.portalSubmissions.idempotencyKey, idempotencyKey),
      ),
    );
  return row ?? null;
}

export async function setPortalFailures(
  db: Db,
  userId: string,
  failNext: number,
  failMode: '503' | 'timeout',
) {
  await db
    .insert(schema.portalState)
    .values({ userId, failNext, failMode })
    .onConflictDoUpdate({ target: schema.portalState.userId, set: { failNext, failMode } });
}

export async function portalFailures(db: Db, userId: string) {
  const [s] = await db
    .select()
    .from(schema.portalState)
    .where(eq(schema.portalState.userId, userId));
  return { failNext: s?.failNext ?? 0, failMode: (s?.failMode ?? '503') as '503' | 'timeout' };
}

export const receiptJson = (r: PortalSubmission) => ({
  confirmationId: r.confirmationId,
  submittedAt: r.submittedAt.toISOString(),
  fileName: r.fileName,
  fileSha256: r.fileSha256,
});
