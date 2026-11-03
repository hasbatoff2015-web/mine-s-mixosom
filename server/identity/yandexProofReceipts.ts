import type { Database } from '../db/types';
import type { IdentityScope } from './providerLinksRepository';

export const SELECT_LEGACY_RECEIPT_SQL = `SELECT 1
FROM yandex_proof_receipts
WHERE deployment_id = $1
  AND proof_hash = $2
  AND server_mode = 'legacy'
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

export const PURGE_EXPIRED_RECEIPTS_SQL = `DELETE FROM yandex_proof_receipts
WHERE ctid IN (
  SELECT ctid FROM yandex_proof_receipts
  WHERE created_at < NOW() - make_interval(secs => $1)
  LIMIT 500
)`;

export type ProofReserveResult = 'reserved' | 'reused' | 'unavailable';

/**
 * Claims one resume attempt for this world scope.
 * A second claim of the same canonical proof in that scope gets `reused`.
 * Rows written by migration 0009 are marked legacy and block every mode.
 */
export async function reserveResumeProof(
  db: Database,
  scope: IdentityScope,
  proofHash: string,
  playerId: string,
  attemptId: string,
): Promise<ProofReserveResult> {
  if (!db.enabled) return 'unavailable';
  return db.transaction(async (tx) => {
    const legacy = await tx.query(SELECT_LEGACY_RECEIPT_SQL, [scope.deploymentId, proofHash]);
    if (legacy.rowCount > 0) return 'reused';
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

/** Marks a reservation consumed. Only the attempt that reserved it can do this. */
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

/** Deletes receipts older than the verifier can still accept, in small batches. */
export async function purgeExpiredReceipts(db: Database, olderThanSeconds: number): Promise<void> {
  if (!db.enabled || !Number.isFinite(olderThanSeconds) || olderThanSeconds < 60) return;
  await db.query(PURGE_EXPIRED_RECEIPTS_SQL, [Math.floor(olderThanSeconds)]);
}
