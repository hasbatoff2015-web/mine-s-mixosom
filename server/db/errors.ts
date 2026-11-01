export class DatabaseDisabledError extends Error {
  readonly code = 'DATABASE_DISABLED' as const;

  constructor() {
    super('PostgreSQL is disabled. Audit and idempotency require FC_DATABASE_URL and FC_DEPLOYMENT_ID.');
    this.name = 'DatabaseDisabledError';
  }
}

export class DatabaseNotReadyError extends Error {
  readonly code = 'DATABASE_NOT_READY' as const;

  constructor() {
    super('PostgreSQL is not ready.');
    this.name = 'DatabaseNotReadyError';
  }
}

export class DatabaseClosedError extends Error {
  readonly code = 'DATABASE_CLOSED' as const;

  constructor() {
    super('PostgreSQL pool is closed.');
    this.name = 'DatabaseClosedError';
  }
}

export class AdminAuditValidationError extends Error {
  readonly code = 'AUDIT_VALIDATION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AdminAuditValidationError';
  }
}

export class IdempotencyValidationError extends Error {
  readonly code = 'IDEMPOTENCY_VALIDATION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyValidationError';
  }
}

export type IdempotencyMismatch = 'deployment' | 'operation' | 'actor' | 'payload';

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;

  constructor(readonly mismatch: IdempotencyMismatch) {
    super(`idempotency conflict: ${mismatch}`);
    this.name = 'IdempotencyConflictError';
  }
}

/** A committed in-progress row should not exist. Do not run a second callback. */
export class IdempotencyPendingError extends Error {
  readonly code = 'IDEMPOTENCY_PENDING' as const;

  constructor() {
    super('idempotency request is still in progress');
    this.name = 'IdempotencyPendingError';
  }
}
