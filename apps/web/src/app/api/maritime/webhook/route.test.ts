import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST } from './route';
import { getDb, schema } from '@/db';

let uid: string;
beforeAll(async () => {
  process.env.MARITIME_WEBHOOK_SECRET = 'whsec_test';
  const db = await getDb();
  const [u] = await db.insert(schema.users).values({ email: 'wh@x.edu' }).returning();
  uid = u!.id;
});

const deliver = (body: object, delivery: string, secret = 'whsec_test') => {
  const raw = JSON.stringify(body);
  return POST(
    new Request('http://x/api/maritime/webhook', {
      method: 'POST',
      headers: {
        'x-maritime-signature': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
        'x-maritime-delivery': delivery,
      },
      body: raw,
    }),
  );
};

describe('POST /api/maritime/webhook', () => {
  it('rejects bad signatures', async () => {
    expect((await deliver({ event: 'agent.woken' }, 'd0', 'wrong')).status).toBe(401);
  });
  it('stores a lifecycle event for the right student, once per delivery', async () => {
    const evt = {
      event: 'agent.sleeping',
      agent_id: 'a1',
      external_id: `user_${uid}`,
      end_user: { external_id: `user_${uid}` },
      timestamp: '2026-11-07T22:50:00Z',
      data: {},
    };
    expect((await deliver(evt, 'd1')).status).toBe(200);
    expect((await deliver(evt, 'd1')).status).toBe(200); // retry
    const rows = await (await getDb()).select().from(schema.maritimeEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: uid, kind: 'agent.sleeping', maritimeAgentId: 'a1' });
    expect(rows[0]?.payloadJson.summary).toBe('Your agent went to sleep (idle)');
  });
});
