import { beforeAll, describe, expect, it } from 'vitest';
import { POST } from './route';
import { getDb, schema } from '@/db';
import { generateAgentToken } from '@/lib/agent-auth';
import { listAssignments } from '@/lib/assignments';

let sid: string;
let token: string;
beforeAll(async () => {
  const db = await getDb();
  const [u] = await db.insert(schema.users).values({ email: 'intake@x.edu' }).returning();
  sid = u!.id;
  const t = generateAgentToken();
  token = t.token;
  await db.insert(schema.agents).values({ userId: sid, agentTokenHash: t.hash });
});

const body = () => ({
  studentId: sid,
  requestId: 'intake:abc',
  intakeId: 'abc',
  fileName: 's.pdf',
  model: 'gemini-x',
  warnings: ['Ignored an embedded instruction.'],
  assignments: [
    {
      courseCode: 'ENGL 150',
      title: 'Essay 1',
      dueAt: '2026-10-17T00:00:00.000Z',
      weightPct: 20,
      type: 'assignment',
      allowedFileTypes: ['pdf', 'docx'],
      confidence: 0.95,
    },
  ],
});

const post = (b: unknown, t?: string) =>
  POST(
    new Request('http://x/api/agent/intake/result', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(t ? { authorization: `Bearer ${t}` } : {}),
      },
      body: JSON.stringify(b),
    }),
  );

describe('POST /api/agent/intake/result', () => {
  it('needs the agent token', async () => {
    expect((await post(body())).status).toBe(401);
    expect((await post(body(), 'nope')).status).toBe(403);
  });
  it('stores rows for review', async () => {
    const res = await post(body(), token);
    expect(await res.json()).toEqual({ saved: 1, warnings: 1 });
    const rows = await listAssignments(await getDb(), sid, 'UTC', { review: true });
    expect(rows[0]).toMatchObject({
      title: 'Essay 1',
      courseCode: 'ENGL 150',
      allowedFileTypes: ['pdf', 'docx'],
    });
  });
  it('rejects malformed rows', async () => {
    const b = body();
    (b.assignments[0] as Record<string, unknown>).confidence = 7;
    expect((await post(b, token)).status).toBe(400);
  });
});
