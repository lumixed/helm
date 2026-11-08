import { and, eq, sql } from 'drizzle-orm';
import type { TaskCreateRequest } from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { User } from '@/db/schema';
import { normalizeCourseCode } from './assignments';
import { formatWhen } from './format';
import { recordHelmEvent } from './submissions';

/**
 * "I need to finish the lab report by Friday", said in chat (or on Telegram). The person said it
 * themselves, so it goes straight into the plan (confirmed), marked as added in chat. A retried
 * delivery (same request id) adds it once.
 */
export async function addTaskFromChat(db: Db, user: User, t: TaskCreateRequest) {
  const ref = `chat:${t.requestId}`.slice(0, 200);
  const [existing] = await db
    .select()
    .from(schema.assignments)
    .where(and(eq(schema.assignments.userId, user.id), eq(schema.assignments.sourceRef, ref)));
  let row = existing;
  if (!row) {
    let courseId: string | null = null;
    const code = t.area ? normalizeCourseCode(t.area) : '';
    if (code) {
      const [c] = await db
        .insert(schema.courses)
        .values({ userId: user.id, code, name: '' })
        .onConflictDoUpdate({
          target: [schema.courses.userId, schema.courses.code],
          set: { name: sql`${schema.courses.name}` },
        })
        .returning({ id: schema.courses.id });
      courseId = c!.id;
    }
    [row] = await db
      .insert(schema.assignments)
      .values({
        userId: user.id,
        courseId,
        title: t.title,
        dueAt: new Date(t.dueAt),
        type: t.type,
        source: 'manual',
        sourceRef: ref,
        confidence: 1,
        confirmed: true,
        assumption: 'Added from chat.',
      })
      .returning();
    await recordHelmEvent(
      db,
      user.id,
      'change.applied',
      `Added “${t.title}” to your plan from chat (${formatWhen(t.dueAt, user.timezone)})`,
      { assignmentId: row!.id, via: 'chat' },
      `helm:task:${ref}`,
    );
  }
  return { id: row!.id, title: row!.title, dueLabel: formatWhen(row!.dueAt!, user.timezone) };
}
