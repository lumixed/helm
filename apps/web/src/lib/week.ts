import { utcToLocal, type WeekFacts } from '@helm/shared';
import { and, desc, eq, gte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@/db';
import type { User, WeeklyReview } from '@/db/schema';

const DAY = 86_400_000;
const OPEN = new Set(['todo', 'in_progress']);
const FINISHED = new Set(['done', 'submitted']);

/**
 * The week's facts, picked by code from Helm's own records: what got finished, what slipped,
 * what's due next week, and what the agent did on Maritime. The agent only words the opener.
 */
export async function weekFacts(db: Db, user: User, now = new Date()): Promise<WeekFacts> {
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const weekAhead = new Date(now.getTime() + 7 * DAY);
  const rows = await db
    .select({ a: schema.assignments, code: schema.courses.code })
    .from(schema.assignments)
    .leftJoin(schema.courses, eq(schema.assignments.courseId, schema.courses.id))
    .where(and(eq(schema.assignments.userId, user.id), eq(schema.assignments.confirmed, true)));
  const item = (a: (typeof rows)[number]['a'], code: string | null, at: Date) => ({
    title: a.title,
    courseCode: code || null,
    at: at.toISOString(),
  });

  const done = rows
    .filter(({ a }) => FINISHED.has(a.status) && a.updatedAt >= weekAgo && a.updatedAt <= now)
    .sort((x, y) => x.a.updatedAt.getTime() - y.a.updatedAt.getTime())
    .map(({ a, code }) => item(a, code, a.updatedAt));
  const slipped = rows
    .filter(({ a }) => OPEN.has(a.status) && a.dueAt && a.dueAt >= weekAgo && a.dueAt < now)
    .sort((x, y) => x.a.dueAt!.getTime() - y.a.dueAt!.getTime())
    .map(({ a, code }) => item(a, code, a.dueAt!));
  const next = rows
    .filter(({ a }) => OPEN.has(a.status) && a.dueAt && a.dueAt >= now && a.dueAt < weekAhead)
    .sort((x, y) => x.a.dueAt!.getTime() - y.a.dueAt!.getTime())
    .map(({ a, code }) => ({
      ...item(a, code, a.dueAt!),
      // What's left of the estimate (an hour when there is none).
      minutes: Math.round(((a.estMinutes ?? 60) * (100 - a.progressPct)) / 100),
    }));

  const events = await db
    .select({ type: schema.agentEvents.type, payload: schema.agentEvents.payloadJson })
    .from(schema.agentEvents)
    .where(
      and(eq(schema.agentEvents.userId, user.id), gte(schema.agentEvents.occurredAt, weekAgo)),
    );
  const changes = await db
    .select({ id: schema.assignmentChanges.id })
    .from(schema.assignmentChanges)
    .where(
      and(
        eq(schema.assignmentChanges.userId, user.id),
        gte(schema.assignmentChanges.createdAt, weekAgo),
      ),
    );
  const wakes = events.filter((e) => e.type === 'agent.woke');

  return {
    weekEnding: utcToLocal(now, user.timezone).slice(0, 10),
    done: done.slice(-50),
    slipped: slipped.slice(0, 50),
    nextWeek: next.slice(0, 50),
    nextWeekMinutes: next.reduce((m, n) => m + n.minutes, 0),
    changesCaught: changes.length,
    remindersSent: events.filter((e) => e.type === 'reminder.fired').length,
    agentWakes: wakes.length,
    cronWakes: wakes.filter((e) => e.payload.source === 'scheduled').length,
  };
}

/** Store (or replace, for "Write it now" twice) this week's review. */
export async function saveWeeklyReview(
  db: Db,
  user: User,
  review: { requestId: string; summary: string; writer: string },
  now = new Date(),
): Promise<WeeklyReview> {
  const facts = await weekFacts(db, user, now);
  const [row] = await db
    .insert(schema.weeklyReviews)
    .values({
      userId: user.id,
      weekEnding: facts.weekEnding,
      summary: review.summary,
      writer: review.writer,
      factsJson: facts,
      requestId: review.requestId,
    })
    .onConflictDoUpdate({
      target: [schema.weeklyReviews.userId, schema.weeklyReviews.weekEnding],
      set: {
        summary: review.summary,
        writer: review.writer,
        factsJson: facts,
        requestId: review.requestId,
        createdAt: now,
      },
    })
    .returning();
  return row!;
}

export async function latestWeeklyReview(db: Db, userId: string): Promise<WeeklyReview | null> {
  const [row] = await db
    .select()
    .from(schema.weeklyReviews)
    .where(eq(schema.weeklyReviews.userId, userId))
    .orderBy(desc(schema.weeklyReviews.createdAt))
    .limit(1);
  return row ?? null;
}

/** The phone message: short, with the counts and a link. */
export function weeklyReviewMessage(r: WeeklyReview): string {
  const f = r.factsJson;
  return `🗓 Your week: ${f.done.length} done · ${f.slipped.length} slipped · ${f.nextWeek.length} due next week\n\n${r.summary}`;
}

export const manualReviewRequestId = () => `review:manual:${randomUUID()}`;
