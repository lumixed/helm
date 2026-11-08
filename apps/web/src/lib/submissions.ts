import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import {
  CheckResult,
  afterFailure,
  blocking,
  encodeAgentMessage,
  onDeadlineMoved,
  runSubmissionChecks,
  submissionTimings,
  warnings,
  type AgentEventType,
  type SubmissionResultRequest,
  type SubmissionTimings,
} from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { Assignment, Submission, User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import { formatWhen } from './format';
import { recordSent } from './maritime-webhooks';

/** PRD M7 / section 12. Times come from shared rules; demo mode shortens the windows. */
export const timings = (): SubmissionTimings => submissionTimings(process.env.DEMO_MODE === 'true');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = ['ready', 'checks_failed', 'scheduled', 'held', 'submitting'] as const;

export class SubmissionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A Helm-side entry on the student's timeline (the scheduler is part of Helm, not the agent). */
export async function recordHelmEvent(
  db: Db,
  userId: string,
  type: AgentEventType,
  reason: string,
  payload: Record<string, unknown> = {},
  eventId = `helm:${type}:${randomUUID()}`,
) {
  await db
    .insert(schema.agentEvents)
    .values({
      userId,
      eventId,
      type,
      reason,
      payloadJson: { ...payload, source: 'helm' },
      occurredAt: new Date(),
    })
    .onConflictDoNothing();
}

async function notify(db: Db, userId: string, kind: string, payload: Record<string, unknown>) {
  await db
    .insert(schema.notifications)
    .values({ userId, kind, channel: 'in_app', status: 'unread', payloadJson: payload });
}

async function mine(db: Db, userId: string, id: string): Promise<Submission> {
  if (!UUID.test(id)) throw new SubmissionError(404, 'Submission not found.');
  const [s] = await db
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.id, id), eq(schema.submissions.userId, userId)));
  if (!s) throw new SubmissionError(404, 'Submission not found.');
  return s;
}

async function assignmentOf(db: Db, userId: string, id: string): Promise<Assignment> {
  if (!UUID.test(id)) throw new SubmissionError(404, 'Assignment not found.');
  const [a] = await db
    .select()
    .from(schema.assignments)
    .where(
      and(
        eq(schema.assignments.id, id),
        eq(schema.assignments.userId, userId),
        eq(schema.assignments.confirmed, true),
      ),
    );
  if (!a) throw new SubmissionError(404, 'Assignment not found.');
  return a;
}

async function portalHas(db: Db, userId: string, assignmentId: string) {
  const [p] = await db
    .select({ id: schema.portalSubmissions.id })
    .from(schema.portalSubmissions)
    .where(
      and(
        eq(schema.portalSubmissions.userId, userId),
        eq(schema.portalSubmissions.assignmentId, assignmentId),
      ),
    );
  return Boolean(p);
}

function checksFor(
  s: Pick<Submission, 'fileName' | 'fileSize' | 'fileSha256'>,
  a: Assignment,
  now: Date,
  extra: { consentSha256?: string | null; alreadySubmitted?: boolean } = {},
) {
  return runSubmissionChecks({
    fileName: s.fileName,
    fileSize: s.fileSize,
    fileSha256: s.fileSha256,
    assignment: {
      title: a.title,
      dueAt: a.dueAt,
      status: a.status,
      allowedFileTypes: a.allowedFileTypes,
    },
    now,
    ...extra,
  });
}

/** When to submit by default: lead time before the deadline, but never in the past. */
export function defaultSubmitAt(due: Date, now: Date, t = timings()): Date {
  return new Date(Math.max(due.getTime() - t.leadMs, now.getTime() + t.holdMs));
}

/**
 * Upload finished homework (PRD J4). The file goes to the student's own agent; the backend keeps
 * the name, size and SHA-256 only. Checks run now and again at submit time.
 */
export async function createSubmission(
  db: Db,
  user: User,
  maritimeAgentId: string,
  transport: AgentTransport,
  input: { assignmentId: string; fileName: string; bytes: Uint8Array; submitAt?: Date | null },
  now = new Date(),
) {
  const a = await assignmentOf(db, user.id, input.assignmentId);
  const busy = await db
    .select({ id: schema.submissions.id, status: schema.submissions.status })
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.userId, user.id),
        eq(schema.submissions.assignmentId, a.id),
        inArray(schema.submissions.status, [...ACTIVE]),
      ),
    );
  if (
    busy.some((b) => b.status === 'scheduled' || b.status === 'held' || b.status === 'submitting')
  )
    throw new SubmissionError(409, 'This already has a scheduled hand-in. Cancel it first.');

  const id = randomUUID();
  const fileName = input.fileName.trim().slice(0, 200) || 'homework';
  const fileSha256 = createHash('sha256').update(input.bytes).digest('hex');
  const checks = checksFor({ fileName, fileSize: input.bytes.length, fileSha256 }, a, now, {
    alreadySubmitted: await portalHas(db, user.id, a.id),
  });
  const t = timings();
  let submitAt: Date | null = null;
  let fromDefault = true;
  if (a.dueAt) {
    if (input.submitAt) {
      if (input.submitAt.getTime() >= a.dueAt.getTime())
        throw new SubmissionError(400, 'Pick a time before the deadline.');
      submitAt = new Date(Math.max(input.submitAt.getTime(), now.getTime()));
      fromDefault = false;
    } else submitAt = defaultSubmitAt(a.dueAt, now, t);
  }

  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const agentFilePath = `/data/homework/${id}/${safe}`;
  if (!blocking(checks)) await transport.putFile(maritimeAgentId, agentFilePath, input.bytes);

  // A new upload replaces an earlier unscheduled one for the same assignment.
  if (busy.length)
    await db
      .update(schema.submissions)
      .set({ status: 'cancelled', lastError: 'Replaced by a newer upload.' })
      .where(
        inArray(
          schema.submissions.id,
          busy.map((b) => b.id),
        ),
      );

  const [row] = await db
    .insert(schema.submissions)
    .values({
      id,
      userId: user.id,
      assignmentId: a.id,
      fileName,
      fileSize: input.bytes.length,
      fileSha256,
      agentFilePath: blocking(checks) ? null : agentFilePath,
      status: blocking(checks) ? 'checks_failed' : 'ready',
      submitAt,
      submitAtFromDefault: fromDefault,
      checksJson: checks,
      idempotencyKey: id,
    })
    .returning();
  return row!;
}

/** The student's Schedule tap: this is their consent (PRD J4 step 3). */
export async function scheduleSubmission(
  db: Db,
  userId: string,
  id: string,
  opts: { ackWarnings: boolean },
  now = new Date(),
) {
  const s = await mine(db, userId, id);
  if (s.status !== 'ready') throw new SubmissionError(409, `It is ${s.status.replace('_', ' ')}.`);
  const a = await assignmentOf(db, userId, s.assignmentId);
  const checks = checksFor(s, a, now, { alreadySubmitted: await portalHas(db, userId, a.id) });
  if (blocking(checks)) {
    await db
      .update(schema.submissions)
      .set({ status: 'checks_failed', checksJson: checks })
      .where(eq(schema.submissions.id, s.id));
    throw new SubmissionError(409, checks.find((c) => c.status === 'fail')!.message);
  }
  if (warnings(checks).length && !opts.ackWarnings)
    throw new SubmissionError(409, 'Confirm the warnings first.');
  const t = timings();
  const submitAt =
    s.submitAt && s.submitAt.getTime() > now.getTime()
      ? s.submitAt
      : defaultSubmitAt(a.dueAt!, now, t);
  const [row] = await db
    .update(schema.submissions)
    .set({
      status: 'scheduled',
      consentAt: now,
      consentSha256: s.fileSha256,
      submitAt,
      holdUntil: new Date(submitAt.getTime() - t.holdMs),
      holdNoticeSentAt: null,
      checksJson: checks,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    })
    .where(and(eq(schema.submissions.id, s.id), eq(schema.submissions.status, 'ready')))
    .returning();
  if (!row) throw new SubmissionError(409, 'It changed while you were looking. Refresh.');
  await recordHelmEvent(
    db,
    userId,
    'submission.scheduled',
    `You scheduled "${s.fileName}" for ${a.title}: Helm submits it ${formatWhen(submitAt, await tzOf(db, userId))}`,
    { submissionId: s.id, fileSha256: s.fileSha256 },
  );
  return row;
}

async function tzOf(db: Db, userId: string) {
  const [u] = await db
    .select({ tz: schema.users.timezone })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return u?.tz ?? 'America/Vancouver';
}

async function transition(
  db: Db,
  userId: string,
  id: string,
  from: Submission['status'][],
  set: Partial<typeof schema.submissions.$inferInsert>,
) {
  const s = await mine(db, userId, id);
  if (!from.includes(s.status))
    throw new SubmissionError(409, `It is already ${s.status.replace('_', ' ')}.`);
  const [row] = await db
    .update(schema.submissions)
    .set(set)
    .where(and(eq(schema.submissions.id, s.id), inArray(schema.submissions.status, from)))
    .returning();
  if (!row) throw new SubmissionError(409, 'It changed while you were looking. Refresh.');
  return row;
}

/** Hold: nothing is submitted until the student releases it. */
export async function holdSubmission(db: Db, userId: string, id: string) {
  const row = await transition(db, userId, id, ['scheduled'], { status: 'held' });
  await recordHelmEvent(
    db,
    userId,
    'submission.held',
    `You held "${row.fileName}". Nothing will be submitted until you release it.`,
    { submissionId: id },
  );
  return row;
}

/** Release a hold. If the submit time has passed, it goes now (consent was already given). */
export async function releaseSubmission(db: Db, userId: string, id: string, now = new Date()) {
  const s = await mine(db, userId, id);
  const t = timings();
  const submitAt = s.submitAt && s.submitAt > now ? s.submitAt : now;
  const row = await transition(db, userId, id, ['held'], {
    status: 'scheduled',
    submitAt,
    holdUntil: new Date(submitAt.getTime() - t.holdMs),
    // Releasing is itself the answer to the hold notice.
    holdNoticeSentAt: new Date(Math.min(now.getTime(), submitAt.getTime() - t.holdMs)),
    lastError: null,
  });
  await recordHelmEvent(db, userId, 'submission.released', `You released "${row.fileName}".`, {
    submissionId: id,
  });
  return row;
}

/** Submit now: skip the remaining wait (consent and checks still apply). */
export async function submitNow(db: Db, userId: string, id: string, now = new Date()) {
  const t = timings();
  const row = await transition(db, userId, id, ['scheduled', 'held'], {
    status: 'scheduled',
    submitAt: now,
    holdNoticeSentAt: new Date(now.getTime() - t.holdMs),
    nextAttemptAt: null,
  });
  return row;
}

export async function cancelSubmission(db: Db, userId: string, id: string) {
  const row = await transition(
    db,
    userId,
    id,
    ['draft', 'ready', 'checks_failed', 'scheduled', 'held'],
    {
      status: 'cancelled',
    },
  );
  await recordHelmEvent(
    db,
    userId,
    'submission.cancelled',
    `You cancelled "${row.fileName}". Nothing was submitted.`,
    { submissionId: id },
  );
  return row;
}

export interface TickDeps {
  transport: AgentTransport | null;
  /** Maritime agent id per student. */
  agentIdFor: (userId: string) => Promise<string | null>;
  now?: Date;
}

/**
 * The scheduler (PRD 8 and 12). Idempotent and safe to call from anywhere, any number of times:
 * every state change is a conditional update, so two ticks can't both act on one row. Driven by
 * open app pages, each agent's platform-cron heartbeat (the safety net), and an optional cron.
 */
export async function tick(db: Db, deps: TickDeps, userId?: string) {
  const now = deps.now ?? new Date();
  const t = timings();
  const forUser = userId ? [eq(schema.submissions.userId, userId)] : [];
  const done = { notices: 0, runs: 0, timeouts: 0, expired: 0 };

  // 1. Deadline passed while waiting: never submit late without explicit action.
  const expired = await db
    .select({
      s: schema.submissions,
      due: schema.assignments.dueAt,
      title: schema.assignments.title,
    })
    .from(schema.submissions)
    .innerJoin(schema.assignments, eq(schema.submissions.assignmentId, schema.assignments.id))
    .where(
      and(
        ...forUser,
        inArray(schema.submissions.status, ['scheduled', 'held']),
        lte(schema.assignments.dueAt, now),
      ),
    )
    .limit(20);
  for (const r of expired) {
    if (
      await escalate(db, r.s, r.title, 'The deadline passed before it was submitted.', now, [
        'scheduled',
        'held',
      ])
    )
      done.expired++;
  }

  // 2. Hold notices due.
  const notices = await db
    .select({ s: schema.submissions, title: schema.assignments.title })
    .from(schema.submissions)
    .innerJoin(schema.assignments, eq(schema.submissions.assignmentId, schema.assignments.id))
    .where(
      and(
        ...forUser,
        eq(schema.submissions.status, 'scheduled'),
        isNull(schema.submissions.holdNoticeSentAt),
        lte(schema.submissions.holdUntil, now),
      ),
    )
    .orderBy(asc(schema.submissions.submitAt))
    .limit(20);
  for (const r of notices) {
    const [claimed] = await db
      .update(schema.submissions)
      .set({ holdNoticeSentAt: now })
      .where(
        and(
          eq(schema.submissions.id, r.s.id),
          isNull(schema.submissions.holdNoticeSentAt),
          eq(schema.submissions.status, 'scheduled'),
        ),
      )
      .returning();
    if (!claimed) continue;
    done.notices++;
    const tz = await tzOf(db, r.s.userId);
    await notify(db, r.s.userId, 'hold_notice', { submissionId: r.s.id, submitAt: r.s.submitAt });
    await recordHelmEvent(
      db,
      r.s.userId,
      'submission.hold_notice_sent',
      `Last chance: Helm submits "${r.s.fileName}" for ${r.title} at ${formatWhen(r.s.submitAt!, tz)}. Hold, submit now, or leave it.`,
      { submissionId: r.s.id },
      `helm:hold:${r.s.id}`,
    );
    // Wake the agent so it re-checks the file on its own disk before the real run.
    await send(db, deps, r.s.userId, `hold:${r.s.id}`, 'submission.hold_notice', {
      submissionId: r.s.id,
    }).catch(() => {});
  }

  // 3. Runs due: submit time reached, notice sent at least a hold window ago (unless "Submit
  //    now"), and any retry delay over.
  const runs = await db
    .select({
      s: schema.submissions,
      title: schema.assignments.title,
      due: schema.assignments.dueAt,
    })
    .from(schema.submissions)
    .innerJoin(schema.assignments, eq(schema.submissions.assignmentId, schema.assignments.id))
    .where(
      and(
        ...forUser,
        eq(schema.submissions.status, 'scheduled'),
        lte(schema.submissions.submitAt, now),
        isNotNull(schema.submissions.holdNoticeSentAt),
        or(isNull(schema.submissions.nextAttemptAt), lte(schema.submissions.nextAttemptAt, now)),
      ),
    )
    .orderBy(asc(schema.submissions.submitAt))
    .limit(20);
  for (const r of runs) {
    // The student always gets the full hold window after the notice, unless the deadline is
    // too close to wait (then the notice's buttons still work until the run starts).
    const windowOver = r.s.holdNoticeSentAt!.getTime() + t.holdMs <= now.getTime();
    const deadlineClose = r.due!.getTime() - now.getTime() <= t.escalateWithinMs;
    if (!windowOver && !deadlineClose) continue;
    const [claimed] = await db
      .update(schema.submissions)
      .set({
        status: 'submitting',
        attempts: sql`${schema.submissions.attempts} + 1`,
        runRequestedAt: now,
      })
      .where(and(eq(schema.submissions.id, r.s.id), eq(schema.submissions.status, 'scheduled')))
      .returning();
    if (!claimed) continue;
    done.runs++;
    try {
      await send(db, deps, r.s.userId, `run:${r.s.id}:${claimed.attempts}`, 'submission.run', {
        submissionId: r.s.id,
        attempt: claimed.attempts,
      });
    } catch (err) {
      await failAttempt(
        db,
        claimed,
        r.title,
        r.due!,
        `Could not reach your agent (${String(err).slice(0, 120)}).`,
        true,
        now,
      );
    }
  }

  // 4. Runs that never reported back count as a failed attempt.
  const stuck = await db
    .select({
      s: schema.submissions,
      title: schema.assignments.title,
      due: schema.assignments.dueAt,
    })
    .from(schema.submissions)
    .innerJoin(schema.assignments, eq(schema.submissions.assignmentId, schema.assignments.id))
    .where(
      and(
        ...forUser,
        eq(schema.submissions.status, 'submitting'),
        lte(schema.submissions.runRequestedAt, new Date(now.getTime() - t.runTimeoutMs)),
      ),
    )
    .limit(20);
  for (const r of stuck) {
    if (
      await failAttempt(
        db,
        r.s,
        r.title,
        r.due!,
        'Your agent did not report back in time.',
        true,
        now,
      )
    )
      done.timeouts++;
  }
  return done;
}

async function send(
  db: Db,
  deps: TickDeps,
  userId: string,
  requestId: string,
  type: 'submission.run' | 'submission.hold_notice',
  payload: { submissionId: string; attempt?: number },
) {
  const agentId = await deps.agentIdFor(userId);
  if (!agentId || !deps.transport) throw new Error('agent not reachable from this server');
  const message =
    type === 'submission.run'
      ? encodeAgentMessage({
          v: 1,
          type,
          requestId,
          studentId: userId,
          payload: { submissionId: payload.submissionId, attempt: payload.attempt! },
        })
      : encodeAgentMessage({
          v: 1,
          type,
          requestId,
          studentId: userId,
          payload: { submissionId: payload.submissionId },
        });
  await deps.transport.send(agentId, message);
  await recordSent(db, userId, agentId, requestId, type);
}

/** One attempt failed: retry later, or escalate loudly (PRD 12). Only acts on the live attempt. */
async function failAttempt(
  db: Db,
  s: Submission,
  title: string,
  due: Date,
  error: string,
  retryable: boolean,
  now: Date,
) {
  const next = afterFailure(s.attempts, due, now, timings(), retryable);
  if (next.action === 'escalate')
    return escalate(db, s, title, `${error} ${next.why}`, now, ['submitting']);
  const [row] = await db
    .update(schema.submissions)
    .set({ status: 'scheduled', nextAttemptAt: next.at, lastError: error, runRequestedAt: null })
    .where(
      and(
        eq(schema.submissions.id, s.id),
        eq(schema.submissions.status, 'submitting'),
        eq(schema.submissions.attempts, s.attempts),
      ),
    )
    .returning();
  if (!row) return false;
  await recordHelmEvent(
    db,
    s.userId,
    'submission.retrying',
    `Attempt ${s.attempts} for "${s.fileName}" failed: ${error} Trying again in ${Math.round((next.at.getTime() - now.getTime()) / 1000)}s.`,
    { submissionId: s.id, attempt: s.attempts },
    `helm:retry:${s.id}:${s.attempts}`,
  );
  return true;
}

/** Give up and alert on every channel we have, with a way to submit by hand. Never silent. */
async function escalate(
  db: Db,
  s: Submission,
  title: string,
  why: string,
  now: Date,
  from: Submission['status'][],
) {
  const [row] = await db
    .update(schema.submissions)
    .set({ status: 'failed', escalatedAt: now, lastError: why, runRequestedAt: null })
    .where(and(eq(schema.submissions.id, s.id), inArray(schema.submissions.status, from)))
    .returning();
  if (!row) return false;
  await notify(db, s.userId, 'submission_failed', { submissionId: s.id, why });
  await recordHelmEvent(
    db,
    s.userId,
    'alert.sent',
    `ALERT: "${s.fileName}" for ${title} was NOT submitted. ${why} Submit it yourself on the portal.`,
    { submissionId: s.id, critical: true },
    `helm:alert:${s.id}`,
  );
  return true;
}

/**
 * Agent → backend: how one attempt went. Stale or repeated reports are ignored, so a retried
 * delivery can't double-count. A receipt for a different file than the one approved is a failure.
 */
export async function recordResult(
  db: Db,
  userId: string,
  id: string,
  r: SubmissionResultRequest,
  now = new Date(),
) {
  const s = await mine(db, userId, id);
  if (r.outcome.ok && s.status === 'submitted') return { status: s.status, duplicate: true };
  if (s.status !== 'submitting' || s.attempts !== r.attempt)
    return { status: s.status, duplicate: true };
  const [a] = await db
    .select()
    .from(schema.assignments)
    .where(eq(schema.assignments.id, s.assignmentId));

  if (r.outcome.ok) {
    const receipt = r.outcome.receipt;
    if (receipt.fileSha256 !== (s.consentSha256 ?? s.fileSha256)) {
      await failAttempt(
        db,
        s,
        a!.title,
        a!.dueAt!,
        'The portal received a different file than the one you approved.',
        false,
        now,
      );
      return { status: 'failed', duplicate: false };
    }
    const [row] = await db
      .update(schema.submissions)
      .set({ status: 'submitted', driver: r.driver, lastError: null, runRequestedAt: null })
      .where(and(eq(schema.submissions.id, s.id), eq(schema.submissions.status, 'submitting')))
      .returning();
    if (!row) return { status: s.status, duplicate: true };
    await db
      .insert(schema.receipts)
      .values({
        submissionId: s.id,
        confirmationId: receipt.confirmationId,
        submittedAt: new Date(receipt.submittedAt),
        fileName: receipt.fileName,
        fileSha256: receipt.fileSha256,
        driver: r.driver,
      })
      .onConflictDoNothing();
    await db
      .update(schema.assignments)
      .set({ status: 'submitted', progressPct: 100 })
      .where(eq(schema.assignments.id, s.assignmentId));
    await notify(db, userId, 'submitted', {
      submissionId: s.id,
      confirmationId: receipt.confirmationId,
    });
    return { status: 'submitted', duplicate: false };
  }
  await failAttempt(db, s, a!.title, a!.dueAt!, r.outcome.error, r.outcome.retryable, now);
  const [after] = await db
    .select({ status: schema.submissions.status })
    .from(schema.submissions)
    .where(eq(schema.submissions.id, s.id));
  return { status: after!.status, duplicate: false };
}

/** What the agent needs for one run. Only for this student's own submission. */
export async function agentJob(db: Db, userId: string, id: string, portalUrl: string) {
  const s = await mine(db, userId, id);
  const [row] = await db
    .select({ a: schema.assignments, code: schema.courses.code })
    .from(schema.assignments)
    .leftJoin(schema.courses, eq(schema.assignments.courseId, schema.courses.id))
    .where(eq(schema.assignments.id, s.assignmentId));
  return {
    submissionId: s.id,
    status: s.status,
    attempt: s.attempts,
    idempotencyKey: s.idempotencyKey,
    fileName: s.fileName,
    fileSha256: s.fileSha256,
    agentFilePath: s.agentFilePath ?? '',
    consentSha256: s.consentSha256,
    assignment: {
      id: row!.a.id,
      title: row!.a.title,
      courseCode: row!.code ?? null,
      dueAt: row!.a.dueAt?.toISOString() ?? null,
      status: row!.a.status,
      allowedFileTypes: row!.a.allowedFileTypes,
    },
    portalUrl,
  };
}

/**
 * A deadline changed (M6). Shift or pause this assignment's pending submissions by the PRD 12
 * rules, and say so on the timeline.
 */
export async function onAssignmentDueChanged(
  db: Db,
  userId: string,
  assignmentId: string,
  newDue: Date,
  now = new Date(),
) {
  const t = timings();
  const rows = await db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.userId, userId),
        eq(schema.submissions.assignmentId, assignmentId),
        inArray(schema.submissions.status, ['ready', 'scheduled', 'held']),
      ),
    );
  const tz = await tzOf(db, userId);
  for (const s of rows) {
    const d = onDeadlineMoved(
      { submitAt: s.submitAt, fromDefault: s.submitAtFromDefault },
      newDue,
      t,
      now,
    );
    if (d.action === 'keep') {
      if (s.status === 'scheduled' || s.status === 'held')
        await recordHelmEvent(
          db,
          userId,
          'submission.adjusted',
          `Deadline moved; "${s.fileName}" still goes at the time you chose (${formatWhen(s.submitAt!, tz)}).`,
          { submissionId: s.id },
        );
      continue;
    }
    if (d.action === 'shift') {
      await db
        .update(schema.submissions)
        .set({
          submitAt: d.submitAt,
          holdUntil: new Date(d.submitAt.getTime() - t.holdMs),
          holdNoticeSentAt: null,
        })
        .where(eq(schema.submissions.id, s.id));
      await recordHelmEvent(
        db,
        userId,
        'submission.adjusted',
        `Deadline moved, so Helm moved "${s.fileName}" to ${formatWhen(d.submitAt, tz)} (still ${Math.round(t.leadMs / 3_600_000)}h before it).`,
        { submissionId: s.id },
      );
      continue;
    }
    if (s.status === 'scheduled' || s.status === 'ready') {
      await db
        .update(schema.submissions)
        .set({ status: s.status === 'scheduled' ? 'held' : 'ready', lastError: d.why })
        .where(eq(schema.submissions.id, s.id));
      await notify(db, userId, 'deadline_moved_earlier', { submissionId: s.id });
      await recordHelmEvent(
        db,
        userId,
        'alert.sent',
        `URGENT: the deadline moved earlier. ${d.why}`,
        { submissionId: s.id, critical: true },
      );
    }
  }
}

/** The student's submissions, newest first, with receipts and plain-language times. */
export async function listSubmissions(db: Db, user: User) {
  const rows = await db
    .select({
      s: schema.submissions,
      title: schema.assignments.title,
      due: schema.assignments.dueAt,
      code: schema.courses.code,
      r: schema.receipts,
    })
    .from(schema.submissions)
    .innerJoin(schema.assignments, eq(schema.submissions.assignmentId, schema.assignments.id))
    .leftJoin(schema.courses, eq(schema.assignments.courseId, schema.courses.id))
    .leftJoin(schema.receipts, eq(schema.receipts.submissionId, schema.submissions.id))
    .where(
      and(eq(schema.submissions.userId, user.id), sql`${schema.submissions.status} <> 'cancelled'`),
    )
    .orderBy(desc(schema.submissions.createdAt))
    .limit(30);
  const tz = user.timezone;
  const t = timings();
  return rows.map(({ s, title, due, code, r }) => ({
    id: s.id,
    status: s.status,
    assignmentId: s.assignmentId,
    title,
    courseCode: code,
    fileName: s.fileName,
    fileSize: s.fileSize,
    fileSha256: s.fileSha256,
    dueLabel: due ? formatWhen(due, tz) : null,
    submitAt: s.submitAt?.toISOString() ?? null,
    submitLabel: s.submitAt ? formatWhen(s.submitAt, tz) : null,
    submitAtFromDefault: s.submitAtFromDefault,
    holdNoticeSent: Boolean(s.holdNoticeSentAt),
    /** The hold window is open: show Hold / Submit now / Leave it. */
    holdOpen:
      s.status === 'scheduled' &&
      Boolean(s.holdNoticeSentAt) &&
      Boolean(s.submitAt && s.submitAt.getTime() + t.holdMs > Date.now() - 1),
    checks: CheckResult.array().catch([]).parse(s.checksJson),
    attempts: s.attempts,
    lastError: s.lastError,
    escalated: Boolean(s.escalatedAt),
    driver: s.driver,
    receipt: r
      ? {
          confirmationId: r.confirmationId,
          submittedLabel: formatWhen(r.submittedAt, tz),
          fileName: r.fileName,
          fileSha256: r.fileSha256,
          driver: r.driver,
        }
      : null,
  }));
}
export type SubmissionView = Awaited<ReturnType<typeof listSubmissions>>[number];

/** Scheduler dependencies for this server: the agent transport and each student's agent id. */
export function tickDepsFor(db: Db, transport: AgentTransport | null): TickDeps {
  return {
    transport,
    agentIdFor: async (userId) => {
      const [a] = await db
        .select({ id: schema.agents.maritimeAgentId })
        .from(schema.agents)
        .where(eq(schema.agents.userId, userId));
      return a?.id ?? null;
    },
  };
}
