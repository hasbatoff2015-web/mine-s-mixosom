import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadYandexAuthConfig, yandexAuthLogLabel } from '../../server/config';
import { scopeMatchesProcess } from '../../server/identity/providerLinks';
import { verifyYandexPlayerProof, YANDEX_PROOF_MAX_CHARS } from '../../server/identity/yandexVerifier';
import { signedPlayerProfile } from './yandexProfileFixture';

function verify(proof: string, secret: string, nowMs = Date.now()) {
  return verifyYandexPlayerProof(proof, {
    secret,
    nowMs,
    maxAgeSeconds: 600,
    clockSkewSeconds: 120,
  });
}

function rejected(proof: string, secret: string, nowMs = Date.now()): string {
  const result = verify(proof, secret, nowMs);
  if (result.ok) throw new Error('expected the proof to be rejected');
  return result.reason;
}

const PUBLISHED_PURCHASE_SECRET = 't0p$ecret';
const PUBLISHED_PURCHASE_SIGNATURE = 'hQ8adIRJWD29Nep+0P36Z6edI5uzj6F3tddz6Dqgclk=.eyJhbGdvcml0aG0iOiJITUFDLVNIQTI1NiIsImlzc3VlZEF0IjoxNTcxMjMzMzcxLCJyZXF1ZXN0UGF5bG9hZCI6InF3ZSIsImRhdGEiOnsidG9rZW4iOiJkODVhZTBiMS05MTY2LTRmYmItYmIzOC02ZDJhNGNhNDQxNmQiLCJzdGF0dXMiOiJ3YWl0aW5nIiwiZXJyb3JDb2RlIjoiIiwiZXJyb3JEZXNjcmlwdGlvbiI6IiIsInVybCI6Imh0dHBzOi8veWFuZGV4LnJ1L2dhbWVzL3Nkay9wYXltZW50cy90cnVzdC1mYWtlLmh0bWwiLCJwcm9kdWN0Ijp7ImlkIjoibm9hZHMiLCJ0aXRsZSI6ItCR0LXQtyDRgNC10LrQu9Cw0LzRiyIsImRlc2NyaXB0aW9uIjoi0J7RgtC60LvRjtGH0LjRgtGMINGA0LXQutC70LDQvNGDINCyINC40LPRgNC1IiwicHJpY2UiOnsiY29kZSI6IlJVUiIsInZhbHVlIjoiNDkifSwiaW1hZ2VQcmVmaXgiOiJodHRwczovL2F2YXRhcnMubWRzLnlhbmRleC5uZXQvZ2V0LWdhbWVzLzE4OTI5OTUvMmEwMDAwMDE2ZDFjMTcxN2JkN2EwMTQ5Y2NhZGM4NjA3OGExLyJ9fX0=';

function sign(payload: string, secret: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64');
  const mac = createHmac('sha256', secret).update(Buffer.from(body, 'base64')).digest('base64');
  return `${mac}.${body}`;
}

describe('yandex player proof', () => {
  it('accepts the published purchase MAC and refuses it as a player profile', () => {
    expect(verify(PUBLISHED_PURCHASE_SIGNATURE, PUBLISHED_PURCHASE_SECRET)).toEqual({
      ok: false,
      reason: 'not_a_player_profile',
    });
  });

  it('rejects a wrong secret', () => {
    expect(verify(PUBLISHED_PURCHASE_SIGNATURE, 'other-secret')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a modified profile and a modified signature', () => {
    const [signature, body] = PUBLISHED_PURCHASE_SIGNATURE.split('.');
    const decoded = Buffer.from(body!, 'base64');
    decoded[10] = decoded[10]! ^ 1;
    const changed = `${signature}.${decoded.toString('base64')}`;
    expect(rejected(changed, PUBLISHED_PURCHASE_SECRET)).toBe('bad_signature');
    const flipped = `${signature!.slice(0, -2)}AA.${body}`;
    expect(rejected(flipped, PUBLISHED_PURCHASE_SECRET)).toBe('bad_signature');
  });

  it('rejects malformed encoding, missing halves, and extra separators', () => {
    expect(rejected('@@@.@@@', 'secret')).toBe('malformed');
    expect(rejected('only-one-part', 'secret')).toBe('malformed');
    expect(rejected('.eyJub3QiOiJwbGF5ZXIifQ==', 'secret')).toBe('malformed');
    expect(rejected('aaaa.bbbb.cccc', 'secret')).toBe('malformed');
    expect(rejected('', 'secret')).toBe('malformed');
  });

  it('rejects an oversized proof before trusting it', () => {
    expect(rejected('a'.repeat(YANDEX_PROOF_MAX_CHARS + 1), 'secret')).toBe('too_large');
  });

  it('rejects an unsupported algorithm after a valid MAC', () => {
    const proof = sign(JSON.stringify({ algorithm: 'none', uniqueID: 'user-1' }), 'test-secret');
    expect(verify(proof, 'test-secret')).toEqual({ ok: false, reason: 'unsupported_algorithm' });
  });

  it('does not authenticate a made-up unique id, an empty id, or a client authorized flag', () => {
    const secret = 'test-secret';
    expect(verify(sign(JSON.stringify({ uniqueID: 'user-1', isAuthorized: true }), secret), secret)).toEqual({
      ok: false,
      reason: 'invalid_schema',
    });
    expect(rejected(sign(JSON.stringify({ uniqueID: '' }), secret), secret)).toBe('invalid_schema');
    expect(rejected(sign(JSON.stringify({ appID: 1 }), secret), secret)).toBe('invalid_schema');
    expect(rejected('user-1', secret)).toBe('malformed');
    expect(rejected(JSON.stringify({ verified: true, provider: 'yandex', providerUserId: 'user-1' }), secret)).toBe('malformed');
  });

  it('does not treat a purchase issuedAt as a solved player-freshness rule', () => {
    const result = verify(PUBLISHED_PURCHASE_SIGNATURE, PUBLISHED_PURCHASE_SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).not.toBe('bad_signature');
  });

  it('does not authenticate a synthetic purchase-shaped profile that names a unique id', () => {
    const secret = 'test-secret';
    const proof = sign(JSON.stringify({
      algorithm: 'HMAC-SHA256',
      issuedAt: 1_700_000_000,
      data: { uniqueID: 'user-1', isAuthorized: true },
    }), secret);
    expect(verify(proof, secret)).toEqual({
      ok: false,
      reason: 'invalid_schema',
    });
    const source = readFileSync(resolve('server/identity/yandexVerifier.ts'), 'utf8');
    expect(source).not.toContain('issueVerifiedYandexIdentity');
  });

  it('accepts a synthetic signed player profile and rejects stale, future, and mismatched ids', () => {
    const secret = 'test-secret';
    const issuedAt = 1_700_000_000;
    const nowMs = issuedAt * 1000;
    const proof = signedPlayerProfile('user-1', secret, issuedAt);
    const ok = verify(proof, secret, nowMs);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.identity.providerUserId).toBe('user-1');
    expect(ok.identity.proofHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verify(proof, secret, nowMs + 601_000)).toEqual({ ok: false, reason: 'expired' });
    expect(verify(proof, secret, nowMs - 121_000)).toEqual({ ok: false, reason: 'not_yet_valid' });
    const mismatched = sign(JSON.stringify({
      algorithm: 'HMAC-SHA256',
      issuedAt,
      data: { id: 'other', uniqueID: 'user-1', isAuthorized: true },
    }), secret);
    expect(rejected(mismatched, secret, nowMs)).toBe('invalid_schema');
    const copied = { ...ok.identity, providerUserId: 'attacker' };
    expect(copied.providerUserId).toBe('attacker');
    expect(rejected(JSON.stringify({ verified: true, providerUserId: 'user-1' }), secret)).toBe('malformed');
  });
});

describe('yandex auth configuration', () => {
  it('stays off without a flag, without a secret, and without PostgreSQL', () => {
    expect(loadYandexAuthConfig({}, false)).toEqual({ enabled: false, reason: 'disabled' });
    expect(loadYandexAuthConfig({ FC_YANDEX_AUTH_ENABLED: '1' }, false)).toEqual({ enabled: false, reason: 'missing_secret' });
    const secret = 'do-not-log-this-value';
    const withoutDb = loadYandexAuthConfig({ FC_YANDEX_AUTH_ENABLED: '1', FC_YANDEX_AUTH_SECRET: secret }, false);
    expect(withoutDb).toEqual({ enabled: false, reason: 'database_disabled' });
    expect(yandexAuthLogLabel(withoutDb)).not.toContain(secret);
    const enabled = loadYandexAuthConfig({ FC_YANDEX_AUTH_ENABLED: '1', FC_YANDEX_AUTH_SECRET: secret }, true);
    expect(enabled.enabled).toBe(true);
    if (enabled.enabled) expect(enabled.secret).toBe(secret);
    expect(yandexAuthLogLabel(enabled)).toBe('yandex auth: enabled');
    expect(yandexAuthLogLabel(enabled)).not.toContain(secret);
    expect(loadYandexAuthConfig({
      FC_YANDEX_AUTH_ENABLED: '1',
      FC_YANDEX_AUTH_SECRET: ` ${secret}`,
    }, true)).toEqual({ enabled: false, reason: 'invalid_config' });
  });

  it('requires the process scope to match deployment, mode, and world', () => {
    const processScope = { deploymentId: 'dev', serverMode: 'anarchy', worldId: 'world-a' };
    expect(scopeMatchesProcess(processScope, processScope)).toBe(true);
    expect(scopeMatchesProcess(processScope, { ...processScope, deploymentId: 'prod' })).toBe(false);
    expect(scopeMatchesProcess(processScope, { ...processScope, serverMode: 'survival' })).toBe(false);
    expect(scopeMatchesProcess(processScope, { ...processScope, worldId: 'world-b' })).toBe(false);
  });
});
