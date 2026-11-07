import { and, eq, inArray, sql } from 'drizzle-orm';
import { LOW_CONFIDENCE, utcToLocal, type ExtractedAssignment } from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { Assignment, Course } from '@/db/schema';

/** What the app shows for an assignment. Times are given in the student's timezone too. */
export function assignmentView(
  a: Assignment,
  course: Pick<Course, 'code' | 'name'> | null,
  timezone: string,
) {
  return {
    id: a.id,
    courseCode: course?.code ?? null,
    courseName: course?.name || null,
    title: a.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    dueLocal: a.dueAt ? utcToLocal(a.dueAt, timezone) : null,
    weightPct: a.weightPct,
    estMinutes: a.estMinutes,
    progressPct: a.progressPct,
    type: a.type,
    status: a.status,
    allowedFileTypes: a.allowedFileTypes,
    confirmed: a.confirmed,
    confidence: a.confidence,
    lowConfidence: a.confidence != null && a.confidence < LOW_CONFIDENCE,
    assumption: a.assumption,
    evidence: a.evidence,
    notes: a.notes,
    source: a.source,
    sourceRef: a.sourceRef,
  };
}
export type AssignmentView = ReturnType<typeof assignmentView>;

export async function listAssignments(
  db: Db,
  userId: string,
  timezone: string,
  opts: { review?: boolean; intakeId?: string } = {},
) {
  const conds = [eq(schema.assignments.userId, userId)];
  if (opts.review !== undefined) conds.push(eq(schema.assignments.confirmed, !opts.review));
  if (opts.intakeId) conds.push(eq(schema.assignments.sourceRef, opts.intakeId));
  const rows = await db
    .select({ a: schema.assignments, c: { code: schema.courses.code, name: schema.courses.name } })
    .from(schema.assignments)
    .leftJoin(schema.courses, eq(schema.assignments.courseId, schema.courses.id))
    .where(and(...conds))
    .orderBy(sql`${schema.assignments.dueAt} asc nulls last`, schema.assignments.title);
  return rows.map((r) => assignmentView(r.a, r.c?.code ? r.c : null, timezone));
}

/**
 * Store one intake's extracted rows as unconfirmed (PRD J1: nothing is trusted until the student
 * confirms). Re-sending the same intake replaces its unconfirmed rows, so retries are safe.
 */
export async function saveIntakeResult(
  db: Db,
  userId: string,
  intakeId: string,
  rows: ExtractedAssignment[],
) {
  const courseIds = new Map<string, string>();
  for (const code of new Set(rows.map((r) => normalizeCourseCode(r.courseCode)).filter(Boolean))) {
    const name =
      rows.find((r) => normalizeCourseCode(r.courseCode) === code && r.courseName)?.courseName ??
      '';
    const [c] = await db
      .insert(schema.courses)
      .values({ userId, code, name })
      .onConflictDoUpdate({
        target: [schema.courses.userId, schema.courses.code],
        set: { name: sql`coalesce(nullif(${schema.courses.name}, ''), excluded.name)` },
      })
      .returning({ id: schema.courses.id });
    courseIds.set(code, c!.id);
  }
  await db
    .delete(schema.assignments)
    .where(
      and(
        eq(schema.assignments.userId, userId),
        eq(schema.assignments.sourceRef, intakeId),
        eq(schema.assignments.confirmed, false),
      ),
    );
  if (rows.length === 0) return 0;
  await db.insert(schema.assignments).values(
    rows.map((r) => ({
      userId,
      courseId: courseIds.get(normalizeCourseCode(r.courseCode)) ?? null,
      title: r.title,
      dueAt: r.dueAt ? new Date(r.dueAt) : null,
      weightPct: r.weightPct,
      type: r.type,
      allowedFileTypes: r.allowedFileTypes,
      source: 'syllabus' as const,
      sourceRef: intakeId,
      confidence: r.confidence,
      confirmed: false,
      notes: r.notes ?? null,
      assumption:
        [
          r.assumption,
          r.dueTimeAssumed && !r.assumption ? 'No time given; assumed 11:59 pm.' : null,
        ]
          .filter(Boolean)
          .join(' ') || null,
      evidence: r.evidence ?? null,
    })),
  );
  return rows.length;
}

/** Confirm the kept rows and delete the rejected ones. Only touches this student's rows. */
export async function confirmAssignments(
  db: Db,
  userId: string,
  keepIds: string[],
  dropIds: string[],
) {
  const mine = eq(schema.assignments.userId, userId);
  if (dropIds.length)
    await db.delete(schema.assignments).where(and(mine, inArray(schema.assignments.id, dropIds)));
  if (keepIds.length === 0) return 0;
  const done = await db
    .update(schema.assignments)
    .set({ confirmed: true })
    .where(and(mine, inArray(schema.assignments.id, keepIds)))
    .returning({ id: schema.assignments.id });
  return done.length;
}

export function normalizeCourseCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/^([A-Z]+)(\d)/, '$1 $2');
}
