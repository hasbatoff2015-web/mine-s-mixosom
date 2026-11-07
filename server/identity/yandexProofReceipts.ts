import type { Database } from '../db/types';
import type { IdentityScope } from './providerLinksRepository';

/**
 * Rows created before migration 0010 stored SHA-256 of the raw proof string
 * and were backfilled as server_mode `legacy`. `$2` must be that string hash,
 * computed from a proof this process already verified. It is not a client field
 * and it is not the current canonical fingerprint.
 */
export const SELECT_LEGACY_RECEIPT_SQL = `SELECT 1
FROM yandex_proof_receipts
WHERE deployment_id = $1
  AND proof_hash = $2
  AND server_mode = 'legacy'
LIMIT 1`;

/** Current-scope receipt. A row means this proof was already reserved or consumed here. */
export const SELECT_PROOF_RECEIPT_SQL = `SELECT state, player_id
FROM yandex_proof_receipts
WHERE deployment_id = $1
  AND server_mode = $2
  AND world_id = $3
  AND proof_hash = $4
LIMIT 1`;

export const INSERT_PROOF_RESERVATION_SQL = `INSERT INTO yandex_proof_receipts (
  deployment_id, server_mode, world_id, proof_hash, player_id, purpose, state, attempt_id
) VALUES ($1, $2, $3, $4, $5::uuid, 'resume', 'reserved', $6::uuid)
ON CONFLICT (deployment_id, server_mode, world_id, proof_hash) DO NOTHING`;

export const CONSUME_PROOF_RESERVATION_SQL = `UPDATE yandex_proof_receipts
SET state = 'consumed'
WHERE deployment_id = $1
  AND server_mode = $2
  AND world_id = $3
  AND proof_hash = $4
  AND state = 'reserved'
  AND attempt_id = $5::uuid`;

export const RELEASE_PROOF_RESERVATION_SQL = `DELETE FROM yandex_proof_receipts
WHERE deployment_id = $1
  AND server_mode = $2
  AND world_id = $3
  AND proof_hash = $4
  AND state = 'reserved'
  AND attempt_id = $5::uuid`;

/**
 * One deployment, mode, and world. `FOR UPDATE SKIP LOCKED` lets two servers
 * purge different batches without waiting on each other. Rows younger than
 * `$1` seconds stay, including a reservation that can still matter.
 */
export const PURGE_EXPIRED_RECEIPTS_SQL = `DELETE FROM yandex_proof_receipts
WHERE ctid IN (
  SELECT ctid FROM yandex_proof_receipts
  WHERE deployment_id = $2
    AND server_mode = $3
    AND world_id = $4
    AND created_at < NOW() - make_interval(secs => $1)
  ORDER BY created_at
  LIMIT 500
  FOR UPDATE SKIP LOCKED
)`;

/** Largest age and skew the process will accept. A shorter local config must not purge sooner. */
export const YANDEX_RECEIPT_MAX_AGE_SECONDS = 3600;
export const YANDEX_RECEIPT_MAX_SKEW_SECONDS = 600;
/** Extra hour after the longest verifier window. */
export const YANDEX_RECEIPT_PURGE_MARGIN_SECONDS = 3600;

export type ProofReserveResult = 'reserved' | 'reused' | 'unavailable';

export function receiptRetentionSeconds(maxAgeSeconds: number, clockSkewSeconds: number): number {
  const local = Math.max(0, maxAgeSeconds) + Math.max(0, clockSkewSeconds);
  const longest = Math.max(local, YANDEX_RECEIPT_MAX_AGE_SECONDS + YANDEX_RECEIPT_MAX_SKEW_SECONDS);
  return longest + YANDEX_RECEIPT_PURGE_MARGIN_SECONDS;
}

/**
 * Claims one resume attempt for this world scope.
 * A second claim of the same canonical proof in that scope gets `reused`.
 * A legacy row blocks that proof only when its stored hash is the verified
 * proof's old string hash. The new row is always the canonical fingerprint.
 */
/**
 * Whether this verified proof already has a receipt in the scope.
 * `reused` blocks a second character. It does not by itself choose a UUID.
 */
export async function readProofReceipt(
  db: Database,
  scope: IdentityScope,
  proofHash: string,
  legacyFingerprint?: string,
): Promise<'free' | 'reused' | 'unavailable'> {
  if (!db.enabled) return 'unavailable';
  return db.transaction(async (tx) => {
    if (legacyFingerprint && /^[0-9a-f]{64}$/.test(legacyFingerprint)) {
      const legacy = await tx.query(SELECT_LEGACY_RECEIPT_SQL, [scope.deploymentId, legacyFingerprint]);
      if (legacy.rowCount > 0) return 'reused';
    }
    const row = await tx.query(SELECT_PROOF_RECEIPT_SQL, [
      scope.deploymentId,
      scope.serverMode,
      scope.worldId,
      proofHash,
    ]);
    return row.rowCount > 0 ? 'reused' : 'free';
  });
}

export async function reserveResumeProof(
  db: Database,
  scope: IdentityScope,
  proofHash: string,
  playerId: string,
  attemptId: string,
  legacyFingerprint?: string,
): Promise<ProofReserveResult> {
  if (!db.enabled) return 'unavailable';
  return db.transaction(async (tx) => {
    if (legacyFingerprint && /^[0-9a-f]{64}$/.test(legacyFingerprint)) {
      const legacy = await tx.query(SELECT_LEGACY_RECEIPT_SQL, [scope.deploymentId, legacyFingerprint]);
      if (legacy.rowCount > 0) return 'reused';
    }
    const inserted = await tx.query(INSERT_PROOF_RESERVATION_SQL, [
      scope.deploymentId,
      scope.serverMode,
      scope.worldId,
      proofHash,
      playerId,
      attemptId,
    ]);
    return inserted.rowCount > 0 ? 'reserved' : 'reused';
  });
}

/**
 * Marks a reservation consumed. Only the attempt that reserved it can do this.
 * `false` means this statement changed no row. A thrown error does not say
 * whether the database committed.
 */
export async function consumeReservedProof(
  db: Database,
  scope: IdentityScope,
  proofHash: string,
  attemptId: string,
): Promise<boolean> {
  if (!db.enabled) return false;
  const updated = await db.query(CONSUME_PROOF_RESERVATION_SQL, [
    scope.deploymentId,
    scope.serverMode,
    scope.worldId,
    proofHash,
    attemptId,
  ]);
  return updated.rowCount > 0;
}

/**
 * Drops a reservation that never published a session.
 * A consumed row or another attempt id is left in place.
 * Do not call this after a consume whose outcome is unknown.
 */
export async function releaseReservedProof(
  db: Database,
  scope: IdentityScope,
  proofHash: string,
  attemptId: string,
): Promise<void> {
  if (!db.enabled) return;
  await db.query(RELEASE_PROOF_RESERVATION_SQL, [
    scope.deploymentId,
    scope.serverMode,
    scope.worldId,
    proofHash,
    attemptId,
  ]);
}

/** Deletes this scope's receipts older than the longest verifier window, in small batches. */
export async function purgeExpiredReceipts(
  db: Database,
  scope: IdentityScope,
  olderThanSeconds: number,
): Promise<void> {
  if (!db.enabled || !Number.isFinite(olderThanSeconds) || olderThanSeconds < 60) return;
  await db.query(PURGE_EXPIRED_RECEIPTS_SQL, [
    Math.floor(olderThanSeconds),
    scope.deploymentId,
    scope.serverMode,
    scope.worldId,
  ]);
}
