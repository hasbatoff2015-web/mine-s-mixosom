import type { Queryable } from '../db/types';
import { hashPayload } from '../db/canonicalJson';
import { parseUuid } from '../db/uuid';
import {
  canTransition,
  SettlementConflictError,
  SettlementTransitionError,
  type BeginSettlementInput,
  type SettlementKind,
  type SettlementPhase,
  type SettlementRow,
} from './types';

const INSERT_SQL = `INSERT INTO gameplay_settlements (
  deployment_id, economy_scope, world_id, settlement_id, kind, phase,
  request_id, payload, payload_hash
) VALUES ($1, $2, $3, $4::uuid, $5, 'PREPARED', $6::uuid, $7::jsonb, $8)
ON CONFLICT (deployment_id, economy_scope, settlement_id) DO NOTHING
RETURNING settlement_id`;

const READ_SQL = `SELECT settlement_id, deployment_id, economy_scope, world_id, kind, phase,
  request_id, payload, payload_hash, created_at, updated_at, completed_at, last_error_code
FROM gameplay_settlements
WHERE deployment_id = $1 AND economy_scope = $2 AND settlement_id = $3::uuid`;

const TRANSITION_SQL = `UPDATE gameplay_settlements
SET phase = $4,
    updated_at = NOW(),
    completed_at = CASE WHEN $4 IN ('COMPLETE', 'CANCELLED') THEN NOW() ELSE NULL END,
    last_error_code = $6
WHERE deployment_id = $1 AND economy_scope = $2 AND settlement_id = $3::uuid AND phase = $5`;

const LIST_OPEN_SQL = `SELECT settlement_id, deployment_id, economy_scope, world_id, kind, phase,
  request_id, payload, payload_hash, created_at, updated_at, completed_at, last_error_code
FROM gameplay_settlements
WHERE deployment_id = $1 AND economy_scope = $2 AND world_id = $3
  AND phase NOT IN ('COMPLETE', 'CANCELLED')
ORDER BY created_at ASC, settlement_id ASC`;

interface SettlementSqlRow {
  settlement_id: string;
  deployment_id: string;
  economy_scope: string;
  world_id: string;
  kind: string;
  phase: string;
  request_id: string | null;
  payload: unknown;
  payload_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  last_error_code: string | null;
}

export class PostgresSettlementRepository {
  constructor(
    private readonly deploymentId: string,
    private readonly economyScope: string,
    private readonly worldId: string,
  ) {}

  async begin(tx: Queryable, input: BeginSettlementInput): Promise<SettlementRow> {
    const settlementId = parseUuid(input.settlementId);
    if (!settlementId) throw new SettlementConflictError('settlement id must be a UUID');
    const payloadHash = hashPayload(input.payload);
    const requestId = input.requestId ? parseUuid(input.requestId) ?? null : null;
    const inserted = await tx.query(INSERT_SQL, [
      this.deploymentId,
      this.economyScope,
      this.worldId,
      settlementId,
      input.kind,
      requestId,
      JSON.stringify(input.payload),
      payloadHash,
    ]);
    const existing = await this.must(tx, settlementId);
    if ((inserted.rowCount ?? 0) === 0) {
      if (existing.kind !== input.kind || existing.payloadHash !== payloadHash) {
        throw new SettlementConflictError('settlement payload does not match');
      }
    }
    return existing;
  }

  async get(tx: Queryable, settlementId: string): Promise<SettlementRow | null> {
    const id = parseUuid(settlementId);
    if (!id) return null;
    const result = await tx.query<SettlementSqlRow>(READ_SQL, [this.deploymentId, this.economyScope, id]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async transition(
    tx: Queryable,
    settlementId: string,
    from: SettlementPhase,
    to: SettlementPhase,
    errorCode?: string,
  ): Promise<SettlementRow> {
    if (!canTransition(from, to)) throw new SettlementTransitionError(`${from} -> ${to}`);
    const id = parseUuid(settlementId);
    if (!id) throw new SettlementConflictError('settlement id must be a UUID');
    const updated = await tx.query(TRANSITION_SQL, [
      this.deploymentId,
      this.economyScope,
      id,
      to,
      from,
      errorCode ?? null,
    ]);
    if ((updated.rowCount ?? 0) !== 1) throw new SettlementTransitionError(`${from} -> ${to}`);
    return this.must(tx, id);
  }

  async listOpen(tx: Queryable): Promise<readonly SettlementRow[]> {
    const result = await tx.query<SettlementSqlRow>(LIST_OPEN_SQL, [
      this.deploymentId,
      this.economyScope,
      this.worldId,
    ]);
    return result.rows.map(mapRow);
  }

  private async must(tx: Queryable, settlementId: string): Promise<SettlementRow> {
    const row = await this.get(tx, settlementId);
    if (!row) throw new SettlementConflictError('settlement disappeared');
    return row;
  }
}

function mapRow(row: SettlementSqlRow): SettlementRow {
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : {};
  return {
    settlementId: row.settlement_id,
    deploymentId: row.deployment_id,
    economyScope: row.economy_scope,
    worldId: row.world_id,
    kind: row.kind as SettlementKind,
    phase: row.phase as SettlementPhase,
    requestId: row.request_id,
    payload,
    payloadHash: row.payload_hash,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    lastErrorCode: row.last_error_code,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
