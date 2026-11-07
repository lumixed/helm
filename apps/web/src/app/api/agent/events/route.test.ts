import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { POST } from './route';
import { getDb, schema } from '@/db';
import { generateAgentToken } from '@/lib/agent-auth';

const event = (id: string) => ({
  eventId: id,
  type: 'agent.pong',
  reason: 'Pong',
  occurredAt: '2026-11-07T20:00:00Z',
  payload: {},
});

const post = (body: unknown, token?: string) =>
  POST(
    new Request('http://x/api/agent/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

let s1: string;
let s2: string;
let t1: string;
let t2: string;

beforeAll(async () => {
  const db = await getDb();
  const [u1, u2] = await db
    .insert(schema.users)
    .values([{ email: 'one@example.edu' }, { email: 'two@example.edu' }])
    .returning();
  s1 = u1!.id;
  s2 = u2!.id;
  const a = generateAgentToken();
  const b = generateAgentToken();
  t1 = a.token;
  t2 = b.token;
  await db.insert(schema.agents).values([
    { userId: s1, agentTokenHash: a.hash },
    { userId: s2, agentTokenHash: b.hash },
  ]);
});

describe('POST /api/agent/events', () => {
  it('requires a bearer token', async () => {
    expect((await post({ studentId: s1, events: [event('e1')] })).status).toBe(401);
  });

  it('rejects unknown tokens', async () => {
    expect((await post({ studentId: s1, events: [event('e1')] }, 'not-a-token')).status).toBe(403);
  });

  it("rejects another student's token", async () => {
    expect((await post({ studentId: s1, events: [event('e1')] }, t2)).status).toBe(403);
  });

  it('validates the body', async () => {
    expect((await post({ studentId: s1, events: [{ type: 'nope' }] }, t1)).status).toBe(400);
  });

  it('stores events and dedupes on eventId', async () => {
    const first = await post({ studentId: s1, events: [event('a'), event('b')] }, t1);
    expect(await first.json()).toEqual({ accepted: 2, duplicates: 0 });
    const again = await post({ studentId: s1, events: [event('a')] }, t1);
    expect(await again.json()).toEqual({ accepted: 0, duplicates: 1 });
    const db = await getDb();
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, s1));
    expect(agent?.lastSeenAt).toBeInstanceOf(Date);
  });
});
