import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describeLifecycle, triggerTime, verifySignature } from './maritime-webhooks';

const sign = (body: string, secret: string) =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('verifySignature', () => {
  it('accepts a correct signature', () => {
    expect(verifySignature('{"a":1}', sign('{"a":1}', 's3cret'), 's3cret')).toBe(true);
  });
  it('fails closed', () => {
    expect(verifySignature('{"a":1}', sign('{"a":2}', 's3cret'), 's3cret')).toBe(false);
    expect(verifySignature('{"a":1}', sign('{"a":1}', 'other'), 's3cret')).toBe(false);
    expect(verifySignature('{"a":1}', sign('{"a":1}', ''), '')).toBe(false);
    expect(verifySignature('{"a":1}', null, 's3cret')).toBe(false);
    expect(verifySignature('{"a":1}', 'sha256=zz', 's3cret')).toBe(false);
  });
});

describe('triggerTime', () => {
  it('uses the cron minute for scheduled requests and the send marker otherwise', () => {
    expect(triggerTime('cron:brief@2026-11-07T22:45', new Map())?.toISOString()).toBe(
      '2026-11-07T22:45:00.000Z',
    );
    const sent = new Date('2026-11-07T22:41:02.498Z');
    expect(triggerTime('brief:manual:x', new Map([['brief:manual:x', sent]]))).toBe(sent);
    expect(triggerTime('unknown', new Map())).toBeNull();
  });
});

describe('describeLifecycle', () => {
  it('speaks plainly', () => {
    expect(describeLifecycle('agent.llm_limit_reached', {})).toBe(
      'Paused: your monthly AI budget is used up',
    );
    expect(describeLifecycle('agent.error', { failure_kind: 'build' })).toBe(
      'Your agent hit an error (build)',
    );
  });
});
