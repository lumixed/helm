import { z } from 'zod';

/**
 * Submission pipeline (PRD M7, section 12). Pure rules shared by the backend (upload, scheduler)
 * and the agent (re-checks at submit time), so both sides apply exactly the same checks.
 */
export const SUBMISSION_STATUSES = [
  'draft',
  'checks_failed',
  'ready',
  'scheduled',
  'held',
  'submitting',
  'submitted',
  'failed',
  'cancelled',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export interface SubmissionTimings {
  /** Default: submit this long before the due time. */
  leadMs: number;
  /** Last-chance hold notice this long before submitting. */
  holdMs: number;
  /** After a failed attempt: wait this long before attempt n+1 (index = attempts so far - 1). */
  retryDelaysMs: number[];
  /** Too close to the deadline to keep retrying: escalate instead. */
  escalateWithinMs: number;
  /** A run with no result after this long counts as a failed attempt. */
  runTimeoutMs: number;
}

const MIN = 60_000;
export function submissionTimings(demo: boolean): SubmissionTimings {
  return demo
    ? {
        leadMs: 2 * 60 * MIN,
        holdMs: 30_000,
        retryDelaysMs: [20_000, 40_000],
        escalateWithinMs: 2 * MIN,
        runTimeoutMs: 90_000,
      }
    : {
        leadMs: 2 * 60 * MIN,
        holdMs: 30 * MIN,
        retryDelaysMs: [1 * MIN, 3 * MIN],
        escalateWithinMs: 30 * MIN,
        runTimeoutMs: 3 * MIN,
      };
}

/** Attempts at t, t+1 min, t+3 min (PRD 12). */
export const MAX_ATTEMPTS = 3;

/** Under Vercel's 4.5 MB request limit, which every upload passes through twice. */
export const MAX_SUBMISSION_BYTES = 4 * 1024 * 1024;

export const CheckStatus = z.enum(['pass', 'warn', 'fail']);
export const CheckResult = z.object({
  check: z.string(),
  status: CheckStatus,
  message: z.string(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export interface CheckInput {
  fileName: string;
  fileSize: number;
  fileSha256: string;
  assignment: {
    title: string;
    dueAt: string | Date | null;
    status: string;
    allowedFileTypes: string[];
  };
  /** Hash recorded when the student tapped Schedule. Absent before consent. */
  consentSha256?: string | null;
  /** Portal already holds a submission for this assignment (from a previous upload). */
  alreadySubmitted?: boolean;
  now: Date;
}

const GENERIC_NAME =
  /^(final|draft|untitled|document|doc|assignment|homework|hw|new|copy|scan|file)?[\s_-]*(\(?\d+\)?|final|v\d+|copy)*[\s_-]*(final|copy)?\d*$/i;

/**
 * Pre-submit checks (PRD 12), in plain words. `fail` blocks scheduling and submitting; `warn`
 * needs one acknowledgement tap. The LLM title sanity check is not here (advisory, optional).
 */
export function runSubmissionChecks(i: CheckInput): CheckResult[] {
  const out: CheckResult[] = [];
  const ext = i.fileName.includes('.') ? i.fileName.split('.').pop()!.toLowerCase() : '';
  const allowed = i.assignment.allowedFileTypes.map((t) => t.toLowerCase());
  if (allowed.length === 0)
    out.push({
      check: 'file_type',
      status: ext ? 'pass' : 'warn',
      message: ext
        ? `No file type is required; .${ext} it is.`
        : 'This file has no extension. Check the portal will accept it.',
    });
  else
    out.push(
      allowed.includes(ext)
        ? { check: 'file_type', status: 'pass', message: `.${ext} is allowed.` }
        : {
            check: 'file_type',
            status: 'fail',
            message: `This one takes ${allowed.map((a) => `.${a}`).join(', ')}, not ${ext ? `.${ext}` : 'a file without an extension'}.`,
          },
    );

  if (i.fileSize === 0) out.push({ check: 'size', status: 'fail', message: 'The file is empty.' });
  else if (i.fileSize > MAX_SUBMISSION_BYTES)
    out.push({
      check: 'size',
      status: 'fail',
      message: `The file is ${(i.fileSize / 1048576).toFixed(1)} MB; the limit is ${MAX_SUBMISSION_BYTES / 1048576} MB.`,
    });
  else out.push({ check: 'size', status: 'pass', message: 'Size is fine.' });

  const stem = i.fileName.replace(/\.[^.]+$/, '').trim();
  out.push(
    GENERIC_NAME.test(stem)
      ? {
          check: 'file_name',
          status: 'warn',
          message: `"${i.fileName}" is a generic name. Make sure it's the right file.`,
        }
      : { check: 'file_name', status: 'pass', message: 'File name looks specific.' },
  );

  const open = i.assignment.status === 'todo' || i.assignment.status === 'in_progress';
  const due = i.assignment.dueAt ? new Date(i.assignment.dueAt) : null;
  if (!open)
    out.push({
      check: 'deadline',
      status: 'fail',
      message: `This item is marked ${i.assignment.status.replace('_', ' ')}.`,
    });
  else if (!due)
    out.push({
      check: 'deadline',
      status: 'fail',
      message: 'This item has no due date. Add one first.',
    });
  else if (due.getTime() <= i.now.getTime())
    out.push({ check: 'deadline', status: 'fail', message: 'The deadline has passed.' });
  else out.push({ check: 'deadline', status: 'pass', message: 'The deadline has not passed.' });

  if (i.consentSha256)
    out.push(
      i.consentSha256 === i.fileSha256
        ? { check: 'file_unchanged', status: 'pass', message: 'Same file you approved.' }
        : {
            check: 'file_unchanged',
            status: 'fail',
            message: 'The file changed after you approved it. Upload and approve it again.',
          },
    );

  if (i.alreadySubmitted)
    out.push({
      check: 'portal',
      status: 'fail',
      message: 'The portal already has a submission for this one.',
    });
  return out;
}

export const blocking = (checks: CheckResult[]) => checks.some((c) => c.status === 'fail');
export const warnings = (checks: CheckResult[]) => checks.filter((c) => c.status === 'warn');

/** After a failed attempt: try again later, or escalate (PRD 12, "Retry and escalation"). */
export function afterFailure(
  attempts: number,
  dueAt: Date,
  now: Date,
  t: SubmissionTimings,
  retryable = true,
): { action: 'retry'; at: Date } | { action: 'escalate'; why: string } {
  if (!retryable) return { action: 'escalate', why: 'The portal refused the file.' };
  if (attempts >= MAX_ATTEMPTS) return { action: 'escalate', why: `${attempts} attempts failed.` };
  if (dueAt.getTime() - now.getTime() <= t.escalateWithinMs)
    return { action: 'escalate', why: 'The deadline is too close to keep retrying.' };
  const delay = t.retryDelaysMs[attempts - 1] ?? t.retryDelaysMs.at(-1)!;
  return { action: 'retry', at: new Date(now.getTime() + delay) };
}

/**
 * A deadline moved after scheduling (PRD 12). Later: keep a time the student chose; shift a
 * default one. Earlier: keep it if it's still before the new deadline, otherwise hold and alert;
 * never auto-submit at a time the student didn't choose for the new deadline.
 */
export function onDeadlineMoved(
  s: { submitAt: Date | null; fromDefault: boolean },
  newDue: Date,
  t: SubmissionTimings,
  now: Date,
): { action: 'keep' } | { action: 'shift'; submitAt: Date } | { action: 'hold'; why: string } {
  if (!s.submitAt) return { action: 'keep' };
  if (s.submitAt.getTime() < newDue.getTime()) {
    if (!s.fromDefault) return { action: 'keep' };
    const shifted = new Date(Math.max(newDue.getTime() - t.leadMs, now.getTime()));
    return shifted.getTime() === s.submitAt.getTime()
      ? { action: 'keep' }
      : { action: 'shift', submitAt: shifted };
  }
  return {
    action: 'hold',
    why: 'The deadline moved earlier than your submit time. Helm paused it; tap Submit now or pick a new time.',
  };
}

/** GET /api/agent/submissions/:id — what the agent needs to submit. No other student's data. */
export const AgentSubmissionJob = z.object({
  submissionId: z.string(),
  status: z.enum(SUBMISSION_STATUSES),
  attempt: z.number().int(),
  idempotencyKey: z.string(),
  fileName: z.string(),
  fileSha256: z.string(),
  agentFilePath: z.string(),
  consentSha256: z.string().nullable(),
  assignment: z.object({
    id: z.string(),
    title: z.string(),
    courseCode: z.string().nullable(),
    dueAt: z.string().nullable(),
    status: z.string(),
    allowedFileTypes: z.array(z.string()),
  }),
  /** Base URL of the (mock) portal the agent submits to. */
  portalUrl: z.url(),
});
export type AgentSubmissionJob = z.infer<typeof AgentSubmissionJob>;

export const PortalReceipt = z.object({
  confirmationId: z.string().min(1).max(100),
  submittedAt: z.iso.datetime({ offset: true }),
  fileName: z.string().max(300),
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PortalReceipt = z.infer<typeof PortalReceipt>;

/** Agent → backend: the outcome of one attempt. */
export const SubmissionResultRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  attempt: z.number().int().min(1),
  /** Which driver ran (PRD v2 section 4): the HTTP form post, or a real browser on a desktop. */
  driver: z.enum(['http', 'desktop']),
  outcome: z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      receipt: PortalReceipt,
      duplicate: z.boolean().default(false),
    }),
    z.object({
      ok: z.literal(false),
      error: z.string().max(500),
      /** False when retrying can't help (wrong type, late, checks failed). */
      retryable: z.boolean(),
      checks: z.array(CheckResult).max(20).optional(),
    }),
  ]),
});
export type SubmissionResultRequest = z.infer<typeof SubmissionResultRequest>;
