import { describe, expect, it } from 'vitest';
import { withRateLimitRetry } from './agent-transport';
import { MaritimeError } from './maritime';

const limited = (after: number | null) =>
  new MaritimeError(429, 'rate limited', '/api/webhooks/x', after);

describe('withRateLimitRetry', () => {
  it('waits as long as Maritime asks, then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await withRateLimitRetry(
      async () => {
        calls++;
        if (calls < 3) throw limited(2);
        return 'ok';
      },
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect(out).toBe('ok');
    expect(waits.map((w) => Math.round(w / 1000))).toEqual([2, 2]);
  });

  it('gives up within its time budget', async () => {
    await expect(
      withRateLimitRetry(
        async () => {
          throw limited(8);
        },
        { budgetMs: 5_000, sleep: async () => {} },
      ),
    ).rejects.toThrow(/429/);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(
      withRateLimitRetry(async () => {
        calls++;
        throw new MaritimeError(500, 'boom', '/x');
      }),
    ).rejects.toThrow(/500/);
    expect(calls).toBe(1);
  });
});
