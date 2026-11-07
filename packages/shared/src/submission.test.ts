import { describe, expect, it } from 'vitest';
import {
  afterFailure,
  blocking,
  onDeadlineMoved,
  runSubmissionChecks,
  submissionTimings,
  warnings,
  type CheckInput,
} from './submission';

const now = new Date('2026-11-07T20:00:00Z');
const input = (o: Partial<CheckInput> = {}, a: Partial<CheckInput['assignment']> = {}) =>
  ({
    fileName: 'DATA210_A3_Maya.pdf',
    fileSize: 120_000,
    fileSha256: 'a'.repeat(64),
    now,
    ...o,
    assignment: {
      title: 'Assignment 3',
      dueAt: '2026-11-12T07:59:00Z',
      status: 'todo',
      allowedFileTypes: ['pdf'],
      ...a,
    },
  }) satisfies CheckInput;
const statusOf = (r: ReturnType<typeof runSubmissionChecks>, check: string) =>
  r.find((c) => c.check === check)?.status;

describe('runSubmissionChecks', () => {
  it('passes a good file', () => {
    const r = runSubmissionChecks(input());
    expect(blocking(r)).toBe(false);
    expect(warnings(r)).toEqual([]);
  });

  it('blocks a wrong type, an empty or huge file, and a passed deadline', () => {
    expect(statusOf(runSubmissionChecks(input({ fileName: 'a3.docx' })), 'file_type')).toBe('fail');
    expect(statusOf(runSubmissionChecks(input({ fileSize: 0 })), 'size')).toBe('fail');
    expect(statusOf(runSubmissionChecks(input({ fileSize: 9e6 })), 'size')).toBe('fail');
    expect(
      statusOf(runSubmissionChecks(input({}, { dueAt: '2026-11-01T00:00:00Z' })), 'deadline'),
    ).toBe('fail');
    expect(statusOf(runSubmissionChecks(input({}, { status: 'submitted' })), 'deadline')).toBe(
      'fail',
    );
  });

  it('warns on generic names', () => {
    for (const n of ['final_FINAL2.pdf', 'document (1).pdf', 'Untitled.pdf', 'hw.pdf'])
      expect(statusOf(runSubmissionChecks(input({ fileName: n })), 'file_name')).toBe('warn');
    expect(statusOf(runSubmissionChecks(input({ fileName: 'essay.pdf' })), 'file_name')).toBe(
      'pass',
    );
  });

  it('detects a file swapped after consent', () => {
    expect(
      statusOf(runSubmissionChecks(input({ consentSha256: 'b'.repeat(64) })), 'file_unchanged'),
    ).toBe('fail');
    expect(
      statusOf(runSubmissionChecks(input({ consentSha256: 'a'.repeat(64) })), 'file_unchanged'),
    ).toBe('pass');
  });

  it('accepts any type when the syllabus names none', () => {
    expect(
      statusOf(
        runSubmissionChecks(input({ fileName: 'x.zip' }, { allowedFileTypes: [] })),
        'file_type',
      ),
    ).toBe('pass');
  });
});

describe('afterFailure', () => {
  const t = submissionTimings(false);
  const due = new Date(now.getTime() + 2 * 3_600_000);
  it('retries at +1 min then +3 min, then escalates', () => {
    expect(afterFailure(1, due, now, t)).toEqual({
      action: 'retry',
      at: new Date(now.getTime() + 60_000),
    });
    expect(afterFailure(2, due, now, t)).toEqual({
      action: 'retry',
      at: new Date(now.getTime() + 180_000),
    });
    expect(afterFailure(3, due, now, t).action).toBe('escalate');
  });
  it('escalates right away near the deadline or when retrying cannot help', () => {
    expect(afterFailure(1, new Date(now.getTime() + 10 * 60_000), now, t).action).toBe('escalate');
    expect(afterFailure(1, due, now, t, false).action).toBe('escalate');
  });
});

describe('onDeadlineMoved', () => {
  const t = submissionTimings(false);
  const submitAt = new Date('2026-11-12T05:59:00Z'); // 2h before the old due
  it('shifts a default submit time when the deadline moves later', () => {
    const newDue = new Date('2026-11-14T01:00:00Z');
    expect(onDeadlineMoved({ submitAt, fromDefault: true }, newDue, t, now)).toEqual({
      action: 'shift',
      submitAt: new Date('2026-11-13T23:00:00Z'),
    });
  });
  it("keeps a time the student chose, if it's still before the new deadline", () => {
    expect(
      onDeadlineMoved({ submitAt, fromDefault: false }, new Date('2026-11-14T01:00:00Z'), t, now),
    ).toEqual({ action: 'keep' });
  });
  it('holds instead of submitting when the deadline moves before the submit time', () => {
    expect(
      onDeadlineMoved({ submitAt, fromDefault: false }, new Date('2026-11-11T00:00:00Z'), t, now)
        .action,
    ).toBe('hold');
  });
});
