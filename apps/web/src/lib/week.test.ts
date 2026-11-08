import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema } from '@/db';
import type { User } from '@/db/schema';
import { latestWeeklyReview, saveWeeklyReview, weekFacts, weeklyReviewMessage } from './week';

const NOW = new Date('2026-11-09T02:00:00Z'); // Sun Nov 8, 18:00 in Los Angeles

describe('weekly review', () => {
  it('picks done, slipped and next week from Helm’s own records, and counts agent wakes', async () => {
    const db = await connect(undefined);
    const [user] = (await db
      .insert(schema.users)
      .values({ email: 'w@x.edu', name: 'Maya', timezone: 'America/Los_Angeles' })
      .returning()) as [User];
    const [course] = await db
      .insert(schema.courses)
      .values({ userId: user.id, code: 'DATA 210', name: '' })
      .returning();
    const day = 86_400_000;
    const add = (title: string, dueOffsetDays: number, status: 'todo' | 'done', est?: number) =>
      db
        .insert(schema.assignments)
        .values({
          userId: user.id,
          courseId: course!.id,
          title,
          dueAt: new Date(NOW.getTime() + dueOffsetDays * day),
          status,
          confirmed: true,
          estMinutes: est ?? null,
          updatedAt: new Date(NOW.getTime() - 3 * day),
        })
        .returning();
    await add('Essay 1', -3, 'done');
    await add('Lab 3', -2, 'todo');
    await add('Assignment 4', 3, 'todo', 180);
    await add('Quiz 5', 5, 'todo');
    await add('Final project', 30, 'todo');
    await add('Old thing', -20, 'todo');
    await db.insert(schema.agentEvents).values([
      {
        userId: user.id,
        eventId: 'e1',
        type: 'agent.woke',
        reason: 'x',
        payloadJson: { source: 'scheduled' },
        occurredAt: new Date(NOW.getTime() - day),
      },
      {
        userId: user.id,
        eventId: 'e2',
        type: 'agent.woke',
        reason: 'x',
        payloadJson: { source: 'webhook' },
        occurredAt: new Date(NOW.getTime() - day),
      },
      {
        userId: user.id,
        eventId: 'e3',
        type: 'reminder.fired',
        reason: 'x',
        payloadJson: {},
        occurredAt: new Date(NOW.getTime() - day),
      },
    ]);

    const f = await weekFacts(db, user, NOW);
    expect(f.weekEnding).toBe('2026-11-08');
    expect(f.done.map((d) => d.title)).toEqual(['Essay 1']);
    expect(f.slipped.map((d) => d.title)).toEqual(['Lab 3']); // "Old thing" is older than a week
    expect(f.nextWeek.map((d) => [d.title, d.minutes, d.courseCode])).toEqual([
      ['Assignment 4', 180, 'DATA 210'],
      ['Quiz 5', 60, 'DATA 210'],
    ]);
    expect(f).toMatchObject({
      nextWeekMinutes: 240,
      agentWakes: 2,
      cronWakes: 1,
      remindersSent: 1,
    });

    // "Write it now" twice in a week replaces, never duplicates.
    await saveWeeklyReview(db, user, { requestId: 'a', summary: 'First.', writer: 'm' }, NOW);
    const r = await saveWeeklyReview(
      db,
      user,
      { requestId: 'b', summary: 'Second.', writer: 'm' },
      NOW,
    );
    const all = await db
      .select()
      .from(schema.weeklyReviews)
      .where(eq(schema.weeklyReviews.userId, user.id));
    expect(all).toHaveLength(1);
    expect((await latestWeeklyReview(db, user.id))?.summary).toBe('Second.');
    expect(weeklyReviewMessage(r)).toBe(
      '🗓 Your week: 1 done · 1 slipped · 2 due next week\n\nSecond.',
    );
  });
});
