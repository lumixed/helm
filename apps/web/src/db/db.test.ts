import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema } from './index';

describe('database schema', () => {
  it('migrates and enforces key constraints', async () => {
    const db = await connect(undefined); // in-memory PGlite, migrations applied
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'Maya@Example.edu', name: 'Maya' })
      .returning();
    expect(u?.timezone).toBe('America/Vancouver');

    // Emails are unique case-insensitively.
    await expect(db.insert(schema.users).values({ email: 'maya@example.edu' })).rejects.toThrow();

    // One agent per student.
    await db.insert(schema.agents).values({ userId: u!.id, agentTokenHash: 'h1' });
    await expect(
      db.insert(schema.agents).values({ userId: u!.id, agentTokenHash: 'h2' }),
    ).rejects.toThrow();

    // Timeline events dedupe on (user, eventId).
    const ev = {
      userId: u!.id,
      eventId: 'e1',
      type: 'agent.pong' as const,
      reason: 'Pong',
      occurredAt: new Date(),
    };
    await db.insert(schema.agentEvents).values(ev);
    const dup = await db.insert(schema.agentEvents).values(ev).onConflictDoNothing().returning();
    expect(dup).toHaveLength(0);

    // Deleting a student removes their data.
    await db.delete(schema.users).where(eq(schema.users.id, u!.id));
    expect(await db.select().from(schema.agents)).toHaveLength(0);
  });
});
