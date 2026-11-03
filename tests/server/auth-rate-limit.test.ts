import { describe, expect, it } from 'vitest';
import { AuthRateLimiter } from '../../server/identity/authRateLimit';

describe('yandex auth rate limit', () => {
  it('keeps counting after a new socket from the same peer and forgets old stamps', () => {
    const limiter = new AuthRateLimiter();
    const now = 1_000_000;
    const first = {};
    for (let index = 0; index < 8; index += 1) {
      expect(limiter.allowConnection(first, '10.0.0.8', now + index)).toBe(true);
    }
    expect(limiter.allowConnection(first, '10.0.0.8', now + 8)).toBe(false);
    const second = {};
    expect(limiter.allowConnection(second, '10.0.0.9', now + 9)).toBe(true);
    for (let index = 0; index < 40; index += 1) {
      expect(limiter.allowConnection({}, '10.1.0.1', now + 20 + index)).toBe(true);
    }
    expect(limiter.allowConnection({}, '10.1.0.1', now + 80)).toBe(false);
    expect(limiter.allowConnection({}, '10.1.0.2', now + 81)).toBe(true);
    expect(limiter.allowConnection(first, '10.0.0.8', now + 5 * 60 * 1000 + 20)).toBe(true);
    for (let index = 0; index < 6; index += 1) expect(limiter.allowSubject('proof-a', now + index)).toBe(true);
    expect(limiter.allowSubject('proof-a', now + 6)).toBe(false);
    expect(limiter.allowSubject('proof-b', now + 7)).toBe(true);
  });
});
