import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes from node:crypto. base64url encoding is 43 characters. */
export const ADMIN_SECRET_BYTES = 32;
export const ADMIN_SECRET_MIN_CHARS = 43;
export const ADMIN_SECRET_MAX_CHARS = 128;
export const ADMIN_DIGEST_BYTES = 32;

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** SHA-256 of the empty string. A blank credential is not a token. */
const BLANK_SECRET_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface AdminCredential {
  readonly adminId: string;
  readonly digest: Buffer;
}

export function digestAdminSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function generateAdminSecret(): string {
  return randomBytes(ADMIN_SECRET_BYTES).toString('base64url');
}

/**
 * The admin id comes only from a digest match. There is no adminId argument:
 * a client field cannot choose which administrator this secret belongs to.
 * Both configured digests are compared.
 */
export function resolveAdminCredential(
  credentials: readonly AdminCredential[],
  secret: string,
): string | null {
  if (secret.length < ADMIN_SECRET_MIN_CHARS || secret.length > ADMIN_SECRET_MAX_CHARS) return null;
  const digest = digestAdminSecret(secret);
  let matched: string | null = null;
  for (const credential of credentials) {
    if (credential.digest.length !== digest.length) continue;
    if (timingSafeEqual(digest, credential.digest)) matched = credential.adminId;
  }
  return matched;
}

/**
 * `id:sha256hex,id:sha256hex`. Ids must be the configured pair, in either order.
 * Digests are unique. The raw env value is never copied into the error text.
 */
export function parseAdminAuthHashes(
  raw: string,
  ids: readonly [string, string],
): readonly [AdminCredential, AdminCredential] {
  const parts = raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length !== 2) throw new Error('FC_ADMIN_AUTH_HASHES must bind exactly two admin ids.');
  const byId = new Map<string, Buffer>();
  const seen: Buffer[] = [];
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon <= 0 || part.indexOf(':', colon + 1) !== -1) {
      throw new Error('FC_ADMIN_AUTH_HASHES entries must be id:sha256hex.');
    }
    const id = part.slice(0, colon);
    const hex = part.slice(colon + 1);
    if (!SHA256_HEX.test(hex) || hex === BLANK_SECRET_DIGEST) {
      throw new Error('FC_ADMIN_AUTH_HASHES digests must be 64 lowercase hex characters from a non-blank token.');
    }
    if (byId.has(id)) throw new Error('FC_ADMIN_AUTH_HASHES must bind two different admin ids.');
    const digest = Buffer.from(hex, 'hex');
    if (digest.length !== ADMIN_DIGEST_BYTES) {
      throw new Error('FC_ADMIN_AUTH_HASHES digests must be 64 lowercase hex characters from a non-blank token.');
    }
    if (seen.some((existing) => existing.equals(digest))) {
      throw new Error('FC_ADMIN_AUTH_HASHES credentials must be unique.');
    }
    byId.set(id, digest);
    seen.push(digest);
  }
  const first = byId.get(ids[0]);
  const second = byId.get(ids[1]);
  if (!first || !second || byId.size !== 2) {
    throw new Error('FC_ADMIN_AUTH_HASHES must include both FC_ADMIN_IDS and no other id.');
  }
  return [
    { adminId: ids[0], digest: first },
    { adminId: ids[1], digest: second },
  ];
}

export function formatAdminAuthHashes(credentials: readonly AdminCredential[]): string {
  return credentials.map((credential) => `${credential.adminId}:${credential.digest.toString('hex')}`).join(',');
}
