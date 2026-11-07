import { beforeAll, describe, expect, it } from 'vitest';
import { POST } from './route';
import { deriveAgentToken } from '@/lib/agent-auth';

beforeAll(() => {
  process.env.AGENT_EVENT_SECRET = 'test-secret-at-least-16';
});

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

describe('POST /api/agent/events', () => {
  it('requires a bearer token', async () => {
    expect((await post({ studentId: 's1', events: [event('e1')] })).status).toBe(401);
  });

  it("rejects another student's token", async () => {
    const res = await post({ studentId: 's1', events: [event('e1')] }, deriveAgentToken('s2'));
    expect(res.status).toBe(403);
  });

  it('validates the body', async () => {
    const res = await post({ studentId: 's1', events: [{ type: 'nope' }] }, deriveAgentToken('s1'));
    expect(res.status).toBe(400);
  });

  it('accepts events and dedupes on eventId', async () => {
    const t = deriveAgentToken('s1');
    const first = await post({ studentId: 's1', events: [event('a'), event('b')] }, t);
    expect(await first.json()).toEqual({ accepted: 2, duplicates: 0 });
    const again = await post({ studentId: 's1', events: [event('a')] }, t);
    expect(await again.json()).toEqual({ accepted: 0, duplicates: 1 });
  });
});
