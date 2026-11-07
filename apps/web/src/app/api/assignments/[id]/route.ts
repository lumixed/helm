import { ASSIGNMENT_STATUSES, ASSIGNMENT_TYPES, localToUtc } from '@helm/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { assignmentView } from '@/lib/assignments';
import { fail, json, readBody } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const Patch = z
  .object({
    title: z.string().trim().min(1).max(300),
    /** Local wall time in the student's timezone, or null to clear. */
    dueLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .nullable(),
    weightPct: z.number().min(0).max(100).nullable(),
    estMinutes: z.number().int().min(0).max(10_000).nullable(),
    progressPct: z.number().int().min(0).max(100),
    type: z.enum(ASSIGNMENT_TYPES),
    status: z.enum(ASSIGNMENT_STATUSES),
  })
  .partial();

/** Edit an assignment (review screen, Upcoming). Edits feed the next brief (PRD M4). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(404, 'Not found');
  const body = await readBody(req, Patch);
  if (body instanceof Response) return body;
  const { dueLocal, ...rest } = body;
  let dueAt: Date | null | undefined;
  if (dueLocal !== undefined) {
    try {
      dueAt = dueLocal === null ? null : localToUtc(dueLocal, user.timezone);
    } catch {
      return fail(400, 'That date does not exist.');
    }
  }
  const db = await getDb();
  const [row] = await db
    .update(schema.assignments)
    .set({ ...rest, ...(dueAt !== undefined ? { dueAt } : {}), source: undefined })
    .where(and(eq(schema.assignments.id, id), eq(schema.assignments.userId, user.id)))
    .returning();
  if (!row) return fail(404, 'Not found');
  const [course] = row.courseId
    ? await db.select().from(schema.courses).where(eq(schema.courses.id, row.courseId))
    : [];
  return json({ assignment: assignmentView(row, course ?? null, user.timezone) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(404, 'Not found');
  const db = await getDb();
  const gone = await db
    .delete(schema.assignments)
    .where(and(eq(schema.assignments.id, id), eq(schema.assignments.userId, user.id)))
    .returning({ id: schema.assignments.id });
  return gone.length ? json({ ok: true }) : fail(404, 'Not found');
}
