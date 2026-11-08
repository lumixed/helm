import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MessageSource,
  SOURCE_LABEL,
  decideChange,
  encodeAgentMessage,
  type EmailChange,
  type InboxResultRequest,
  type InboxResultResponse,
} from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { Assignment, InboxMessage, User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import { saveIntakeResult } from './assignments';
import { formatWhen } from './format';
import { recordSent } from './maritime-webhooks';
import { onAssignmentDueChanged } from './submissions';

/** POST /api/inbox/ingest. The body goes to the agent; the backend keeps only a hash of it. */
export const IngestBody = z.object({
  /** email, or a message the person shared from WhatsApp, Instagram, SMS or elsewhere. */
  source: MessageSource.default('email'),
  from: z.string().trim().min(1).max(320),
  subject: z.string().trim().max(1000).default(''),
  body: z.string().trim().min(1).max(100_000),
  receivedAt: z.iso.datetime({ offset: true }).optional(),
});
export type IngestBody = z.infer<typeof IngestBody>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Prof. Lee <lee@uni.test>" -> "Prof. Lee". */
export function senderName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from);
  return (m?.[1] ?? from).trim().slice(0, 80) || 'unknown sender';
}

/**
 * Store the email's metadata and hand the text to the student's agent. The same email (same
 * sender, subject, time and text) is only processed once.
 */
export async function ingestEmail(
  db: Db,
  user: User,
  maritimeAgentId: string,
  transport: AgentTransport,
  input: IngestBody,
  now = new Date(),
): Promise<{ inboxMessageId: string; requestId: string; duplicate: boolean }> {
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now;
  const bodyHash = createHash('sha256')
    .update(
      JSON.stringify([
        input.source,
        input.from,
        input.subject,
        receivedAt.toISOString(),
        input.body,
      ]),
    )
    .digest('hex');
  const [created] = await db
    .insert(schema.inboxMessages)
    .values({
      userId: user.id,
      source: input.source,
      fromAddr: input.from,
      subject: input.subject,
      receivedAt,
      bodyHash,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    const [existing] = await db
      .select()
      .from(schema.inboxMessages)
      .where(
        and(eq(schema.inboxMessages.userId, user.id), eq(schema.inboxMessages.bodyHash, bodyHash)),
      );
    return {
      inboxMessageId: existing!.id,
      requestId: existing!.requestId ?? `inbox:${existing!.id}`,
      duplicate: true,
    };
  }
  const requestId = `inbox:${created.id}`;
  try {
    await transport.send(
      maritimeAgentId,
      encodeAgentMessage({
        v: 1,
        type: 'inbox.message',
        requestId,
        studentId: user.id,
        payload: {
          inboxMessageId: created.id,
          source: input.source,
          from: input.from,
          subject: input.subject,
          receivedAt: receivedAt.toISOString(),
          body: input.body,
        },
      }),
    );
  } catch (err) {
    await db
      .update(schema.inboxMessages)
      .set({ status: 'failed', requestId, decisionReason: 'Could not reach your agent.' })
      .where(eq(schema.inboxMessages.id, created.id));
    throw err;
  }
  await db
    .update(schema.inboxMessages)
    .set({ status: 'sent', requestId })
    .where(eq(schema.inboxMessages.id, created.id));
  await recordSent(db, user.id, maritimeAgentId, requestId, 'inbox.message');
  return { inboxMessageId: created.id, requestId, duplicate: false };
}

const FIELD_FOR: Partial<Record<EmailChange['kind'], string>> = {
  deadline_changed: 'due_at',
  cancelled: 'status',
  requirement_changed: 'requirements',
};

function proposedValue(c: EmailChange): string | null {
  if (c.kind === 'deadline_changed') return c.newDueAt;
  if (c.kind === 'cancelled') return 'cancelled';
  if (c.kind === 'requirement_changed') return c.requirementNote;
  return null;
}

function oldValue(c: EmailChange, a: Assignment | null): string | null {
  if (!a) return null;
  if (c.kind === 'deadline_changed') return a.dueAt?.toISOString() ?? null;
  if (c.kind === 'cancelled') return a.status;
  return null;
}

/**
 * Agent → backend: what one email means. The backend re-runs the decision rule itself (a
 * compromised agent can't force a change), then applies it, queues it for the student, or sends
 * a new deadline to review. Retried deliveries return the first answer.
 */
export async function saveInboxResult(
  db: Db,
  userId: string,
  req: InboxResultRequest,
  now = new Date(),
): Promise<InboxResultResponse | null> {
  if (!UUID.test(req.inboxMessageId)) return null;
  const [msg] = await db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(eq(schema.inboxMessages.id, req.inboxMessageId), eq(schema.inboxMessages.userId, userId)),
    );
  if (!msg) return null;
  if (msg.processedAt) return storedAnswer(db, msg);

  const c = req.change;
  let target: Assignment | null = null;
  if (c.assignmentId && UUID.test(c.assignmentId)) {
    const [a] = await db
      .select()
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.id, c.assignmentId),
          eq(schema.assignments.userId, userId),
          eq(schema.assignments.confirmed, true),
        ),
      );
    target = a ?? null;
  }
  const change: EmailChange = target ? c : { ...c, assignmentId: null, matchConfidence: 0 };
  const { decision, reason } = decideChange(change, target, now);

  // Claim the message first, so two concurrent deliveries can't both apply the change.
  const [claimed] = await db
    .update(schema.inboxMessages)
    .set({
      processedAt: now,
      status: 'processed',
      classification: change.kind,
      decision,
      decisionReason: reason,
      summary: change.summary,
      model: req.model,
      injectionSuspected: change.injectionSuspected,
      resultJson: change as unknown as Record<string, unknown>,
    })
    .where(and(eq(schema.inboxMessages.id, msg.id), isNull(schema.inboxMessages.processedAt)))
    .returning();
  if (!claimed) return storedAnswer(db, msg);

  const source = `${senderName(msg.fromAddr)}'s ${SOURCE_LABEL[MessageSource.catch('other').parse(msg.source)]}`;
  let changeId: string | null = null;
  const field = FIELD_FOR[change.kind];
  if ((decision === 'applied' || decision === 'needs_confirmation') && field) {
    const [row] = await db
      .insert(schema.assignmentChanges)
      .values({
        userId,
        assignmentId: target?.id ?? null,
        inboxMessageId: msg.id,
        kind: change.kind,
        field,
        oldValue: oldValue(change, target),
        newValue: proposedValue(change),
        source,
        evidence: change.evidence,
        confidence: Math.min(change.confidence, change.matchConfidence || change.confidence),
        applied: false,
        status: 'pending',
        reason,
      })
      .returning({ id: schema.assignmentChanges.id });
    changeId = row!.id;
    if (decision === 'applied' && target) await applyChange(db, userId, changeId, null, reason);
  } else if (decision === 'review' && change.title) {
    await saveIntakeResult(
      db,
      userId,
      `inbox:${msg.id}`,
      [
        {
          courseCode: change.courseCode ?? '',
          title: change.title,
          dueAt: change.newDueAt,
          dueTimeAssumed: change.dueTimeAssumed,
          assumption: `From ${source} on ${msg.receivedAt.toISOString().slice(0, 10)}.`,
          weightPct: change.weightPct,
          type: change.type ?? 'assignment',
          allowedFileTypes: [],
          confidence: change.confidence,
          evidence: change.evidence ?? undefined,
        },
      ],
      'email',
    );
  }
  return {
    decision,
    reason,
    changeId,
    assignmentTitle: target?.title ?? null,
    duplicate: false,
  };
}

async function storedAnswer(db: Db, msg: InboxMessage): Promise<InboxResultResponse> {
  const [c] = await db
    .select({ id: schema.assignmentChanges.id, title: schema.assignments.title })
    .from(schema.assignmentChanges)
    .leftJoin(schema.assignments, eq(schema.assignmentChanges.assignmentId, schema.assignments.id))
    .where(eq(schema.assignmentChanges.inboxMessageId, msg.id))
    .limit(1);
  return {
    decision: (msg.decision ?? 'ignored') as InboxResultResponse['decision'],
    reason: msg.decisionReason ?? '',
    changeId: c?.id ?? null,
    assignmentTitle: c?.title ?? null,
    duplicate: true,
  };
}

/**
 * Apply a pending change (automatically, or because the student confirmed it). Only pending
 * rows of this student move, so a double tap can't apply twice. `assignmentId` is the student's
 * pick when the email couldn't be matched.
 */
export async function applyChange(
  db: Db,
  userId: string,
  changeId: string,
  assignmentId: string | null,
  reason = 'You confirmed it.',
): Promise<{ ok: true; assignmentId: string } | { ok: false; error: string }> {
  if (!UUID.test(changeId)) return { ok: false, error: 'Change not found.' };
  const [c] = await db
    .select()
    .from(schema.assignmentChanges)
    .where(
      and(eq(schema.assignmentChanges.id, changeId), eq(schema.assignmentChanges.userId, userId)),
    );
  if (!c || c.status !== 'pending') return { ok: false, error: 'This change was already handled.' };
  const targetId = c.assignmentId ?? assignmentId;
  if (!targetId || !UUID.test(targetId)) return { ok: false, error: 'Pick the assignment first.' };
  const [a] = await db
    .select()
    .from(schema.assignments)
    .where(and(eq(schema.assignments.id, targetId), eq(schema.assignments.userId, userId)));
  if (!a) return { ok: false, error: 'Assignment not found.' };

  const [claimed] = await db
    .update(schema.assignmentChanges)
    .set({
      status: 'applied',
      applied: true,
      assignmentId: a.id,
      decidedAt: new Date(),
      reason,
      oldValue:
        c.field === 'due_at'
          ? (a.dueAt?.toISOString() ?? null)
          : c.field === 'status'
            ? a.status
            : c.oldValue,
    })
    .where(
      and(eq(schema.assignmentChanges.id, c.id), eq(schema.assignmentChanges.status, 'pending')),
    )
    .returning();
  if (!claimed) return { ok: false, error: 'This change was already handled.' };

  const bump = { version: sql`${schema.assignments.version} + 1` };
  if (c.field === 'due_at' && c.newValue) {
    await db
      .update(schema.assignments)
      .set({ dueAt: new Date(c.newValue), ...bump })
      .where(eq(schema.assignments.id, a.id));
  } else if (c.field === 'status') {
    await db
      .update(schema.assignments)
      .set({ status: 'cancelled', ...bump })
      .where(eq(schema.assignments.id, a.id));
  } else if (c.field === 'requirements' && c.newValue) {
    const note = `Update from ${c.source}: ${c.newValue}`;
    await db
      .update(schema.assignments)
      .set({ notes: a.notes ? `${a.notes}\n${note}` : note, ...bump })
      .where(eq(schema.assignments.id, a.id));
  }
  // Scheduled submissions follow the new deadline by the PRD 12 rules (shift, keep or hold).
  if (c.field === 'due_at' && c.newValue)
    await onAssignmentDueChanged(db, userId, a.id, new Date(c.newValue));
  return { ok: true, assignmentId: a.id };
}

export async function dismissChange(db: Db, userId: string, changeId: string) {
  if (!UUID.test(changeId)) return false;
  const done = await db
    .update(schema.assignmentChanges)
    .set({ status: 'dismissed', decidedAt: new Date(), reason: 'You dismissed it.' })
    .where(
      and(
        eq(schema.assignmentChanges.id, changeId),
        eq(schema.assignmentChanges.userId, userId),
        eq(schema.assignmentChanges.status, 'pending'),
      ),
    )
    .returning({ id: schema.assignmentChanges.id });
  return done.length > 0;
}

/** How a change reads to the student: "due date: Thu, Nov 12, 11:59 p.m. → Fri, Nov 13, 5:00 p.m." */
export function describeChange(
  c: { field: string; oldValue: string | null; newValue: string | null },
  tz: string,
) {
  if (c.field === 'due_at')
    return {
      label: 'due date',
      from: c.oldValue ? formatWhen(c.oldValue, tz) : null,
      to: c.newValue ? formatWhen(c.newValue, tz) : null,
    };
  if (c.field === 'status') return { label: 'status', from: c.oldValue, to: 'cancelled' };
  return { label: 'requirements', from: null, to: c.newValue };
}

/** Pending changes (waiting for the student) and recent applied ones, with provenance. */
export async function listChanges(db: Db, user: User, now = new Date()) {
  const rows = await db
    .select({
      c: schema.assignmentChanges,
      title: schema.assignments.title,
      courseCode: schema.courses.code,
      from: schema.inboxMessages.fromAddr,
      channel: schema.inboxMessages.source,
      subject: schema.inboxMessages.subject,
      receivedAt: schema.inboxMessages.receivedAt,
    })
    .from(schema.assignmentChanges)
    .leftJoin(schema.assignments, eq(schema.assignmentChanges.assignmentId, schema.assignments.id))
    .leftJoin(schema.courses, eq(schema.assignments.courseId, schema.courses.id))
    .leftJoin(
      schema.inboxMessages,
      eq(schema.assignmentChanges.inboxMessageId, schema.inboxMessages.id),
    )
    .where(
      and(
        eq(schema.assignmentChanges.userId, user.id),
        inArray(schema.assignmentChanges.status, ['pending', 'applied']),
        gt(schema.assignmentChanges.createdAt, new Date(now.getTime() - 3 * 86_400_000)),
      ),
    )
    .orderBy(desc(schema.assignmentChanges.createdAt))
    .limit(20);
  const view = rows.map((r) => ({
    id: r.c.id,
    status: r.c.status as 'pending' | 'applied',
    kind: r.c.kind,
    assignmentId: r.c.assignmentId,
    title: r.title,
    courseCode: r.courseCode,
    ...describeChange(r.c, user.timezone),
    reason: r.c.reason,
    evidence: r.c.evidence,
    sender: r.from ? senderName(r.from) : r.c.source,
    channel: r.channel ? SOURCE_LABEL[MessageSource.catch('other').parse(r.channel)] : null,
    subject: r.subject,
    receivedLabel: r.receivedAt ? formatWhen(r.receivedAt, user.timezone) : null,
    decidedLabel: r.c.decidedAt ? formatWhen(r.c.decidedAt, user.timezone) : null,
  }));
  return {
    pending: view.filter((v) => v.status === 'pending'),
    applied: view.filter((v) => v.status === 'applied'),
  };
}
export type ChangeView = Awaited<ReturnType<typeof listChanges>>['pending'][number];

/** For the demo panel's progress line: where one email is. Never returns the body. */
export async function inboxStatus(db: Db, userId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [m] = await db
    .select()
    .from(schema.inboxMessages)
    .where(and(eq(schema.inboxMessages.id, id), eq(schema.inboxMessages.userId, userId)));
  if (!m) return null;
  return {
    id: m.id,
    source: m.source,
    status: m.status,
    decision: m.decision,
    reason: m.decisionReason,
    summary: m.summary,
    injectionSuspected: m.injectionSuspected,
  };
}
