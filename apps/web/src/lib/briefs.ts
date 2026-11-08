import { and, desc, eq, sql } from 'drizzle-orm';
import { BriefContent, utcToLocal, type AgentState } from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { User } from '@/db/schema';
import { formatWhen } from './format';
import { describeChange } from './inbox';

/** What the agent needs for a brief: open, confirmed assignments and recent changes. */
export async function agentState(db: Db, user: User): Promise<AgentState> {
  const rows = await db
    .select({ a: schema.assignments, code: schema.courses.code })
    .from(schema.assignments)
    .leftJoin(schema.courses, eq(schema.assignments.courseId, schema.courses.id))
    .where(and(eq(schema.assignments.userId, user.id), eq(schema.assignments.confirmed, true)));
  const [last] = await db
    .select({ at: schema.briefs.generatedAt })
    .from(schema.briefs)
    .where(eq(schema.briefs.userId, user.id))
    .orderBy(desc(schema.briefs.generatedAt))
    .limit(1);
  const since = last?.at ?? new Date(Date.now() - 24 * 3_600_000);
  const changes = await db
    .select({ c: schema.assignmentChanges, title: schema.assignments.title })
    .from(schema.assignmentChanges)
    .innerJoin(schema.assignments, eq(schema.assignmentChanges.assignmentId, schema.assignments.id))
    .where(
      and(
        eq(schema.assignments.userId, user.id),
        eq(schema.assignmentChanges.applied, true),
        // A change the student confirmed later counts from when it was applied.
        // Pass the time as an ISO string: postgres.js (production) rejects a raw Date inside sql``,
        // while PGlite (tests) accepts it, so this only failed on Neon.
        sql`coalesce(${schema.assignmentChanges.decidedAt}, ${schema.assignmentChanges.createdAt}) > ${since.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(schema.assignmentChanges.createdAt))
    .limit(10);
  return {
    studentId: user.id,
    name: user.name,
    timezone: user.timezone,
    briefTimeLocal: user.briefTimeLocal,
    assignments: rows
      .filter((r) => r.a.status === 'todo' || r.a.status === 'in_progress')
      .map((r) => ({
        id: r.a.id,
        courseCode: r.code ?? null,
        title: r.a.title,
        dueAt: r.a.dueAt?.toISOString() ?? null,
        weightPct: r.a.weightPct,
        estMinutes: r.a.estMinutes,
        progressPct: r.a.progressPct,
        status: r.a.status,
      })),
    changes: changes.map((r) => {
      const d = describeChange(r.c, user.timezone);
      return {
        title: r.title,
        field: d.label,
        oldValue: d.from,
        newValue: d.to,
        source: r.c.source,
        at: (r.c.decidedAt ?? r.c.createdAt).toISOString(),
      };
    }),
  };
}

export async function saveBrief(db: Db, userId: string, requestId: string, brief: BriefContent) {
  const [row] = await db
    .insert(schema.briefs)
    .values({
      userId,
      requestId,
      forDate: brief.forDate,
      itemsJson: brief,
      summaryText: brief.summary,
      trigger: brief.trigger,
      deliveredAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.briefs.id });
  return row?.id ?? null;
}

/** The newest brief for the student's local today, if any. */
export async function todaysBrief(db: Db, user: User, now = new Date()) {
  const today = utcToLocal(now, user.timezone).slice(0, 10);
  const [row] = await db
    .select()
    .from(schema.briefs)
    .where(and(eq(schema.briefs.userId, user.id), eq(schema.briefs.forDate, today)))
    .orderBy(desc(schema.briefs.generatedAt))
    .limit(1);
  if (!row) return null;
  const parsed = BriefContent.safeParse(row.itemsJson);
  if (!parsed.success) return null;
  const label = <T extends { dueAt: string }>(i: T) => ({
    ...i,
    dueLabel: formatWhen(i.dueAt, user.timezone),
  });
  return {
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    generatedLabel: formatWhen(row.generatedAt, user.timezone),
    ...parsed.data,
    focus: parsed.data.focus.map(label),
    dueSoon: parsed.data.dueSoon.map(label),
  };
}
export type TodaysBrief = NonNullable<Awaited<ReturnType<typeof todaysBrief>>>;
