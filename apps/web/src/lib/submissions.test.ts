import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import { confirmAssignments, listAssignments, saveIntakeResult } from './assignments';
import { checkPortalLogin, portalCredentials, portalSubmit, setPortalFailures } from './portal';
import {
  agentJob,
  cancelSubmission,
  createSubmission,
  holdSubmission,
  listSubmissions,
  onAssignmentDueChanged,
  recordResult,
  releaseSubmission,
  scheduleSubmission,
  submitNow,
  tick,
  type TickDeps,
} from './submissions';

process.env.AUTH_SECRET ??= 'test-secret-test-secret-123';
process.env.DEMO_MODE = 'false';

let db: Db;
let maya: User;
let other: User;
let a3: string;
let sent: { agent: string; msg: { type: string; payload: Record<string, unknown> } }[];
let files: Map<string, Uint8Array>;
const transport: AgentTransport = {
  kind: 'local',
  putFile: async (_a, p, b) => {
    files.set(p, b);
  },
  send: async (agent, m) => {
    sent.push({ agent, msg: JSON.parse(m) });
  },
};
const deps = (now: Date): TickDeps => ({
  transport,
  agentIdFor: async (u) => (u === maya.id ? 'agent-maya' : 'agent-other'),
  now,
});
const t0 = new Date('2026-11-07T18:00:00Z');
const due = new Date('2026-11-12T07:59:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const MIN = 60_000;
const pdf = new TextEncoder().encode('%PDF-1.4 my finished work');

beforeEach(async () => {
  sent = [];
  files = new Map();
  db = await connect(undefined);
  [maya, other] = (await db
    .insert(schema.users)
    .values([
      { email: 'maya@x.edu', name: 'Maya', timezone: 'America/Vancouver' },
      { email: 'o@x.edu', name: 'O', timezone: 'America/Vancouver' },
    ])
    .returning()) as [User, User];
  await saveIntakeResult(db, maya.id, 'i1', [
    {
      courseCode: 'DATA 210',
      title: 'Assignment 3',
      dueAt: due.toISOString(),
      dueTimeAssumed: false,
      weightPct: 10,
      type: 'assignment',
      allowedFileTypes: ['pdf'],
      confidence: 0.95,
    },
  ]);
  const [row] = await listAssignments(db, maya.id, maya.timezone);
  a3 = row!.id;
  await confirmAssignments(db, maya.id, [a3], []);
});

const upload = (o: { name?: string; submitAt?: Date | null; user?: User } = {}) =>
  createSubmission(
    db,
    o.user ?? maya,
    'agent-maya',
    transport,
    {
      assignmentId: a3,
      fileName: o.name ?? 'DATA210_A3_Maya.pdf',
      bytes: pdf,
      submitAt: o.submitAt,
    },
    t0,
  );

/** R: when attempt 1 starts. */
const R = 30 * MIN + 1000;
/**
 * Schedule for t0+10 min: that is inside the 30-min hold window, so the notice goes at once and
 * the run starts after the full window (R). Returns the submission.
 */
async function scheduledAndRunning() {
  const s = await upload({ submitAt: at(10 * MIN) });
  await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
  expect(await tick(db, deps(t0))).toMatchObject({ notices: 1 });
  expect(await tick(db, deps(at(10 * MIN + 1000)))).toMatchObject({ runs: 0 }); // window still open
  expect(await tick(db, deps(at(R)))).toMatchObject({ runs: 1 });
  return s;
}
const receipt = (sha: string) => ({
  confirmationId: 'DP-1',
  submittedAt: at(11 * MIN).toISOString(),
  fileName: 'DATA210_A3_Maya.pdf',
  fileSha256: sha,
});

describe('upload and checks', () => {
  it('puts the file on the agent, keeps only a hash, and defaults to 2h before the deadline', async () => {
    const s = await upload();
    expect(s.status).toBe('ready');
    expect([...files.keys()]).toEqual([`/data/homework/${s.id}/DATA210_A3_Maya.pdf`]);
    expect(s.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.submitAt?.toISOString()).toBe('2026-11-12T05:59:00.000Z');
    expect(s.submitAtFromDefault).toBe(true);
  });

  it('blocks a wrong file type and never sends it to the agent', async () => {
    const s = await upload({ name: 'a3.docx' });
    expect(s.status).toBe('checks_failed');
    expect(files.size).toBe(0);
    await expect(
      scheduleSubmission(db, maya.id, s.id, { ackWarnings: true }, t0),
    ).rejects.toThrow();
  });

  it('needs a tap to accept warnings (generic file name)', async () => {
    const s = await upload({ name: 'final_FINAL2.pdf' });
    await expect(scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0)).rejects.toThrow(
      /warnings/,
    );
    expect((await scheduleSubmission(db, maya.id, s.id, { ackWarnings: true }, t0)).status).toBe(
      'scheduled',
    );
  });

  it("can't touch another student's assignment", async () => {
    await expect(upload({ user: other })).rejects.toThrow(/not found/);
  });
});

describe('scheduler', () => {
  it('sends the hold notice, then submits after the window, then stores the receipt', async () => {
    const s = await upload({ submitAt: at(40 * MIN) });
    const sch = await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    expect(sch.consentSha256).toBe(s.fileSha256);

    expect(await tick(db, deps(at(5 * MIN)))).toMatchObject({ notices: 0, runs: 0 });
    expect(await tick(db, deps(at(10 * MIN)))).toMatchObject({ notices: 1, runs: 0 });
    expect(sent.map((x) => x.msg.type)).toEqual(['submission.hold_notice']);
    expect(await tick(db, deps(at(11 * MIN)))).toMatchObject({ notices: 0 }); // only once

    expect(await tick(db, deps(at(40 * MIN + 1000)))).toMatchObject({ runs: 1 });
    const run = sent.at(-1)!.msg;
    expect(run).toMatchObject({
      type: 'submission.run',
      payload: { submissionId: s.id, attempt: 1 },
    });
    expect(await tick(db, deps(at(40 * MIN + 2000)))).toMatchObject({ runs: 0 }); // no double run

    const job = await agentJob(db, maya.id, s.id, 'https://helm.test/mock-portal');
    expect(job).toMatchObject({ attempt: 1, idempotencyKey: s.id, status: 'submitting' });

    const ok = await recordResult(db, maya.id, s.id, {
      studentId: maya.id,
      requestId: 'r',
      attempt: 1,
      driver: 'http',
      outcome: { ok: true, receipt: receipt(s.fileSha256), duplicate: false },
    });
    expect(ok.status).toBe('submitted');
    const [view] = await listSubmissions(db, maya);
    expect(view).toMatchObject({ status: 'submitted', receipt: { confirmationId: 'DP-1' } });
    const [a] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, a3));
    expect(a!.status).toBe('submitted');
    // A repeated report changes nothing.
    expect(
      (
        await recordResult(db, maya.id, s.id, {
          studentId: maya.id,
          requestId: 'r',
          attempt: 1,
          driver: 'http',
          outcome: { ok: true, receipt: receipt(s.fileSha256), duplicate: false },
        })
      ).duplicate,
    ).toBe(true);
  });

  it('a held submission is never sent; release resumes it', async () => {
    const s = await upload({ submitAt: at(40 * MIN) });
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    await tick(db, deps(at(11 * MIN)));
    await holdSubmission(db, maya.id, s.id);
    await tick(db, deps(at(50 * MIN)));
    expect(sent.filter((x) => x.msg.type === 'submission.run')).toHaveLength(0);
    await releaseSubmission(db, maya.id, s.id, at(50 * MIN));
    await tick(db, deps(at(50 * MIN + 1000)));
    expect(sent.filter((x) => x.msg.type === 'submission.run')).toHaveLength(1);
  });

  it('goes without the full window when the deadline is too close to wait', async () => {
    const s = await upload({ submitAt: new Date(due.getTime() - 20 * MIN) });
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    await tick(db, deps(new Date(due.getTime() - 25 * MIN)));
    expect(await tick(db, deps(new Date(due.getTime() - 20 * MIN)))).toMatchObject({ runs: 1 });
  });

  it('Submit now skips the wait', async () => {
    const s = await upload();
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    await submitNow(db, maya.id, s.id, at(MIN));
    await tick(db, deps(at(MIN + 500)));
    expect(sent.map((x) => x.msg.type)).toContain('submission.run');
  });

  it('retries at +1 and +3 min, then escalates with an alert', async () => {
    const s = await scheduledAndRunning();
    const fail = (attempt: number, when: Date) =>
      recordResult(
        db,
        maya.id,
        s.id,
        {
          studentId: maya.id,
          requestId: 'r',
          attempt,
          driver: 'http',
          outcome: { ok: false, error: 'Portal returned 503.', retryable: true },
        },
        when,
      );
    expect((await fail(1, at(R + 1000))).status).toBe('scheduled');
    expect(await tick(db, deps(at(R + 30_000)))).toMatchObject({ runs: 0 });
    expect(await tick(db, deps(at(R + 62_000)))).toMatchObject({ runs: 1 });
    expect((await fail(2, at(R + 63_000))).status).toBe('scheduled');
    expect(await tick(db, deps(at(R + 63_000 + 3 * MIN + 1000)))).toMatchObject({ runs: 1 });
    expect((await fail(3, at(R + 63_000 + 3 * MIN + 2000))).status).toBe('failed');
    const alerts = await db
      .select()
      .from(schema.agentEvents)
      .where(eq(schema.agentEvents.type, 'alert.sent'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.reason).toMatch(/NOT submitted/);
  });

  it('counts a run that never reports back as a failed attempt', async () => {
    const s = await scheduledAndRunning();
    expect(await tick(db, deps(at(R + 4 * MIN)))).toMatchObject({ timeouts: 1 });
    const [row] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id));
    expect(row).toMatchObject({ status: 'scheduled', attempts: 1 });
  });

  it('rejects a receipt for a different file than the one approved', async () => {
    const s = await scheduledAndRunning();
    const r = await recordResult(db, maya.id, s.id, {
      studentId: maya.id,
      requestId: 'r',
      attempt: 1,
      driver: 'http',
      outcome: { ok: true, receipt: receipt('b'.repeat(64)), duplicate: false },
    });
    expect(r.status).toBe('failed');
  });

  it('never submits after the deadline: it fails loudly instead', async () => {
    const s = await upload({ submitAt: at(10 * MIN) });
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    await holdSubmission(db, maya.id, s.id);
    expect(await tick(db, deps(new Date(due.getTime() + 1000)))).toMatchObject({ expired: 1 });
    expect(sent.filter((x) => x.msg.type === 'submission.run')).toHaveLength(0);
  });

  it('only ticks the given student when asked', async () => {
    const s = await upload({ submitAt: at(10 * MIN) });
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    expect(await tick(db, deps(at(MIN)), other.id)).toMatchObject({ notices: 0 });
    expect(await tick(db, deps(at(MIN)), maya.id)).toMatchObject({ notices: 1 });
  });

  it('cancel stops it for good', async () => {
    const s = await upload({ submitAt: at(10 * MIN) });
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    await cancelSubmission(db, maya.id, s.id);
    await tick(db, deps(at(20 * MIN)));
    expect(sent).toHaveLength(0);
  });
});

describe('deadline moved after scheduling (M6 + M7)', () => {
  it('shifts a default time when the deadline moves later', async () => {
    const s = await upload();
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    await onAssignmentDueChanged(db, maya.id, a3, new Date('2026-11-14T01:00:00Z'), t0);
    const [row] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id));
    expect(row!.submitAt?.toISOString()).toBe('2026-11-13T23:00:00.000Z');
  });

  it('holds and alerts when the deadline moves before the submit time', async () => {
    const s = await upload({ submitAt: new Date('2026-11-11T20:00:00Z') });
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: false }, t0);
    await onAssignmentDueChanged(db, maya.id, a3, new Date('2026-11-10T00:00:00Z'), t0);
    const [row] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id));
    expect(row!.status).toBe('held');
  });
});

describe('demo portal', () => {
  it('derives a per-student login and checks it', () => {
    const c = portalCredentials(maya.id);
    expect(checkPortalLogin(c.username, c.password)).toBe(maya.id);
    expect(checkPortalLogin(other.id, c.password)).toBeNull();
  });

  it('rejects late and second submissions, returns the receipt for duplicates, and can fail on purpose', async () => {
    const base = {
      assignmentId: a3,
      fileName: 'a.pdf',
      fileSize: 3,
      fileSha256: 'c'.repeat(64),
      via: 'agent' as const,
    };
    await setPortalFailures(db, maya.id, 1, '503');
    expect((await portalSubmit(db, maya.id, { ...base, idempotencyKey: 'k1' }, t0)).kind).toBe(
      'unavailable',
    );
    const first = await portalSubmit(db, maya.id, { ...base, idempotencyKey: 'k1' }, t0);
    expect(first.kind).toBe('accepted');
    expect((await portalSubmit(db, maya.id, { ...base, idempotencyKey: 'k1' }, t0)).kind).toBe(
      'duplicate',
    );
    expect((await portalSubmit(db, maya.id, { ...base, idempotencyKey: 'k2' }, t0)).kind).toBe(
      'already_submitted',
    );
    expect((await portalSubmit(db, other.id, { ...base, idempotencyKey: 'k3' }, t0)).kind).toBe(
      'not_found',
    );
    await db.delete(schema.portalSubmissions);
    expect(
      (
        await portalSubmit(
          db,
          maya.id,
          { ...base, idempotencyKey: 'k4' },
          new Date(due.getTime() + 1),
        )
      ).kind,
    ).toBe('late');
  });
});
