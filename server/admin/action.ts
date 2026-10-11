import { canonicalJson } from '../db/canonicalJson';
import { AdminAuditService, type AdminAuditRecord } from '../db/audit';
import type { Database, Queryable } from '../db/types';
import { DatabaseDisabledError, IdempotencyConflictError, IdempotencyPendingError, IdempotencyValidationError } from '../db/errors';
import { IdempotencyService } from '../db/idempotency';
import { parseUuid } from '../db/uuid';
import { serverLog } from '../log';
import { AdminActionValidationError, AdminControlDisabledError, AdminIdentityError } from './errors';
import { AdminIdentityPolicy } from './identity';

/**
 * Identity of an admin write, stored in the idempotency row:
 * - operation = action
 * - actor = adminId
 * - payload hash = targetType, targetId, reason, payload, serverMode, worldId
 *
 * A different action, admin, target, reason, or payload is a conflict.
 * Reason is part of the identity because it is mandatory audit context.
 */
export interface AdminActionRequest {
  readonly requestId: string;
  readonly adminId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly reason: string;
  readonly payload?: unknown;
  readonly serverMode?: string | null;
  readonly worldId?: string | null;
}

export class AdminActionService {
  private readonly idempotency: IdempotencyService;
  private readonly audit: AdminAuditService;

  constructor(
    private readonly database: Database,
    private readonly policy: AdminIdentityPolicy,
    deploymentId: string,
    audit?: AdminAuditService,
  ) {
    this.idempotency = new IdempotencyService(database, deploymentId);
    this.audit = audit ?? new AdminAuditService(database, deploymentId);
  }

  /**
   * One transaction claims the request, runs the callback, and appends the
   * success audit. If the audit insert throws, that transaction rolls back.
   * A thrown callback rolls the claim back and then appends a separate
   * success=false audit. That failure audit is observational.
   */
  async execute<T>(request: AdminActionRequest, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    this.policy.requireAdmin(request.adminId);
    if (!this.database.enabled) throw new DatabaseDisabledError();
    const prepared = prepareRequest(request);
    try {
      return await this.idempotency.execute({
        deploymentId: this.idempotency.deploymentId,
        requestId: prepared.requestId,
        operation: prepared.action,
        actorId: prepared.adminId,
        payload: prepared.identity,
      }, async (tx) => {
        const result = await fn(tx);
        await this.audit.append({
          requestId: prepared.requestId,
          adminId: prepared.adminId,
          action: prepared.action,
          targetType: prepared.targetType,
          targetId: prepared.targetId,
          reason: prepared.reason,
          serverMode: prepared.serverMode,
          worldId: prepared.worldId,
          success: true,
          metadata: { outcome: 'committed' },
        }, tx);
        return result;
      });
    } catch (error) {
      if (isIdentityError(error)) throw error;
      await this.recordFailure(prepared, error);
      throw error;
    }
  }

  async history(requestId: string): Promise<readonly AdminAuditRecord[]> {
    return this.audit.listByRequestId(requestId);
  }

  private async recordFailure(request: PreparedRequest, error: unknown): Promise<void> {
    try {
      await this.audit.append({
        requestId: request.requestId,
        adminId: request.adminId,
        action: request.action,
        targetType: request.targetType,
        targetId: request.targetId,
        reason: request.reason,
        serverMode: request.serverMode,
        worldId: request.worldId,
        success: false,
        metadata: safeErrorMetadata(error),
      });
    } catch (auditError) {
      const detail = auditError instanceof Error ? auditError.message : String(auditError);
      serverLog(`admin failure audit was not stored: ${detail}`, 'error');
    }
  }
}

interface PreparedRequest {
  readonly requestId: string;
  readonly adminId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly reason: string;
  readonly serverMode: string | null;
  readonly worldId: string | null;
  readonly identity: {
    readonly targetType: string;
    readonly targetId: string | null;
    readonly reason: string;
    readonly payload: unknown;
    readonly serverMode: string | null;
    readonly worldId: string | null;
  };
}

function prepareRequest(request: AdminActionRequest): PreparedRequest {
  const requestId = parseUuid(request.requestId);
  if (!requestId) throw new AdminActionValidationError('requestId must be a UUID');
  const action = required(request.action, 'action');
  const targetType = required(request.targetType, 'targetType');
  const reason = required(request.reason, 'reason');
  const adminId = required(request.adminId, 'adminId');
  const targetId = optional(request.targetId);
  const serverMode = optional(request.serverMode);
  const worldId = optional(request.worldId);
  if (request.payload !== undefined) {
    canonicalJson(request.payload);
  }
  return {
    requestId,
    adminId,
    action,
    targetType,
    targetId,
    reason,
    serverMode,
    worldId,
    identity: {
      targetType,
      targetId,
      reason,
      payload: request.payload ?? null,
      serverMode,
      worldId,
    },
  };
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AdminActionValidationError(`${field} must be non-empty`);
  }
  return value.trim();
}

function optional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AdminActionValidationError('optional admin field must be a string');
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isIdentityError(error: unknown): boolean {
  return error instanceof IdempotencyConflictError
    || error instanceof IdempotencyValidationError
    || error instanceof IdempotencyPendingError
    || error instanceof AdminActionValidationError
    || error instanceof AdminIdentityError
    || error instanceof AdminControlDisabledError
    || error instanceof DatabaseDisabledError;
}

function safeErrorMetadata(error: unknown): Record<string, unknown> {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code).slice(0, 64)
    : 'ERROR';
  const category = error instanceof Error ? error.name.slice(0, 80) : 'Error';
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]').slice(0, 300);
  return { errorCode: code, errorCategory: category, message };
}
