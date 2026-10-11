import { DatabaseDisabledError } from '../db/errors';
import type { Database, Queryable } from '../db/types';
import { parseUuid } from '../db/uuid';
import { ECONOMY_MAX_BALANCE } from '../services/economy';
import { EconomyValidationError } from './errors';
import { PostgresEconomyRepository } from './postgresRepository';
import type { EconomyRepository } from './repository';
import {
  ECONOMY_HISTORY_DEFAULT_LIMIT,
  ECONOMY_HISTORY_MAX_LIMIT,
  ECONOMY_TIMESTAMP_TEXT,
  type EconomyAccount,
  type EconomyAdjustment,
  type EconomyHistoryPage,
  type EconomyHistoryQuery,
  type EconomyMutation,
  type EconomyOperationView,
  type EconomyReconciliation,
  type EconomySetBalanceInput,
  type EconomySource,
  type EconomyFractionInput,
  type EconomyTransferInput,
  type EconomyWriteInput,
  type EnsureAccountInput,
} from './types';

const REASON_TEXT = /^[A-Z][A-Z0-9_]{0,63}$/;
const METADATA_LIMIT = 65_536;

/**
 * PostgreSQL Megacoin core. Gameplay still uses the synchronous JSON
 * `EconomyService`. This class is not called from rewards, auction, trade,
 * clans, or the buyer.
 *
 * Pass the `tx` from `IdempotencyService.execute` when a command should commit
 * the request row, the economic operation, and the ledger legs together.
 * Calling these methods without that wrapper still posts exactly one operation
 * per successful call. Source identity stops the same mob death or listing
 * from paying twice. Request identity does not.
 */
export class MegacoinService {
  readonly deploymentId: string;
  private readonly repository: EconomyRepository;

  constructor(
    private readonly database: Database,
    deploymentId: string,
    repository?: EconomyRepository,
  ) {
    const id = deploymentId.trim();
    if (id.length === 0) throw new EconomyValidationError('deployment id is required');
    if (database.deploymentId !== null && database.deploymentId !== id) {
      throw new EconomyValidationError('deployment id does not match the database');
    }
    this.deploymentId = id;
    this.repository = repository ?? new PostgresEconomyRepository(id);
  }

  async ensureAccount(input: EnsureAccountInput, tx?: Queryable): Promise<EconomyAccount> {
    const parsed = {
      playerId: parsePlayerId(input.playerId),
      displayName: parseDisplayName(input.displayName),
    };
    return this.run(tx, (db) => this.repository.ensureAccount(db, parsed));
  }

  async getAccount(playerId: string, tx?: Queryable): Promise<EconomyAccount | null> {
    const id = parsePlayerId(playerId);
    return this.run(tx, (db) => this.repository.getAccount(db, id));
  }

  /** Does not create an account and does not mint the opening 100. */
  async getBalance(playerId: string, tx?: Queryable): Promise<number | null> {
    const account = await this.getAccount(playerId, tx);
    return account?.balance ?? null;
  }

  async credit(input: EconomyWriteInput, tx?: Queryable): Promise<EconomyMutation> {
    const parsed = parseWrite(input);
    return this.run(tx, (db) => this.repository.credit(db, parsed));
  }

  async debit(input: EconomyWriteInput, tx?: Queryable): Promise<EconomyMutation> {
    const parsed = parseWrite(input);
    return this.run(tx, (db) => this.repository.debit(db, parsed));
  }

  async transfer(input: EconomyTransferInput, tx?: Queryable): Promise<EconomyMutation> {
    const fromPlayerId = parsePlayerId(input.fromPlayerId);
    const toPlayerId = parsePlayerId(input.toPlayerId);
    if (fromPlayerId === toPlayerId) throw new EconomyValidationError('transfer requires two players');
    const parsed: EconomyTransferInput = {
      fromPlayerId,
      toPlayerId,
      ...(input.fromDisplayName !== undefined ? { fromDisplayName: parseDisplayName(input.fromDisplayName) } : {}),
      ...(input.toDisplayName !== undefined ? { toDisplayName: parseDisplayName(input.toDisplayName) } : {}),
      amount: parsePositiveAmount(input.amount),
      reason: parseReason(input.reason),
      ...(input.debitReason !== undefined ? { debitReason: parseReason(input.debitReason) } : {}),
      ...(input.creditReason !== undefined ? { creditReason: parseReason(input.creditReason) } : {}),
      ...optionalActor(input.actorId),
      ...optionalSource(input.source),
      ...optionalRequest(input.requestId),
      metadata: parseMetadata(input.metadata),
    };
    return this.run(tx, (db) => this.repository.transfer(db, parsed));
  }

  /**
   * Locks the sender and moves the floored share. Retries of the same source
   * return the original amount. They do not read a newer balance and pay again.
   */
  async transferFraction(input: EconomyFractionInput, tx?: Queryable): Promise<EconomyMutation & { readonly amount: number }> {
    const fromPlayerId = parsePlayerId(input.fromPlayerId);
    const toPlayerId = parsePlayerId(input.toPlayerId);
    if (fromPlayerId === toPlayerId) throw new EconomyValidationError('transfer requires two players');
    if (!Number.isSafeInteger(input.numerator) || input.numerator < 1
      || !Number.isSafeInteger(input.denominator) || input.denominator < 1
      || input.numerator > input.denominator) {
      throw new EconomyValidationError('share must be a positive integer fraction');
    }
    const parsed: EconomyFractionInput = {
      fromPlayerId,
      toPlayerId,
      ...(input.fromDisplayName !== undefined ? { fromDisplayName: parseDisplayName(input.fromDisplayName) } : {}),
      ...(input.toDisplayName !== undefined ? { toDisplayName: parseDisplayName(input.toDisplayName) } : {}),
      numerator: input.numerator,
      denominator: input.denominator,
      reason: parseReason(input.reason),
      ...optionalActor(input.actorId),
      ...optionalSource(input.source),
      ...optionalRequest(input.requestId),
      metadata: parseMetadata(input.metadata),
    };
    return this.run(tx, (db) => this.repository.transferFraction(db, parsed));
  }

  async listTop(limit: number, tx?: Queryable): Promise<readonly EconomyAccount[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new EconomyValidationError('leaderboard limit is outside 1..50');
    }
    return this.run(tx, (db) => this.repository.listTop(db, limit));
  }

  async setBalance(input: EconomySetBalanceInput, tx?: Queryable): Promise<EconomyAdjustment> {
    if (!Number.isSafeInteger(input.balance) || input.balance < 0 || input.balance > ECONOMY_MAX_BALANCE) {
      throw new EconomyValidationError('balance must be an integer from 0 to the maximum');
    }
    const parsed: EconomySetBalanceInput = {
      playerId: parsePlayerId(input.playerId),
      ...(input.displayName !== undefined ? { displayName: parseDisplayName(input.displayName) } : {}),
      balance: input.balance,
      reason: parseReason(input.reason ?? 'ADMIN_SET'),
      ...optionalActor(input.actorId),
      ...optionalSource(input.source),
      ...optionalRequest(input.requestId),
      metadata: parseMetadata(input.metadata),
    };
    return this.run(tx, (db) => this.repository.setBalance(db, parsed));
  }

  async history(query: EconomyHistoryQuery, tx?: Queryable): Promise<EconomyHistoryPage> {
    if (query.before && query.after) throw new EconomyValidationError('history accepts one cursor');
    const parsed: EconomyHistoryQuery = {
      playerId: parsePlayerId(query.playerId),
      limit: parseLimit(query.limit),
      ...(query.before ? { before: parseCursor(query.before.createdAt, query.before.entryId) } : {}),
      ...(query.after ? { after: parseCursor(query.after.createdAt, query.after.entryId) } : {}),
    };
    return this.run(tx, (db) => this.repository.history(db, parsed));
  }

  async getOperation(operationId: string, tx?: Queryable): Promise<EconomyOperationView | null> {
    const id = parseUuid(operationId);
    if (!id) throw new EconomyValidationError('operationId must be a UUID');
    return this.run(tx, (db) => this.repository.getOperation(db, id));
  }

  async findBySource(sourceType: string, sourceId: string, tx?: Queryable): Promise<EconomyOperationView | null> {
    const source = parseSource({ type: sourceType, id: sourceId });
    return this.run(tx, (db) => this.repository.findBySource(db, source.type, source.id));
  }

  async listByRequestId(requestId: string, tx?: Queryable): Promise<readonly EconomyOperationView[]> {
    const id = parseUuid(requestId);
    if (!id) throw new EconomyValidationError('requestId must be a UUID');
    return this.run(tx, (db) => this.repository.listByRequestId(db, id));
  }

  /** Reports whether the ledger sum matches the account. It does not change either. */
  async reconcile(playerId: string, tx?: Queryable): Promise<EconomyReconciliation> {
    const id = parsePlayerId(playerId);
    return this.run(tx, (db) => this.repository.reconcile(db, id));
  }

  private async run<T>(tx: Queryable | undefined, fn: (db: Queryable) => Promise<T>): Promise<T> {
    if (!this.database.enabled) throw new DatabaseDisabledError();
    if (tx) return fn(tx);
    return this.database.transaction(fn);
  }
}

function parseWrite(input: EconomyWriteInput): EconomyWriteInput {
  return {
    playerId: parsePlayerId(input.playerId),
    ...(input.displayName !== undefined ? { displayName: parseDisplayName(input.displayName) } : {}),
    amount: parsePositiveAmount(input.amount),
    reason: parseReason(input.reason),
    ...optionalActor(input.actorId),
    ...optionalSource(input.source),
    ...optionalRequest(input.requestId),
    metadata: parseMetadata(input.metadata),
  };
}

function parsePlayerId(value: unknown): string {
  return requireToken(value, 'playerId', 128);
}

function parseDisplayName(value: unknown): string {
  return requireToken(value, 'displayName', 64);
}

function parsePositiveAmount(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1 || value > ECONOMY_MAX_BALANCE) {
    throw new EconomyValidationError('amount must be a positive integer within the balance maximum');
  }
  return value;
}

function parseReason(value: unknown): EconomyWriteInput['reason'] {
  if (typeof value !== 'string' || !REASON_TEXT.test(value) || value === 'INITIAL') {
    throw new EconomyValidationError('reason must be an uppercase token');
  }
  return value;
}

function parseLimit(value: number | undefined): number {
  if (value === undefined) return ECONOMY_HISTORY_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > ECONOMY_HISTORY_MAX_LIMIT) {
    throw new EconomyValidationError('history limit is outside 1..100');
  }
  return value;
}

function parseCursor(createdAt: string, entryId: string): { createdAt: string; entryId: string } {
  const id = parseUuid(entryId);
  if (!id) throw new EconomyValidationError('history cursor entryId must be a UUID');
  if (!ECONOMY_TIMESTAMP_TEXT.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
    throw new EconomyValidationError('history cursor createdAt is invalid');
  }
  return { createdAt, entryId: id };
}

function optionalActor(value: string | undefined): { actorId: string } | Record<string, never> {
  if (value === undefined) return {};
  return { actorId: requireToken(value, 'actorId', 128) };
}

function optionalRequest(value: string | undefined): { requestId: string } | Record<string, never> {
  if (value === undefined) return {};
  const id = parseUuid(value);
  if (!id) throw new EconomyValidationError('requestId must be a UUID');
  return { requestId: id };
}

function optionalSource(value: EconomySource | undefined): { source: EconomySource } | Record<string, never> {
  if (value === undefined) return {};
  return { source: parseSource(value) };
}

function parseSource(value: EconomySource): EconomySource {
  return {
    type: requireToken(value?.type, 'sourceType', 64),
    id: requireToken(value?.id, 'sourceId', 256),
  };
}

function parseMetadata(value: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EconomyValidationError('metadata must be an object');
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new EconomyValidationError('metadata is not JSON');
  }
  if (!encoded.startsWith('{') || encoded.length > METADATA_LIMIT) {
    throw new EconomyValidationError('metadata must be an object');
  }
  return value as Record<string, unknown>;
}

function requireToken(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new EconomyValidationError(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) throw new EconomyValidationError(`${field} length is invalid`);
  return trimmed;
}
