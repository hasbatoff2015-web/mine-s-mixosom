import { describe, expect, it } from 'vitest';
import { AuthRateLimiter, parseTrustedProxies, socketPeerKey } from '../../server/identity/authRateLimit';
import { loadServerConfig } from '../../server/config';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('yandex auth rate limit', () => {
  it('limits a socket, a real peer, and a verified subject across proofs', () => {
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
    for (let index = 0; index < 6; index += 1) {
      expect(limiter.allowVerifiedSubject('yandex-user', now + index)).toBe(true);
      expect(limiter.allowProof(HASH_A, now + 100 + index)).toBe(true);
    }
    expect(limiter.allowVerifiedSubject('yandex-user', now + 6)).toBe(false);
    expect(limiter.allowVerifiedSubject('other-user', now + 7)).toBe(true);
    expect(limiter.allowProof(HASH_A, now + 200)).toBe(false);
    expect(limiter.allowProof(HASH_B, now + 201)).toBe(true);
    expect(limiter.allowProof('not-a-hash', now + 202)).toBe(false);
  });

  it('does not share a loopback peer bucket and ignores a spoofed forwarding header', () => {
    const limiter = new AuthRateLimiter();
    const now = 5_000_000;
    const loopback = { _socket: { remoteAddress: '127.0.0.1' } };
    const spoofed = { headers: { 'x-forwarded-for': '203.0.113.5' } };
    expect(socketPeerKey(loopback, spoofed)).toBeUndefined();
    for (let index = 0; index < 50; index += 1) {
      expect(limiter.allowConnection({}, socketPeerKey(loopback, spoofed), now + index)).toBe(true);
    }
    const outsider = { _socket: { remoteAddress: '198.51.100.9' } };
    expect(socketPeerKey(outsider, spoofed)).toBe('198.51.100.9');
    const trusted = { _socket: { remoteAddress: '::ffff:127.0.0.1' } };
    expect(socketPeerKey(trusted, { headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.8' } }, ['127.0.0.1'])).toBe('203.0.113.8');
    expect(socketPeerKey(trusted, { headers: { 'x-forwarded-for': '1.1.1.1' } }, [])).toBeUndefined();
    const shared = socketPeerKey(trusted, { headers: { 'x-forwarded-for': '203.0.113.8' } }, ['127.0.0.1']);
    for (let index = 0; index < 40; index += 1) {
      expect(limiter.allowConnection({}, shared, now + 100 + index)).toBe(true);
    }
    expect(limiter.allowConnection({}, shared, now + 150)).toBe(false);
    expect(limiter.allowConnection({}, '203.0.113.9', now + 151)).toBe(true);
  });

  it('keeps a process budget and a bounded subject map', () => {
    const limiter = new AuthRateLimiter();
    const now = 9_000_000;
    for (let index = 0; index < 300; index += 1) {
      expect(limiter.allowConnection({}, undefined, now)).toBe(true);
    }
    expect(limiter.allowConnection({}, undefined, now)).toBe(false);
    expect(limiter.allowConnection({}, undefined, now + 60_000)).toBe(true);
    for (let index = 0; index < 1100; index += 1) {
      expect(limiter.allowVerifiedSubject(`user-${index}`, now)).toBe(true);
    }
    const size = (limiter as unknown as { bySubject: Map<string, unknown> }).bySubject.size;
    expect(size).toBeLessThanOrEqual(1024);
    expect(parseTrustedProxies(undefined)).toEqual([]);
    expect(parseTrustedProxies('127.0.0.1, ::1')).toEqual(['127.0.0.1', '::1']);
    expect(() => parseTrustedProxies('not an ip')).toThrow(/FC_TRUSTED_PROXIES/);
    expect(loadServerConfig({ FC_TRUSTED_PROXIES: '10.0.0.1' }).trustedProxies).toEqual(['10.0.0.1']);
  });
});
