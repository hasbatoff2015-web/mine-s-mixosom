import { createHash } from 'node:crypto';
import { canonicalJson } from './canonicalJson';
import { IdempotencyConflictError, IdempotencyPendingError, IdempotencyValidationError } from './errors';
import type { Database, Queryable } from './types';
import { parseUuid } from './uuid';

const MAX_JSON_CHARS = 65_536;

/** Admin and other non-economy requests. Not a gameplay wallet. */
export const GLOBAL_REQUEST_SCOPE = 'global';

/** Isolates Anarchy, Survival, and Peaceful money requests from each other. */
export function economyRequestScope(serverMode: string): string {
  const mode = serverMode.trim();
  if (mode !== 'anarchy' && mode !== 'survival' && mode !== 'peaceful') {
    throw new IdempotencyValidationError('economy request scope requires anarchy, survival, or peaceful');
  }
  return `economy:${mode}`;
}

export const INSERT_IDEMPOTENCY_SQL = `INSERT INTO idempotency_requests (
  deployment_id, request_scope, request_id, operation, actor_id, payload_hash, state
) VALUES ($1, $2, $3::uuid, $4, $5, $6, 'in_progress')
ON CONFLICT (deployment_id, request_scope, request_id) DO NOTHING
RETURNING state`;

export const UPDATE_IDEMPOTENCY_COMMIT_SQL = `UPDATE idempotency_requests
SET state = 'committed', response = $4::jsonb, committed_at = NOW()
WHERE deployment_id = $1 AND request_scope = $2 AND request_id = $3::uuid AND state = 'in_progress'`;

export const SELECT_IDEMPOTENCY_SQL = `SELECT operation, actor_id, payload_hash, state, response
FROM idempotency_requests
WHERE deployment_id = $1 AND request_scope = $2 AND request_id = $3::uuid
FOR UPDATE`;

export interface IdempotencyRequest {
  readonly deploymentId: string;
  readonly requestId: string;
  readonly operation: string;
  readonly actorId: string;
  readonly payload: unknown;
}

interface IdempotencyRow {
  operation: string;
  actor_id: string;
  payload_hash: string;
  state: string;
  response: unknown;
}

/**
 * The claim, the callback, and the committed response share one transaction.
 * A retry with the same identity returns the stored response and does not call
 * the callback again. A rolled-back callback leaves no row, so it can be retried.
 * Concurrent duplicates block on the primary key until the winner commits.
 */
export class IdempotencyService {
  readonly deploymentId: string;
  readonly requestScope: string;

  constructor(
    private readonly database: Database,
    deploymentId: string,
    requestScope = GLOBAL_REQUEST_SCOPE,
  ) {
    const trimmed = deploymentId.trim();
    if (!trimmed) throw new IdempotencyValidationError('deployment id is required');
    const scope = requestScope.trim();
    if (!/^[a-z0-9:_-]{1,64}$/.test(scope)) {
      throw new IdempotencyValidationError('request scope is invalid');
    }
    this.deploymentId = trimmed;
    this.requestScope = scope;
  }

  async execute<T>(request: IdempotencyRequest, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const detailed = await this.executeDetailed(request, fn);
    return detailed.value;
  }

  /**
   * Same transaction as `execute`. `replayed` is true when the callback did not
   * run because this request was already committed. Callers use that to avoid
   * repeating a non-database side effect such as consuming an item.
   */
  async executeDetailed<T>(
    request: IdempotencyRequest,
    fn: (tx: Queryable) => Promise<T>,
  ): Promise<{ readonly replayed: boolean; readonly value: T }> {
    if (typeof request.deploymentId !== 'string' || request.deploymentId.trim() !== this.deploymentId) {
      throw new IdempotencyConflictError('deployment');
    }
    const requestId = parseUuid(request.requestId);
    if (!requestId) throw new IdempotencyValidationError('requestId must be a UUID');
    const operation = requireToken(request.operation, 'operation', 200);
    const actorId = requireToken(request.actorId, 'actorId', 128);
    const payloadHash = hashRequestPayload(request.payload);

    return this.database.transaction(async (tx) => {
      const claimed = await tx.query<{ state: string }>(INSERT_IDEMPOTENCY_SQL, [
        this.deploymentId,
        this.requestScope,
        requestId,
        operation,
        actorId,
        payloadHash,
      ]);
      if ((claimed.rowCount ?? 0) > 0) {
        const response = await fn(tx);
        const encoded = encodeResponse(response);
        const committed = await tx.query(UPDATE_IDEMPOTENCY_COMMIT_SQL, [
          this.deploymentId,
          this.requestScope,
          requestId,
          encoded,
        ]);
        if ((committed.rowCount ?? 0) !== 1) {
          throw new IdempotencyValidationError('idempotency claim could not be committed');
        }
        return { replayed: false, value: JSON.parse(encoded) as T };
      }

      const existing = await tx.query<IdempotencyRow>(SELECT_IDEMPOTENCY_SQL, [
        this.deploymentId,
        this.requestScope,
        requestId,
      ]);
      const row = existing.rows[0];
      if (!row) throw new IdempotencyPendingError();
      if (row.operation !== operation) throw new IdempotencyConflictError('operation');
      if (row.actor_id !== actorId) throw new IdempotencyConflictError('actor');
      if (row.payload_hash !== payloadHash) throw new IdempotencyConflictError('payload');
      if (row.state === 'in_progress') throw new IdempotencyPendingError();
      if (row.state !== 'committed') {
        throw new IdempotencyValidationError(`unexpected idempotency state ${row.state}`);
      }
      return { replayed: true, value: row.response as T };
    });
  }
}

function requireToken(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new IdempotencyValidationError(`${field} must be non-empty`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new IdempotencyValidationError(`${field} is too long`);
  return trimmed;
}

function hashRequestPayload(payload: unknown): string {
  let canonical: string;
  try {
    canonical = canonicalJson(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new IdempotencyValidationError(`payload is not canonical JSON (${detail})`);
  }
  if (canonical.length > MAX_JSON_CHARS) throw new IdempotencyValidationError('payload is too large');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function encodeResponse(response: unknown): string {
  let encoded: string;
  try {
    encoded = canonicalJson(response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new IdempotencyValidationError(`response is not canonical JSON (${detail})`);
  }
  if (encoded.length > MAX_JSON_CHARS) throw new IdempotencyValidationError('response is too large');
  return encoded;
}
