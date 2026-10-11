/**
 * Test double for Database. Production idempotency uses a real PostgreSQL
 * transaction. This queue only lets unit tests run without a server.
 */
import { DatabaseClosedError } from '../../../server/db/errors';
import {
  INSERT_ADMIN_AUDIT_SQL,
  SELECT_ADMIN_AUDIT_BY_REQUEST_SQL,
} from '../../../server/db/audit';
import {
  INSERT_IDEMPOTENCY_SQL,
  SELECT_IDEMPOTENCY_SQL,
  UPDATE_IDEMPOTENCY_COMMIT_SQL,
} from '../../../server/db/idempotency';
import type { Database, DbQueryResult, Queryable } from '../../../server/db/types';

interface AuditRow {
  event_id: string;
  deployment_id: string;
  request_id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string;
  server_mode: string | null;
  world_id: string | null;
  success: boolean;
  metadata: unknown;
  created_at: Date;
}

interface IdempotencyRecord {
  deployment_id: string;
  request_id: string;
  operation: string;
  actor_id: string;
  payload_hash: string;
  state: 'in_progress' | 'committed';
  response: unknown;
  committed_at: string | null;
}

interface MemoryState {
  audit: AuditRow[];
  idempotency: IdempotencyRecord[];
  probes: number;
}

function cloneState(state: MemoryState): MemoryState {
  return structuredClone(state);
}

export class MemoryDatabase implements Database {
  readonly enabled = true;
  readonly deploymentId: string;
  readonly appliedMigrations: readonly string[] = [];
  private state: MemoryState = { audit: [], idempotency: [], probes: 0 };
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(deploymentId = 'dev') {
    this.deploymentId = deploymentId;
  }

  async start(): Promise<void> {
    if (this.closed) throw new DatabaseClosedError();
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Visible in-progress row. execute() must not run the callback. */
  seedIdempotency(record: IdempotencyRecord): void {
    this.state.idempotency.push(structuredClone(record));
  }

  async query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<DbQueryResult<T>> {
    if (this.closed) throw new DatabaseClosedError();
    return this.execute<T>(this.state, sql, params);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    if (this.closed) throw new DatabaseClosedError();
    const run = this.chain.then(async () => {
      const snapshot = cloneState(this.state);
      const tx: Queryable = {
        query: (sql, params) => this.execute(this.state, sql, params),
      };
      try {
        return await fn(tx);
      } catch (error) {
        this.state = snapshot;
        throw error;
      }
    });
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async execute<T>(state: MemoryState, sql: string, params: readonly unknown[] = []): Promise<DbQueryResult<T>> {
    if (sql === INSERT_ADMIN_AUDIT_SQL) return this.insertAudit(state, params) as DbQueryResult<T>;
    if (sql === SELECT_ADMIN_AUDIT_BY_REQUEST_SQL) return this.selectAudit(state, params) as DbQueryResult<T>;
    if (sql === INSERT_IDEMPOTENCY_SQL) return this.insertIdempotency(state, params) as DbQueryResult<T>;
    if (sql === UPDATE_IDEMPOTENCY_COMMIT_SQL) return this.commitIdempotency(state, params) as DbQueryResult<T>;
    if (sql === SELECT_IDEMPOTENCY_SQL) return this.selectIdempotency(state, params) as DbQueryResult<T>;
    if (sql === 'INSERT INTO admin_action_probe DEFAULT VALUES') {
      state.probes += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql === 'SELECT probes FROM admin_action_probe') {
      return { rows: [{ n: state.probes } as T], rowCount: 1 };
    }
    throw new Error(`MemoryDatabase has no handler for SQL: ${sql.slice(0, 80)}`);
  }

  private insertAudit(state: MemoryState, params: readonly unknown[]): DbQueryResult<AuditRow> {
    const row: AuditRow = {
      event_id: String(params[0]),
      deployment_id: String(params[1]),
      request_id: String(params[2]),
      admin_id: String(params[3]),
      action: String(params[4]),
      target_type: String(params[5]),
      target_id: params[6] == null ? null : String(params[6]),
      reason: String(params[7]),
      server_mode: params[8] == null ? null : String(params[8]),
      world_id: params[9] == null ? null : String(params[9]),
      success: params[10] === true,
      metadata: JSON.parse(String(params[11])),
      created_at: new Date(),
    };
    state.audit.push(row);
    return { rows: [structuredClone(row)], rowCount: 1 };
  }

  private selectAudit(state: MemoryState, params: readonly unknown[]): DbQueryResult<AuditRow> {
    const deploymentId = String(params[0]);
    const requestId = String(params[1]);
    const rows = state.audit.filter((existing) => existing.deployment_id === deploymentId && existing.request_id === requestId);
    return { rows: rows.map((row) => structuredClone(row)), rowCount: rows.length };
  }

  private insertIdempotency(state: MemoryState, params: readonly unknown[]): DbQueryResult<{ state: string }> {
    const deploymentId = String(params[0]);
    const requestId = String(params[1]);
    const existing = state.idempotency.find((row) => row.deployment_id === deploymentId && row.request_id === requestId);
    if (existing) return { rows: [], rowCount: 0 };
    state.idempotency.push({
      deployment_id: deploymentId,
      request_id: requestId,
      operation: String(params[2]),
      actor_id: String(params[3]),
      payload_hash: String(params[4]),
      state: 'in_progress',
      response: null,
      committed_at: null,
    });
    return { rows: [{ state: 'in_progress' }], rowCount: 1 };
  }

  private commitIdempotency(state: MemoryState, params: readonly unknown[]): DbQueryResult {
    const deploymentId = String(params[0]);
    const requestId = String(params[1]);
    const row = state.idempotency.find((existing) => existing.deployment_id === deploymentId && existing.request_id === requestId);
    if (!row || row.state !== 'in_progress') return { rows: [], rowCount: 0 };
    row.state = 'committed';
    row.response = JSON.parse(String(params[2]));
    row.committed_at = new Date().toISOString();
    return { rows: [], rowCount: 1 };
  }

  private selectIdempotency(state: MemoryState, params: readonly unknown[]): DbQueryResult {
    const deploymentId = String(params[0]);
    const requestId = String(params[1]);
    const row = state.idempotency.find((existing) => existing.deployment_id === deploymentId && existing.request_id === requestId);
    if (!row) return { rows: [], rowCount: 0 };
    return {
      rows: [{
        operation: row.operation,
        actor_id: row.actor_id,
        payload_hash: row.payload_hash,
        state: row.state,
        response: structuredClone(row.response),
      }],
      rowCount: 1,
    };
  }
}
