import { beforeEach, describe, expect, it } from 'vitest';
import type { ExtractedAssignment } from '@helm/shared';
import { connect, schema, type Db } from '@/db';
import {
  confirmAssignments,
  listAssignments,
  normalizeCourseCode,
  saveIntakeResult,
} from './assignments';

const row = (o: Partial<ExtractedAssignment> = {}): ExtractedAssignment => ({
  courseCode: 'DATA 210',
  courseName: 'Intro to Data Structures',
  title: 'Assignment 1',
  dueAt: '2026-09-19T06:59:00.000Z',
  dueTimeAssumed: true,
  weightPct: 8,
  type: 'assignment',
  allowedFileTypes: ['pdf'],
  confidence: 0.95,
  ...o,
});

let db: Db;
let u1: string;
let u2: string;

beforeEach(async () => {
  db = await connect(undefined);
  const users = await db
    .insert(schema.users)
    .values([{ email: 'a@x.edu', timezone: 'America/Los_Angeles' }, { email: 'b@x.edu' }])
    .returning();
  u1 = users[0]!.id;
  u2 = users[1]!.id;
});

describe('saveIntakeResult', () => {
  it('stores rows unconfirmed with local times and an assumption note', async () => {
    await saveIntakeResult(db, u1, 'i1', [
      row(),
      row({ title: 'Midterm', confidence: 0.5, dueTimeAssumed: false }),
    ]);
    const rows = await listAssignments(db, u1, 'America/Los_Angeles', { review: true });
    expect(rows.map((r) => r.title)).toEqual(['Assignment 1', 'Midterm']);
    expect(rows[0]).toMatchObject({
      courseCode: 'DATA 210',
      dueLocal: '2026-09-18T23:59',
      confirmed: false,
      assumption: 'No time given; assumed 11:59 pm.',
    });
    expect(rows[1]?.lowConfidence).toBe(true);
    expect(await listAssignments(db, u1, 'UTC', { review: false })).toHaveLength(0);
  });

  it('re-sending the same intake replaces its unconfirmed rows; courses are not duplicated', async () => {
    await saveIntakeResult(db, u1, 'i1', [row(), row({ title: 'A2' })]);
    await saveIntakeResult(db, u1, 'i1', [row({ courseCode: 'data210' })]);
    expect(await listAssignments(db, u1, 'UTC', { review: true })).toHaveLength(1);
    expect(await db.select().from(schema.courses)).toHaveLength(1);
    expect(normalizeCourseCode('data210')).toBe('DATA 210');
  });
});

describe('confirmAssignments', () => {
  it("keeps and drops only the student's own rows", async () => {
    await saveIntakeResult(db, u1, 'i1', [row(), row({ title: 'Drop me' })]);
    await saveIntakeResult(db, u2, 'i2', [row({ title: 'Not yours' })]);
    const mine = await listAssignments(db, u1, 'UTC', { review: true });
    const theirs = await listAssignments(db, u2, 'UTC', { review: true });
    const keep = mine.find((r) => r.title === 'Assignment 1')!.id;
    const drop = mine.find((r) => r.title === 'Drop me')!.id;
    expect(await confirmAssignments(db, u1, [keep, theirs[0]!.id], [drop])).toBe(1);
    expect((await listAssignments(db, u1, 'UTC', { review: false })).map((r) => r.title)).toEqual([
      'Assignment 1',
    ]);
    expect(await listAssignments(db, u1, 'UTC', { review: true })).toHaveLength(0);
    expect(await listAssignments(db, u2, 'UTC', { review: true })).toHaveLength(1);
  });
});
