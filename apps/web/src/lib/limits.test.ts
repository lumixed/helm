import { describe, expect, it } from 'vitest';
import { connect, schema } from '@/db';
import { llmPausedThisMonth } from './limits';

describe('llmPausedThisMonth', () => {
  it('is true only for an llm_limit_reached event this month, for this person', async () => {
    const db = await connect(undefined);
    const [a, b] = await db
      .insert(schema.users)
      .values([{ email: 'a@x.edu' }, { email: 'b@x.edu' }])
      .returning();
    expect(await llmPausedThisMonth(db, a!.id)).toBe(false);

    const lastMonth = new Date();
    lastMonth.setUTCDate(0); // last day of the previous month
    await db.insert(schema.maritimeEvents).values([
      { userId: a!.id, kind: 'agent.llm_limit_reached', occurredAt: lastMonth, deliveryId: 'd1' },
      { userId: a!.id, kind: 'agent.sleeping', occurredAt: new Date(), deliveryId: 'd2' },
    ]);
    expect(await llmPausedThisMonth(db, a!.id)).toBe(false);

    await db.insert(schema.maritimeEvents).values({
      userId: a!.id,
      kind: 'agent.llm_limit_reached',
      occurredAt: new Date(),
      deliveryId: 'd3',
    });
    expect(await llmPausedThisMonth(db, a!.id)).toBe(true);
    expect(await llmPausedThisMonth(db, b!.id)).toBe(false);
  });
});
