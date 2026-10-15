import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadYandexAuthConfig, yandexAuthLogLabel } from '../../server/config';
import { scopeMatchesProcess } from '../../server/identity/providerLinks';
import { verifyYandexPlayerSignature, YANDEX_PROOF_MAX_CHARS } from '../../server/identity/yandexVerifier';

const PUBLISHED_PURCHASE_SECRET = 't0p$ecret';
const PUBLISHED_PURCHASE_SIGNATURE = 'hQ8adIRJWD29Nep+0P36Z6edI5uzj6F3tddz6Dqgclk=.eyJhbGdvcml0aG0iOiJITUFDLVNIQTI1NiIsImlzc3VlZEF0IjoxNTcxMjMzMzcxLCJyZXF1ZXN0UGF5bG9hZCI6InF3ZSIsImRhdGEiOnsidG9rZW4iOiJkODVhZTBiMS05MTY2LTRmYmItYmIzOC02ZDJhNGNhNDQxNmQiLCJzdGF0dXMiOiJ3YWl0aW5nIiwiZXJyb3JDb2RlIjoiIiwiZXJyb3JEZXNjcmlwdGlvbiI6IiIsInVybCI6Imh0dHBzOi8veWFuZGV4LnJ1L2dhbWVzL3Nkay9wYXltZW50cy90cnVzdC1mYWtlLmh0bWwiLCJwcm9kdWN0Ijp7ImlkIjoibm9hZHMiLCJ0aXRsZSI6ItCR0LXQtyDRgNC10LrQu9Cw0LzRiyIsImRlc2NyaXB0aW9uIjoi0J7RgtC60LvRjtGH0LjRgtGMINGA0LXQutC70LDQvNGDINCyINC40LPRgNC1IiwicHJpY2UiOnsiY29kZSI6IlJVUiIsInZhbHVlIjoiNDkifSwiaW1hZ2VQcmVmaXgiOiJodHRwczovL2F2YXRhcnMubWRzLnlhbmRleC5uZXQvZ2V0LWdhbWVzLzE4OTI5OTUvMmEwMDAwMDE2ZDFjMTcxN2JkN2EwMTQ5Y2NhZGM4NjA3OGExLyJ9fX0=';

function sign(payload: string, secret: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64');
  const mac = createHmac('sha256', secret).update(Buffer.from(body, 'base64')).digest('base64');
  return `${mac}.${body}`;
}

describe('yandex player proof', () => {
  it('accepts the published purchase MAC and refuses it as a player profile', () => {
    expect(verifyYandexPlayerSignature(PUBLISHED_PURCHASE_SIGNATURE, PUBLISHED_PURCHASE_SECRET)).toEqual({
      ok: false,
      reason: 'not_a_player_profile',
    });
  });

  it('rejects a wrong secret', () => {
    expect(verifyYandexPlayerSignature(PUBLISHED_PURCHASE_SIGNATURE, 'other-secret')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a modified profile and a modified signature', () => {
    const [signature, body] = PUBLISHED_PURCHASE_SIGNATURE.split('.');
    const decoded = Buffer.from(body!, 'base64');
    decoded[10] = decoded[10]! ^ 1;
    const changed = `${signature}.${decoded.toString('base64')}`;
    expect(verifyYandexPlayerSignature(changed, PUBLISHED_PURCHASE_SECRET).reason).toBe('bad_signature');
    const flipped = `${signature!.slice(0, -2)}AA.${body}`;
    expect(verifyYandexPlayerSignature(flipped, PUBLISHED_PURCHASE_SECRET).reason).toBe('bad_signature');
  });

  it('rejects malformed encoding, missing halves, and extra separators', () => {
    expect(verifyYandexPlayerSignature('@@@.@@@', 'secret').reason).toBe('malformed');
    expect(verifyYandexPlayerSignature('only-one-part', 'secret').reason).toBe('malformed');
    expect(verifyYandexPlayerSignature('.eyJub3QiOiJwbGF5ZXIifQ==', 'secret').reason).toBe('malformed');
    expect(verifyYandexPlayerSignature('aaaa.bbbb.cccc', 'secret').reason).toBe('malformed');
    expect(verifyYandexPlayerSignature('', 'secret').reason).toBe('malformed');
  });

  it('rejects an oversized proof before trusting it', () => {
    expect(verifyYandexPlayerSignature('a'.repeat(YANDEX_PROOF_MAX_CHARS + 1), 'secret').reason).toBe('too_large');
  });

  it('rejects an unsupported algorithm after a valid MAC', () => {
    const proof = sign(JSON.stringify({ algorithm: 'none', uniqueID: 'user-1' }), 'test-secret');
    expect(verifyYandexPlayerSignature(proof, 'test-secret')).toEqual({ ok: false, reason: 'unsupported_algorithm' });
  });

  it('does not authenticate a made-up unique id, an empty id, or a client authorized flag', () => {
    const secret = 'test-secret';
    expect(verifyYandexPlayerSignature(sign(JSON.stringify({ uniqueID: 'user-1', isAuthorized: true }), secret), secret)).toEqual({
      ok: false,
      reason: 'profile_schema_unverified',
    });
    expect(verifyYandexPlayerSignature(sign(JSON.stringify({ uniqueID: '' }), secret), secret).reason).toBe('profile_schema_unverified');
    expect(verifyYandexPlayerSignature(sign(JSON.stringify({ appID: 1 }), secret), secret).reason).toBe('profile_schema_unverified');
    expect(verifyYandexPlayerSignature('user-1', secret).reason).toBe('malformed');
    expect(verifyYandexPlayerSignature(JSON.stringify({ verified: true, provider: 'yandex', providerUserId: 'user-1' }), secret).reason).toBe('malformed');
  });

  it('does not treat a purchase issuedAt as a solved player-freshness rule', () => {
    const result = verifyYandexPlayerSignature(PUBLISHED_PURCHASE_SIGNATURE, PUBLISHED_PURCHASE_SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).not.toBe('bad_signature');
  });
});

describe('yandex auth configuration', () => {
  it('stays off without a flag, without a secret, and even with both', () => {
    expect(loadYandexAuthConfig({})).toEqual({ enabled: false, reason: 'disabled' });
    expect(loadYandexAuthConfig({ FC_YANDEX_AUTH_ENABLED: '1' })).toEqual({ enabled: false, reason: 'missing_secret' });
    const secret = 'do-not-log-this-value';
    const configured = loadYandexAuthConfig({ FC_YANDEX_AUTH_ENABLED: '1', FC_YANDEX_AUTH_SECRET: secret });
    expect(configured).toEqual({ enabled: false, reason: 'profile_schema_unverified' });
    expect(yandexAuthLogLabel(configured)).not.toContain(secret);
    expect(yandexAuthLogLabel({ enabled: false, reason: 'missing_secret' })).not.toContain('secret=');
  });

  it('requires the process scope to match deployment, mode, and world', () => {
    const processScope = { deploymentId: 'dev', serverMode: 'anarchy', worldId: 'world-a' };
    expect(scopeMatchesProcess(processScope, processScope)).toBe(true);
    expect(scopeMatchesProcess(processScope, { ...processScope, deploymentId: 'prod' })).toBe(false);
    expect(scopeMatchesProcess(processScope, { ...processScope, serverMode: 'survival' })).toBe(false);
    expect(scopeMatchesProcess(processScope, { ...processScope, worldId: 'world-b' })).toBe(false);
  });
});
