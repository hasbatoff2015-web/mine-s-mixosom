import { createHmac, timingSafeEqual } from 'node:crypto';

/** Largest accepted proof. The published purchase example is far smaller. */
export const YANDEX_PROOF_MAX_CHARS = 8192;

export type YandexProofFailure =
  | 'malformed'
  | 'bad_signature'
  | 'too_large'
  | 'unsupported_algorithm'
  | 'not_a_player_profile'
  | 'profile_schema_unverified';

/**
 * Signature check only. This never returns a provider user id.
 * The player page documents the `<signature>.<profile data>` envelope and points at
 * the purchase HMAC example. It does not name the JSON fields inside a player profile,
 * so a matching MAC is not enough to authenticate an account.
 */
export type YandexProofResult = { readonly ok: false; readonly reason: YandexProofFailure };

const STANDARD_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function verifyYandexPlayerSignature(proof: string, secret: string): YandexProofResult {
  if (typeof proof !== 'string' || typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (proof.length > YANDEX_PROOF_MAX_CHARS) return { ok: false, reason: 'too_large' };
  const parts = proof.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const signature = strictBase64(parts[0]);
  const payload = strictBase64(parts[1]);
  if (!signature || !payload) return { ok: false, reason: 'malformed' };
  const digest = createHmac('sha256', secret).update(payload).digest();
  if (signature.length !== digest.length || !timingSafeEqual(signature, digest)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    return { ok: false, reason: 'profile_schema_unverified' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'profile_schema_unverified' };
  }
  const root = parsed as Record<string, unknown>;
  if (typeof root.algorithm === 'string' && root.algorithm !== 'HMAC-SHA256') {
    return { ok: false, reason: 'unsupported_algorithm' };
  }
  const data = root.data;
  if (data && typeof data === 'object' && !Array.isArray(data) && ('product' in data || 'token' in data)) {
    return { ok: false, reason: 'not_a_player_profile' };
  }
  return { ok: false, reason: 'profile_schema_unverified' };
}

function strictBase64(value: string): Buffer | undefined {
  if (value.length === 0 || value.length % 4 !== 0 || !STANDARD_BASE64.test(value)) return undefined;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (padding === 1 && value.length < 4) return undefined;
  if (value.slice(0, value.length - padding).includes('=')) return undefined;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0) return undefined;
  return decoded;
}
