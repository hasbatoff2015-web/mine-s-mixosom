import { randomUUID } from 'node:crypto';
import { canonicalJson } from './canonicalJson';
import { AdminAuditValidationError } from './errors';
import type { Database, Queryable } from './types';
import { parseUuid } from './uuid';

export const INSERT_ADMIN_AUDIT_SQL = `INSERT INTO admin_audit_log (
  event_id, deployment_id, request_id, admin_id, action, target_type, target_id,
  reason, server_mode, world_id, success, metadata
) VALUES (
  $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
)
RETURNING event_id, deployment_id, request_id, admin_id, action, target_type, target_id,
  reason, server_mode, world_id, success, metadata, created_at`;

export const SELECT_ADMIN_AUDIT_BY_REQUEST_SQL = `SELECT event_id, deployment_id, request_id, admin_id, action, target_type, target_id,
  reason, server_mode, world_id, success, metadata, created_at
FROM admin_audit_log
WHERE deployment_id = $1 AND request_id = $2::uuid
ORDER BY created_at ASC, event_id ASC`;

export const SELECT_ADMIN_AUDIT_RECENT_SQL = `SELECT event_id, deployment_id, request_id, admin_id, action, target_type, target_id,
  reason, server_mode, world_id, success, metadata, created_at
FROM admin_audit_log
WHERE deployment_id = $1
  AND ($2::timestamptz IS NULL OR (created_at, event_id) < ($2::timestamptz, $3::uuid))
ORDER BY created_at DESC, event_id DESC
LIMIT $4`;

export interface AdminAuditInput {
  readonly requestId: string;
  readonly adminId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly reason: string;
  readonly serverMode?: string | null;
  readonly worldId?: string | null;
  readonly success: boolean;
  readonly metadata?: unknown;
}

export interface AdminAuditRecord {
  readonly eventId: string;
  readonly deploymentId: string;
  readonly requestId: string;
  readonly adminId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly reason: string;
  readonly serverMode: string | null;
  readonly worldId: string | null;
  readonly success: boolean;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

interface AdminAuditRow {
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
  created_at: Date | string;
}

/**
 * Append-only admin audit. There is no update or delete method.
 * Pass `tx` when the audit row must commit with another authoritative write.
 */
export class AdminAuditService {
  readonly deploymentId: string;

  constructor(
    private readonly database: Database,
    deploymentId: string,
  ) {
    const trimmed = deploymentId.trim();
    if (!trimmed) throw new AdminAuditValidationError('deployment id is required');
    this.deploymentId = trimmed;
  }

  async append(input: AdminAuditInput, tx?: Queryable): Promise<AdminAuditRecord> {
    const prepared = prepareAudit(this.deploymentId, input);
    const write = async (queryable: Queryable): Promise<AdminAuditRecord> => {
      const inserted = await queryable.query<AdminAuditRow>(INSERT_ADMIN_AUDIT_SQL, [
        prepared.eventId,
        prepared.deploymentId,
        prepared.requestId,
        prepared.adminId,
        prepared.action,
        prepared.targetType,
        prepared.targetId,
        prepared.reason,
        prepared.serverMode,
        prepared.worldId,
        prepared.success,
        prepared.metadataJson,
      ]);
      const row = inserted.rows[0];
      if (!row || inserted.rowCount !== 1) {
        throw new AdminAuditValidationError('audit insert did not return a row');
      }
      return mapAuditRow(row);
    };
    if (tx) return write(tx);
    return this.database.transaction(write);
  }

  /** Every immutable attempt for one logical request, oldest first. */
  async listByRequestId(requestId: string, tx?: Queryable): Promise<readonly AdminAuditRecord[]> {
    const rows = await this.readRequest(requestId, tx);
    return rows.map(mapAuditRow);
  }

  /**
   * Newest rows for this deployment only. `before` is the cursor from the
   * previous page. The existing (deployment_id, created_at) index covers it.
   */
  async listRecent(limit: number, before?: { readonly createdAt: string; readonly eventId: string } | null): Promise<readonly AdminAuditRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 40) {
      throw new AdminAuditValidationError('audit limit is outside 1..40');
    }
    const createdAt = before?.createdAt ?? null;
    const eventId = before?.eventId ? parseUuid(before.eventId) : null;
    if (before && (!createdAt || !eventId)) throw new AdminAuditValidationError('audit cursor is invalid');
    const found = await this.database.query<AdminAuditRow>(SELECT_ADMIN_AUDIT_RECENT_SQL, [
      this.deploymentId,
      createdAt,
      eventId,
      limit,
    ]);
    return found.rows.map(mapAuditRow);
  }

  /** The newest attempt, or null when this request has no audit rows. */
  async getLatestByRequestId(requestId: string, tx?: Queryable): Promise<AdminAuditRecord | null> {
    const rows = await this.readRequest(requestId, tx);
    const row = rows[rows.length - 1];
    return row ? mapAuditRow(row) : null;
  }

  private async readRequest(requestId: string, tx?: Queryable): Promise<readonly AdminAuditRow[]> {
    const parsed = parseUuid(requestId);
    if (!parsed) throw new AdminAuditValidationError('requestId must be a UUID');
    const queryable = tx ?? this.database;
    const found = await queryable.query<AdminAuditRow>(SELECT_ADMIN_AUDIT_BY_REQUEST_SQL, [
      this.deploymentId,
      parsed,
    ]);
    return found.rows;
  }
}

interface PreparedAudit {
  readonly eventId: string;
  readonly deploymentId: string;
  readonly requestId: string;
  readonly adminId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly reason: string;
  readonly serverMode: string | null;
  readonly worldId: string | null;
  readonly success: boolean;
  readonly metadataJson: string;
}

function prepareAudit(deploymentId: string, input: AdminAuditInput): PreparedAudit {
  const requestId = parseUuid(input.requestId);
  if (!requestId) throw new AdminAuditValidationError('requestId must be a UUID');
  return {
    eventId: randomUUID(),
    deploymentId,
    requestId,
    adminId: requireText(input.adminId, 'adminId', 128),
    action: requireText(input.action, 'action', 200),
    targetType: requireText(input.targetType, 'targetType', 128),
    targetId: optionalText(input.targetId, 'targetId', 256),
    reason: requireText(input.reason, 'reason', 4000),
    serverMode: optionalText(input.serverMode, 'serverMode', 32),
    worldId: optionalText(input.worldId, 'worldId', 128),
    success: requireBoolean(input.success),
    metadataJson: metadataJson(input.metadata),
  };
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AdminAuditValidationError(`${field} must be non-empty`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new AdminAuditValidationError(`${field} is too long`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AdminAuditValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw new AdminAuditValidationError(`${field} is too long`);
  return trimmed;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AdminAuditValidationError('success must be a boolean');
  return value;
}

function metadataJson(metadata: unknown): string {
  const value = metadata === undefined ? {} : metadata;
  let encoded: string;
  try {
    encoded = canonicalJson(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AdminAuditValidationError(`metadata is not canonical JSON (${detail})`);
  }
  if (!encoded.startsWith('{')) throw new AdminAuditValidationError('metadata must be a JSON object');
  if (encoded.length > 16_000) throw new AdminAuditValidationError('metadata is too large');
  return encoded;
}

function mapAuditRow(row: AdminAuditRow): AdminAuditRecord {
  const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  return {
    eventId: String(row.event_id),
    deploymentId: row.deployment_id,
    requestId: String(row.request_id),
    adminId: row.admin_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    serverMode: row.server_mode,
    worldId: row.world_id,
    success: row.success === true,
    metadata,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}
