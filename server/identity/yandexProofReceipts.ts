import type { Database } from '../db/types';

export const INSERT_PROOF_RECEIPT_SQL = `INSERT INTO yandex_proof_receipts (
  deployment_id, proof_hash, player_id, purpose
) VALUES ($1, $2, $3::uuid, 'resume')
ON CONFLICT (deployment_id, proof_hash) DO NOTHING`;

export type ProofReceiptResult = 'consumed' | 'reused' | 'unavailable';

/** Records one resume use of a proof hash. The raw signature is not stored. */
export async function consumeResumeProof(
  db: Database,
  deploymentId: string,
  proofHash: string,
  playerId: string,
): Promise<ProofReceiptResult> {
  if (!db.enabled) return 'unavailable';
  const inserted = await db.query(INSERT_PROOF_RECEIPT_SQL, [deploymentId, proofHash, playerId]);
  return inserted.rowCount > 0 ? 'consumed' : 'reused';
}
