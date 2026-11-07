import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from './session';

const key = 'k'.repeat(32);

describe('session cookie', () => {
  it('round-trips', () => {
    expect(verifySession(signSession('u1', Date.now(), key), Date.now(), key)).toBe('u1');
  });
  it('rejects tampering', () => {
    const v = signSession('u1', Date.now(), key);
    const forged =
      Buffer.from(JSON.stringify({ uid: 'u2', exp: 9e9 })).toString('base64url') +
      '.' +
      v.split('.')[1];
    expect(verifySession(forged, Date.now(), key)).toBeNull();
    expect(verifySession(v, Date.now(), 'x'.repeat(32))).toBeNull();
    expect(verifySession('garbage', Date.now(), key)).toBeNull();
  });
  it('expires', () => {
    const v = signSession('u1', 0, key);
    expect(verifySession(v, 15 * 24 * 3600 * 1000, key)).toBeNull();
  });
});
