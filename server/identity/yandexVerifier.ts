import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Largest accepted proof string. A real player signature is much smaller. */
export const YANDEX_PROOF_MAX_CHARS = 8192;
/** Decoded JSON must stay under this size. HMAC runs on these exact bytes. */
export const YANDEX_PAYLOAD_MAX_BYTES = 4096;
export const YANDEX_SUBJECT_MAX_CHARS = 128;

export const DEFAULT_YANDEX_MAX_AGE_SECONDS = 600;
export const DEFAULT_YANDEX_CLOCK_SKEW_SECONDS = 120;

export type YandexProofFailure =
  | 'malformed'
  | 'bad_signature'
  | 'too_large'
  | 'unsupported_algorithm'
  | 'not_a_player_profile'
  | 'invalid_schema'
  | 'expired'
  | 'not_yet_valid';

const brand = Symbol('fc.yandex.signed-player');

/**
 * A Yandex player subject this process verified from a signed profile.
 * This is not proof that the player completed a Yandex account login.
 * `isAuthorized()` is a client method and is not a signed field.
 */
export interface SignedYandexPlayer {
  readonly provider: 'yandex';
  readonly providerUserId: string;
  readonly issuedAt: number;
  readonly proofHash: string;
}

export type YandexProofResult =
  | { readonly ok: true; readonly identity: SignedYandexPlayer }
  | { readonly ok: false; readonly reason: YandexProofFailure };

export interface YandexVerifyOptions {
  readonly secret: string;
  readonly nowMs: number;
  readonly maxAgeSeconds: number;
  readonly clockSkewSeconds: number;
}

const STANDARD_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function isSignedYandexPlayer(value: unknown): value is SignedYandexPlayer {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<PropertyKey, unknown>;
  if (row[brand] !== true || row.provider !== 'yandex') return false;
  return isSubject(row.providerUserId)
    && isUnixSeconds(row.issuedAt)
    && typeof row.proofHash === 'string'
    && /^[0-9a-f]{64}$/.test(row.proofHash);
}

/**
 * Verifies a Yandex player signature and, only then, mints a signed subject.
 * HMAC covers the decoded bytes of the second envelope part, matching the
 * official purchase example. The JSON is parsed after the MAC check.
 * There is no public function that turns an arbitrary string into this subject.
 */
export function verifyYandexPlayerProof(proof: string, options: YandexVerifyOptions): YandexProofResult {
  if (typeof proof !== 'string' || typeof options.secret !== 'string' || options.secret.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (!Number.isFinite(options.nowMs) || options.maxAgeSeconds < 1 || options.clockSkewSeconds < 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (proof.length > YANDEX_PROOF_MAX_CHARS) return { ok: false, reason: 'too_large' };
  const parts = proof.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const signature = strictBase64(parts[0]);
  const payload = strictBase64(parts[1]);
  if (!signature || !payload) return { ok: false, reason: 'malformed' };
  if (payload.length > YANDEX_PAYLOAD_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const digest = createHmac('sha256', options.secret).update(payload).digest();
  if (signature.length !== digest.length || !timingSafeEqual(signature, digest)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_schema' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid_schema' };
  }
  const root = parsed as Record<string, unknown>;
  if (root.algorithm !== 'HMAC-SHA256') {
    return { ok: false, reason: typeof root.algorithm === 'string' ? 'unsupported_algorithm' : 'invalid_schema' };
  }
  if (!isUnixSeconds(root.issuedAt)) return { ok: false, reason: 'invalid_schema' };
  const data = root.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'invalid_schema' };
  const profile = data as Record<string, unknown>;
  if ('product' in profile || 'token' in profile) return { ok: false, reason: 'not_a_player_profile' };
  if (!isSubject(profile.uniqueID) || profile.id !== profile.uniqueID) return { ok: false, reason: 'invalid_schema' };
  const nowSeconds = Math.floor(options.nowMs / 1000);
  if (root.issuedAt > nowSeconds + options.clockSkewSeconds) return { ok: false, reason: 'not_yet_valid' };
  if (nowSeconds - root.issuedAt > options.maxAgeSeconds) return { ok: false, reason: 'expired' };
  const identity: SignedYandexPlayer = {
    provider: 'yandex',
    providerUserId: profile.uniqueID,
    issuedAt: root.issuedAt,
    proofHash: createHash('sha256').update(proof, 'utf8').digest('hex'),
  };
  Object.defineProperty(identity, brand, { value: true });
  return { ok: true, identity };
}

function isUnixSeconds(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value < 10_000_000_000;
}

function isSubject(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= YANDEX_SUBJECT_MAX_CHARS
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
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
