import { afterEach, describe, expect, it } from 'vitest';
import { connect, schema } from '@/db';
import { isExpoPushToken, pushPath, registerPushToken, sendPushToUser, setPushFetch } from './push';

const TOKEN = 'ExponentPushToken[abc123_DEF-456]';

afterEach(() => setPushFetch((...a) => fetch(...a)));

describe('push', () => {
  it('validates Expo tokens', () => {
    expect(isExpoPushToken(TOKEN)).toBe(true);
    expect(isExpoPushToken('ExponentPushToken[]')).toBe(false);
    expect(isExpoPushToken('not-a-token')).toBe(false);
  });

  it('picks the screen a tap should open', () => {
    expect(pushPath('Hand-in in 30 s', [[{ data: 'hold:1' }, { data: 'now:1' }]])).toBe(
      '/submissions',
    );
    expect(pushPath('Good morning, Maya.\nStart with Essay 2')).toBe('/today');
  });

  it('sends to every phone, and removes tokens Expo says are gone', async () => {
    const db = await connect(undefined);
    const [u] = await db.insert(schema.users).values({ email: 'p@x.edu' }).returning();
    const [other] = await db.insert(schema.users).values({ email: 'q@x.edu' }).returning();
    expect(await sendPushToUser(db, u!.id, 'Hi')).toBe(false); // no phones: no request at all

    await registerPushToken(db, u!.id, TOKEN, 'ios');
    await registerPushToken(db, u!.id, 'ExponentPushToken[gone]', 'ios');
    await registerPushToken(db, other!.id, 'ExponentPushToken[theirs]', 'ios');

    const sent: { to: string; title: string; body: string; data: { path: string } }[][] = [];
    setPushFetch((async (_u: string | URL | Request, init?: RequestInit) => {
      const msgs = JSON.parse(String(init?.body));
      sent.push(msgs);
      return Response.json({
        data: msgs.map((m: { to: string }) =>
          m.to.includes('gone')
            ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok' },
        ),
      });
    }) as typeof fetch);

    const ok = await sendPushToUser(db, u!.id, 'Your brief is ready\nStart with Essay 2', []);
    expect(ok).toBe(true);
    expect(sent[0]!.map((m) => m.to).sort()).toEqual([TOKEN, 'ExponentPushToken[gone]']);
    expect(sent[0]![0]).toMatchObject({
      title: 'Your brief is ready',
      body: 'Start with Essay 2',
      data: { path: '/today' },
    });
    const left = await db.select().from(schema.pushTokens);
    expect(left.map((t) => t.token).sort()).toEqual([TOKEN, 'ExponentPushToken[theirs]']);
  });

  it('never throws when Expo is unreachable', async () => {
    const db = await connect(undefined);
    const [u] = await db.insert(schema.users).values({ email: 'r@x.edu' }).returning();
    await registerPushToken(db, u!.id, TOKEN, 'ios');
    setPushFetch((async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch);
    expect(await sendPushToUser(db, u!.id, 'Hi')).toBe(false);
  });
});
