import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { ECONOMY_INITIAL_BALANCE, ECONOMY_MAX_BALANCE } from '../services/economy';
import {
  EconomyAccountNotFoundError,
  EconomyInsufficientError,
  EconomyLimitError,
  EconomySourceConflictError,
  EconomyValidationError,
} from './errors';
import type { EconomyRepository } from './repository';
import {
  ECONOMY_HISTORY_DEFAULT_LIMIT,
  ECONOMY_OPERATION_KINDS,
  ECONOMY_REQUEST_LOOKUP_LIMIT,
  ECONOMY_TIMESTAMP_TEXT,
  type EconomyAccount,
  type EconomyAdjustment,
  type EconomyFractionInput,
  type EconomyHistoryPage,
  type EconomyHistoryQuery,
  type EconomyLedgerEntry,
  type EconomyMutation,
  type EconomyOperationKind,
  type EconomyOperationView,
  type EconomyReconciliation,
  type EconomySetBalanceInput,
  type EconomySource,
  type EconomyTransferInput,
  type EconomyWriteInput,
  type EnsureAccountInput,
} from './types';

const INSERT_ACCOUNT_SQL = `INSERT INTO economy_accounts (
  deployment_id, economy_scope, player_id, balance, display_name
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (deployment_id, economy_scope, player_id) DO NOTHING
RETURNING player_id`;

const LOCK_ACCOUNT_SQL = `SELECT player_id, balance::text AS balance, display_name, created_at, updated_at
FROM economy_accounts
WHERE deployment_id = $1 AND economy_scope = $2 AND player_id = $3
FOR UPDATE`;

const READ_ACCOUNT_SQL = `SELECT player_id, balance::text AS balance, display_name, created_at, updated_at
FROM economy_accounts
WHERE deployment_id = $1 AND economy_scope = $2 AND player_id = $3`;

const UPDATE_BALANCE_SQL = `UPDATE economy_accounts
SET balance = $4, updated_at = NOW()
WHERE deployment_id = $1 AND economy_scope = $2 AND player_id = $3
RETURNING player_id, balance::text AS balance, display_name, created_at, updated_at`;

const UPDATE_NAME_SQL = `UPDATE economy_accounts
SET display_name = $4, updated_at = NOW()
WHERE deployment_id = $1 AND economy_scope = $2 AND player_id = $3
RETURNING player_id, balance::text AS balance, display_name, created_at, updated_at`;

const LIST_TOP_SQL = `SELECT player_id, balance::text AS balance, display_name, created_at, updated_at
FROM economy_accounts
WHERE deployment_id = $1 AND economy_scope = $2
ORDER BY balance DESC, display_name ASC, player_id ASC
LIMIT $3`;

const INSERT_OPERATION_SQL = `INSERT INTO economy_operations (
  deployment_id, economy_scope, operation_id, kind, actor_id, source_type, source_id, request_id, metadata
) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::uuid, $9::jsonb)
RETURNING operation_id`;

const INSERT_SOURCED_OPERATION_SQL = `INSERT INTO economy_operations (
  deployment_id, economy_scope, operation_id, kind, actor_id, source_type, source_id, request_id, metadata
) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::uuid, $9::jsonb)
ON CONFLICT (deployment_id, economy_scope, source_type, source_id)
WHERE source_type IS NOT NULL AND source_id IS NOT NULL
DO NOTHING
RETURNING operation_id`;

const INSERT_LEG_SQL = `INSERT INTO economy_ledger (
  entry_id, deployment_id, economy_scope, operation_id, leg_index, player_id,
  delta, balance_before, balance_after, reason, counterparty_player_id
) VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11)`;

const READ_OPERATION_SQL = `SELECT operation_id, kind, actor_id, source_type, source_id, request_id, metadata, created_at
FROM economy_operations
WHERE deployment_id = $1 AND economy_scope = $2 AND operation_id = $3::uuid`;

const READ_SOURCE_SQL = `SELECT operation_id, kind, actor_id, source_type, source_id, request_id, metadata, created_at
FROM economy_operations
WHERE deployment_id = $1 AND economy_scope = $2 AND source_type = $3 AND source_id = $4`;

const READ_REQUEST_SQL = `SELECT operation_id
FROM economy_operations
WHERE deployment_id = $1 AND economy_scope = $2 AND request_id = $3::uuid
ORDER BY created_at ASC, operation_id ASC
LIMIT $4`;

const LEDGER_TIME_SQL = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"."US"Z"')`;

const READ_LEGS_SQL = `SELECT entry_id, operation_id, leg_index, player_id, delta::text AS delta,
  balance_before::text AS balance_before, balance_after::text AS balance_after,
  reason, counterparty_player_id, ${LEDGER_TIME_SQL} AS created_at
FROM economy_ledger
WHERE deployment_id = $1 AND economy_scope = $2 AND operation_id = $3::uuid
ORDER BY leg_index ASC`;

const HISTORY_BEFORE_SQL = `SELECT entry_id, operation_id, leg_index, player_id, delta::text AS delta,
  balance_before::text AS balance_before, balance_after::text AS balance_after,
  reason, counterparty_player_id, ${LEDGER_TIME_SQL} AS created_at
FROM economy_ledger
WHERE deployment_id = $1 AND economy_scope = $2 AND player_id = $3
  AND ($4::timestamptz IS NULL OR (created_at, entry_id) < ($4::timestamptz, $5::uuid))
ORDER BY created_at DESC, entry_id DESC
LIMIT $6`;

const HISTORY_AFTER_SQL = `SELECT entry_id, operation_id, leg_index, player_id, delta::text AS delta,
  balance_before::text AS balance_before, balance_after::text AS balance_after,
  reason, counterparty_player_id, ${LEDGER_TIME_SQL} AS created_at
FROM economy_ledger
WHERE deployment_id = $1 AND economy_scope = $2 AND player_id = $3
  AND (created_at, entry_id) > ($4::timestamptz, $5::uuid)
ORDER BY created_at ASC, entry_id ASC
LIMIT $6`;

const RECONCILE_SUM_SQL = `SELECT COALESCE(SUM(delta), 0)::text AS total
FROM economy_ledger
WHERE deployment_id = $1 AND economy_scope = $2 AND player_id = $3`;

interface AccountRow {
  player_id: string;
  balance: string;
  display_name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OperationRow {
  operation_id: string;
  kind: string;
  actor_id: string | null;
  source_type: string | null;
  source_id: string | null;
  request_id: string | null;
  metadata: unknown;
  created_at: Date | string;
}

interface LegRow {
  entry_id: string;
  operation_id: string;
  leg_index: number;
  player_id: string;
  delta: string;
  balance_before: string;
  balance_after: string;
  reason: string;
  counterparty_player_id: string | null;
  created_at: Date | string;
}

interface ExpectedLeg {
  readonly playerId: string;
  readonly delta?: number;
  readonly balanceAfter?: number;
  readonly reason: string;
  readonly counterpartyPlayerId: string | null;
}

interface OperationInsert {
  readonly operationId: string;
  readonly kind: EconomyOperationKind;
  readonly actorId: string | null;
  readonly source: EconomySource | undefined;
  readonly requestId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class PostgresEconomyRepository implements EconomyRepository {
  constructor(
    private readonly deploymentId: string,
    private readonly economyScope: string,
  ) {}

  async ensureAccount(tx: Queryable, input: EnsureAccountInput): Promise<EconomyAccount> {
    const account = await this.lockAccount(tx, input.playerId, input.displayName);
    if (account.displayName === input.displayName) return account;
    return this.rename(tx, input.playerId, input.displayName);
  }

  async getAccount(tx: Queryable, playerId: string): Promise<EconomyAccount | null> {
    const result = await tx.query<AccountRow>(READ_ACCOUNT_SQL, [this.deploymentId, this.economyScope, playerId]);
    const row = result.rows[0];
    return row ? mapAccount(row, this.deploymentId) : null;
  }

  async credit(tx: Queryable, input: EconomyWriteInput): Promise<EconomyMutation> {
    return this.postSingle(tx, input, 'SOURCE', 1);
  }

  async debit(tx: Queryable, input: EconomyWriteInput): Promise<EconomyMutation> {
    return this.postSingle(tx, input, 'SINK', -1);
  }

  async transfer(tx: Queryable, input: EconomyTransferInput): Promise<EconomyMutation> {
    const fromName = nameFor(input.fromPlayerId, input.fromDisplayName);
    const toName = nameFor(input.toPlayerId, input.toDisplayName);
    // Code-unit order, not the transfer direction. A→B and B→A take the same locks.
    const fromFirst = input.fromPlayerId < input.toPlayerId;
    const first = await this.lockAccount(
      tx,
      fromFirst ? input.fromPlayerId : input.toPlayerId,
      fromFirst ? fromName : toName,
    );
    const second = await this.lockAccount(
      tx,
      fromFirst ? input.toPlayerId : input.fromPlayerId,
      fromFirst ? toName : fromName,
    );
    const from = fromFirst ? first : second;
    const to = fromFirst ? second : first;
    const operationId = randomUUID();
    const inserted = await this.insertOperation(tx, {
      operationId,
      kind: 'TRANSFER',
      actorId: input.actorId ?? null,
      source: input.source,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? {},
    });
    if (!inserted) {
      const existing = await this.requireSource(tx, input.source);
      assertSame(existing, 'TRANSFER', [
        {
          playerId: input.fromPlayerId,
          delta: -input.amount,
          reason: input.debitReason ?? input.reason,
          counterpartyPlayerId: input.toPlayerId,
        },
        {
          playerId: input.toPlayerId,
          delta: input.amount,
          reason: input.creditReason ?? input.reason,
          counterpartyPlayerId: input.fromPlayerId,
        },
      ]);
      return {
        replayed: true,
        operation: existing,
        accounts: [await this.mustAccount(tx, input.fromPlayerId), await this.mustAccount(tx, input.toPlayerId)],
      };
    }
    if (from.balance < input.amount) throw new EconomyInsufficientError();
    const toNext = to.balance + input.amount;
    if (toNext > ECONOMY_MAX_BALANCE) throw new EconomyLimitError();
    const fromAccount = await this.updateBalance(tx, from.playerId, from.balance - input.amount);
    const toAccount = await this.updateBalance(tx, to.playerId, toNext);
    await this.insertLeg(tx, operationId, 0, from.playerId, -input.amount, from.balance, input.debitReason ?? input.reason, to.playerId);
    await this.insertLeg(tx, operationId, 1, to.playerId, input.amount, to.balance, input.creditReason ?? input.reason, from.playerId);
    return {
      replayed: false,
      operation: await this.requireOperation(tx, operationId),
      accounts: [fromAccount, toAccount],
    };
  }

  /**
   * Setting the balance to its current value appends nothing.
   * A repeated source compares the original leg's balance_after to the requested
   * target and does not post a second adjustment.
   */
  /**
   * Locks the sender, then moves floor(balance * numerator / denominator).
   * The same source replays the original amount and does not recompute it.
   * A zero share still records the source so a later retry cannot pay.
   */
  async transferFraction(
    tx: Queryable,
    input: EconomyFractionInput,
  ): Promise<EconomyMutation & { readonly amount: number }> {
    if (input.source) {
      const existing = await this.findBySource(tx, input.source.type, input.source.id);
      if (existing) {
        return {
          replayed: true,
          operation: existing,
          accounts: [
            await this.mustAccount(tx, input.fromPlayerId),
            await this.mustAccount(tx, input.toPlayerId),
          ],
          amount: fractionAmount(existing),
        };
      }
    }
    const fromName = nameFor(input.fromPlayerId, input.fromDisplayName);
    const toName = nameFor(input.toPlayerId, input.toDisplayName);
    const fromFirst = input.fromPlayerId < input.toPlayerId;
    const first = await this.lockAccount(
      tx,
      fromFirst ? input.fromPlayerId : input.toPlayerId,
      fromFirst ? fromName : toName,
    );
    const second = await this.lockAccount(
      tx,
      fromFirst ? input.toPlayerId : input.fromPlayerId,
      fromFirst ? toName : fromName,
    );
    const from = fromFirst ? first : second;
    const to = fromFirst ? second : first;
    if (input.source) {
      const existing = await this.findBySource(tx, input.source.type, input.source.id);
      if (existing) {
        return {
          replayed: true,
          operation: existing,
          accounts: [from, to],
          amount: fractionAmount(existing),
        };
      }
    }
    const amount = Math.floor((from.balance * input.numerator) / input.denominator);
    const operationId = randomUUID();
    const inserted = await this.insertOperation(tx, {
      operationId,
      kind: 'TRANSFER',
      actorId: input.actorId ?? null,
      source: input.source,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? {},
    });
    if (!inserted) {
      const existing = await this.requireSource(tx, input.source);
      return {
        replayed: true,
        operation: existing,
        accounts: [await this.mustAccount(tx, input.fromPlayerId), await this.mustAccount(tx, input.toPlayerId)],
        amount: fractionAmount(existing),
      };
    }
    if (amount <= 0) {
      return {
        replayed: false,
        operation: await this.requireOperation(tx, operationId),
        accounts: [from, to],
        amount: 0,
      };
    }
    const toNext = to.balance + amount;
    if (toNext > ECONOMY_MAX_BALANCE) throw new EconomyLimitError();
    const fromAccount = await this.updateBalance(tx, from.playerId, from.balance - amount);
    const toAccount = await this.updateBalance(tx, to.playerId, toNext);
    await this.insertLeg(tx, operationId, 0, from.playerId, -amount, from.balance, input.reason, to.playerId);
    await this.insertLeg(tx, operationId, 1, to.playerId, amount, to.balance, input.reason, from.playerId);
    return {
      replayed: false,
      operation: await this.requireOperation(tx, operationId),
      accounts: [fromAccount, toAccount],
      amount,
    };
  }

  async updateDisplayName(tx: Queryable, playerId: string, displayName: string): Promise<EconomyAccount | null> {
    return this.rename(tx, playerId, displayName);
  }

  async listTop(tx: Queryable, limit: number): Promise<readonly EconomyAccount[]> {
    const result = await tx.query<AccountRow>(LIST_TOP_SQL, [this.deploymentId, this.economyScope, limit]);
    return result.rows.map((row) => mapAccount(row, this.deploymentId));
  }

  async setBalance(tx: Queryable, input: EconomySetBalanceInput): Promise<EconomyAdjustment> {
    const reason = input.reason ?? 'ADMIN_SET';
    const account = await this.lockAccount(tx, input.playerId, nameFor(input.playerId, input.displayName));
    if (input.source) {
      const existing = await this.findBySource(tx, input.source.type, input.source.id);
      if (existing) {
        assertSame(existing, 'ADJUSTMENT', [{
          playerId: input.playerId,
          balanceAfter: input.balance,
          reason,
          counterpartyPlayerId: null,
        }]);
        return {
          changed: false,
          replayed: true,
          account: await this.mustAccount(tx, input.playerId),
          operation: existing,
        };
      }
    }
    const delta = input.balance - account.balance;
    if (delta === 0) {
      return { changed: false, replayed: false, account, operation: null };
    }
    const operationId = randomUUID();
    const inserted = await this.insertOperation(tx, {
      operationId,
      kind: 'ADJUSTMENT',
      actorId: input.actorId ?? null,
      source: input.source,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? {},
    });
    if (!inserted) {
      const existing = await this.requireSource(tx, input.source);
      assertSame(existing, 'ADJUSTMENT', [{
        playerId: input.playerId,
        balanceAfter: input.balance,
        reason,
        counterpartyPlayerId: null,
      }]);
      return {
        changed: false,
        replayed: true,
        account: await this.mustAccount(tx, input.playerId),
        operation: existing,
      };
    }
    const updated = await this.updateBalance(tx, input.playerId, input.balance);
    await this.insertLeg(tx, operationId, 0, input.playerId, delta, account.balance, reason, null);
    return {
      changed: true,
      replayed: false,
      account: updated,
      operation: await this.requireOperation(tx, operationId),
    };
  }

  async history(tx: Queryable, query: EconomyHistoryQuery): Promise<EconomyHistoryPage> {
    const limit = query.limit ?? ECONOMY_HISTORY_DEFAULT_LIMIT;
    const params = query.after
      ? [this.deploymentId, this.economyScope, query.playerId, query.after.createdAt, query.after.entryId, limit + 1]
      : [this.deploymentId, this.economyScope, query.playerId, query.before?.createdAt ?? null, query.before?.entryId ?? null, limit + 1];
    const result = await tx.query<LegRow>(query.after ? HISTORY_AFTER_SQL : HISTORY_BEFORE_SQL, params);
    const page = result.rows.slice(0, limit).map(mapLeg);
    const last = page[page.length - 1];
    return {
      playerId: query.playerId,
      entries: page,
      nextCursor: result.rows.length > limit && last
        ? { createdAt: last.createdAt, entryId: last.entryId }
        : null,
    };
  }

  async getOperation(tx: Queryable, operationId: string): Promise<EconomyOperationView | null> {
    const result = await tx.query<OperationRow>(READ_OPERATION_SQL, [this.deploymentId, this.economyScope, operationId]);
    const row = result.rows[0];
    if (!row) return null;
    return this.withLegs(tx, row);
  }

  async findBySource(tx: Queryable, sourceType: string, sourceId: string): Promise<EconomyOperationView | null> {
    const result = await tx.query<OperationRow>(READ_SOURCE_SQL, [this.deploymentId, this.economyScope, sourceType, sourceId]);
    const row = result.rows[0];
    if (!row) return null;
    return this.withLegs(tx, row);
  }

  /** Records a zero-net source so a replay cannot pay later. No ledger leg is written. */
  async consumeSource(tx: Queryable, source: EconomySource): Promise<{ replayed: boolean }> {
    const existing = await this.findBySource(tx, source.type, source.id);
    if (existing) {
      if (existing.legs.length > 0) throw new EconomySourceConflictError();
      return { replayed: true };
    }
    const inserted = await this.insertOperation(tx, {
      operationId: randomUUID(),
      kind: 'TRANSFER',
      actorId: null,
      source,
      requestId: null,
      metadata: { net: 0 },
    });
    return { replayed: !inserted };
  }

  async listByRequestId(tx: Queryable, requestId: string): Promise<readonly EconomyOperationView[]> {
    const result = await tx.query<{ operation_id: string }>(READ_REQUEST_SQL, [
      this.deploymentId,
      this.economyScope,
      requestId,
      ECONOMY_REQUEST_LOOKUP_LIMIT + 1,
    ]);
    if (result.rows.length > ECONOMY_REQUEST_LOOKUP_LIMIT) {
      throw new EconomyValidationError('request has too many economic operations');
    }
    const views: EconomyOperationView[] = [];
    for (const row of result.rows) {
      const view = await this.getOperation(tx, row.operation_id);
      if (view) views.push(view);
    }
    return views;
  }

  async reconcile(tx: Queryable, playerId: string): Promise<EconomyReconciliation> {
    const locked = await tx.query<AccountRow>(LOCK_ACCOUNT_SQL, [this.deploymentId, this.economyScope, playerId]);
    const account = locked.rows[0];
    if (!account) throw new EconomyAccountNotFoundError();
    const sum = await tx.query<{ total: string }>(RECONCILE_SUM_SQL, [this.deploymentId, this.economyScope, playerId]);
    const balance = parseInteger(account.balance, 'balance');
    const ledgerTotal = parseInteger(sum.rows[0]?.total ?? '0', 'ledger total');
    return { playerId, balance, ledgerTotal, matches: balance === ledgerTotal };
  }

  private async postSingle(
    tx: Queryable,
    input: EconomyWriteInput,
    kind: 'SOURCE' | 'SINK',
    sign: 1 | -1,
  ): Promise<EconomyMutation> {
    const account = await this.lockAccount(tx, input.playerId, nameFor(input.playerId, input.displayName));
    const operationId = randomUUID();
    const delta = sign * input.amount;
    const inserted = await this.insertOperation(tx, {
      operationId,
      kind,
      actorId: input.actorId ?? null,
      source: input.source,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? {},
    });
    if (!inserted) {
      const existing = await this.requireSource(tx, input.source);
      assertSame(existing, kind, [{
        playerId: input.playerId,
        delta,
        reason: input.reason,
        counterpartyPlayerId: null,
      }]);
      return {
        replayed: true,
        operation: existing,
        accounts: [await this.mustAccount(tx, input.playerId)],
      };
    }
    if (sign < 0 && account.balance < input.amount) throw new EconomyInsufficientError();
    const next = account.balance + delta;
    if (next > ECONOMY_MAX_BALANCE || next < 0) throw new EconomyLimitError();
    const updated = await this.updateBalance(tx, input.playerId, next);
    await this.insertLeg(tx, operationId, 0, input.playerId, delta, account.balance, input.reason, null);
    return {
      replayed: false,
      operation: await this.requireOperation(tx, operationId),
      accounts: [updated],
    };
  }

  private async lockAccount(tx: Queryable, playerId: string, displayName: string): Promise<EconomyAccount> {
    const inserted = await tx.query(INSERT_ACCOUNT_SQL, [
      this.deploymentId,
      this.economyScope,
      playerId,
      ECONOMY_INITIAL_BALANCE,
      displayName,
    ]);
    const locked = await tx.query<AccountRow>(LOCK_ACCOUNT_SQL, [this.deploymentId, this.economyScope, playerId]);
    const row = locked.rows[0];
    if (!row) throw new EconomyValidationError('account missing after insert');
    if (inserted.rows.length > 0) await this.writeInitial(tx, playerId);
    return mapAccount(row, this.deploymentId);
  }

  private async writeInitial(tx: Queryable, playerId: string): Promise<void> {
    const operationId = randomUUID();
    const inserted = await this.insertOperation(tx, {
      operationId,
      kind: 'INITIAL',
      actorId: null,
      source: undefined,
      requestId: null,
      metadata: {},
    });
    if (!inserted) throw new EconomyValidationError('initial grant collided without a source');
    await this.insertLeg(
      tx,
      operationId,
      0,
      playerId,
      ECONOMY_INITIAL_BALANCE,
      0,
      'INITIAL',
      null,
    );
  }

  private async insertOperation(tx: Queryable, input: OperationInsert): Promise<boolean> {
    const params = [
      this.deploymentId,
      this.economyScope,
      input.operationId,
      input.kind,
      input.actorId,
      input.source?.type ?? null,
      input.source?.id ?? null,
      input.requestId,
      JSON.stringify(input.metadata),
    ];
    const sql = input.source ? INSERT_SOURCED_OPERATION_SQL : INSERT_OPERATION_SQL;
    const result = await tx.query(sql, params);
    return result.rows.length > 0;
  }

  private async insertLeg(
    tx: Queryable,
    operationId: string,
    legIndex: number,
    playerId: string,
    delta: number,
    balanceBefore: number,
    reason: string,
    counterpartyPlayerId: string | null,
  ): Promise<void> {
    const balanceAfter = balanceBefore + delta;
    await tx.query(INSERT_LEG_SQL, [
      randomUUID(),
      this.deploymentId,
      this.economyScope,
      operationId,
      legIndex,
      playerId,
      delta,
      balanceBefore,
      balanceAfter,
      reason,
      counterpartyPlayerId,
    ]);
  }

  private async rename(tx: Queryable, playerId: string, displayName: string): Promise<EconomyAccount> {
    const result = await tx.query<AccountRow>(UPDATE_NAME_SQL, [this.deploymentId, this.economyScope, playerId, displayName]);
    const row = result.rows[0];
    if (!row) throw new EconomyAccountNotFoundError();
    return mapAccount(row, this.deploymentId);
  }

  private async updateBalance(tx: Queryable, playerId: string, balance: number): Promise<EconomyAccount> {
    const result = await tx.query<AccountRow>(UPDATE_BALANCE_SQL, [this.deploymentId, this.economyScope, playerId, balance]);
    const row = result.rows[0];
    if (!row) throw new EconomyValidationError('account update missed');
    return mapAccount(row, this.deploymentId);
  }

  private async mustAccount(tx: Queryable, playerId: string): Promise<EconomyAccount> {
    const account = await this.getAccount(tx, playerId);
    if (!account) throw new EconomyAccountNotFoundError();
    return account;
  }

  private async requireOperation(tx: Queryable, operationId: string): Promise<EconomyOperationView> {
    const operation = await this.getOperation(tx, operationId);
    if (!operation) throw new EconomyValidationError('operation missing after insert');
    return operation;
  }

  private async requireSource(tx: Queryable, source: EconomySource | undefined): Promise<EconomyOperationView> {
    if (!source) throw new EconomyValidationError('source missing after conflict');
    const existing = await this.findBySource(tx, source.type, source.id);
    if (!existing) throw new EconomyValidationError('source operation missing after conflict');
    return existing;
  }

  private async withLegs(tx: Queryable, row: OperationRow): Promise<EconomyOperationView> {
    const legs = await tx.query<LegRow>(READ_LEGS_SQL, [this.deploymentId, this.economyScope, row.operation_id]);
    return mapOperation(row, legs.rows.map(mapLeg));
  }
}

function fractionAmount(operation: EconomyOperationView): number {
  const leg = operation.legs.find((entry) => entry.delta < 0) ?? operation.legs[0];
  return leg ? Math.abs(leg.delta) : 0;
}

function nameFor(playerId: string, displayName: string | undefined): string {
  if (displayName !== undefined) {
    const name = displayName.trim();
    if (name.length === 0 || name.length > 64) throw new EconomyValidationError('displayName length is invalid');
    return name;
  }
  const fallback = playerId.trim();
  if (fallback.length === 0) throw new EconomyValidationError('displayName length is invalid');
  // The insert-if-absent row must satisfy display_name's 64-character check
  // even when this player already exists and the supplied id is longer.
  return fallback.length <= 64 ? fallback : fallback.slice(0, 64);
}

function assertSame(
  existing: EconomyOperationView,
  kind: EconomyOperationKind,
  legs: readonly ExpectedLeg[],
): void {
  if (existing.kind !== kind || existing.legs.length !== legs.length) throw new EconomySourceConflictError();
  for (let index = 0; index < legs.length; index += 1) {
    const actual = existing.legs[index];
    const expected = legs[index];
    if (!actual || !expected) throw new EconomySourceConflictError();
    if (actual.playerId !== expected.playerId || actual.reason !== expected.reason) throw new EconomySourceConflictError();
    if ((actual.counterpartyPlayerId ?? null) !== expected.counterpartyPlayerId) throw new EconomySourceConflictError();
    if (expected.delta !== undefined && actual.delta !== expected.delta) throw new EconomySourceConflictError();
    if (expected.balanceAfter !== undefined && actual.balanceAfter !== expected.balanceAfter) {
      throw new EconomySourceConflictError();
    }
  }
}

function mapAccount(row: AccountRow, deploymentId: string): EconomyAccount {
  return {
    playerId: row.player_id,
    deploymentId,
    balance: parseInteger(row.balance, 'balance'),
    displayName: row.display_name,
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
  };
}

function mapOperation(row: OperationRow, legs: readonly EconomyLedgerEntry[]): EconomyOperationView {
  if (!(ECONOMY_OPERATION_KINDS as readonly string[]).includes(row.kind)) {
    throw new EconomyValidationError('operation kind is invalid');
  }
  return {
    operationId: row.operation_id,
    kind: row.kind as EconomyOperationKind,
    actorId: row.actor_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    requestId: row.request_id,
    metadata: readMetadata(row.metadata),
    createdAt: isoTime(row.created_at),
    legs,
  };
}

function mapLeg(row: LegRow): EconomyLedgerEntry {
  return {
    entryId: row.entry_id,
    operationId: row.operation_id,
    legIndex: row.leg_index,
    playerId: row.player_id,
    delta: parseInteger(row.delta, 'delta'),
    balanceBefore: parseInteger(row.balance_before, 'balance_before'),
    balanceAfter: parseInteger(row.balance_after, 'balance_after'),
    reason: row.reason,
    counterpartyPlayerId: row.counterparty_player_id,
    createdAt: isoTime(row.created_at),
  };
}

function parseInteger(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new EconomyValidationError(`${field} is not an integer`);
}

function isoTime(value: unknown): string {
  if (typeof value === 'string' && ECONOMY_TIMESTAMP_TEXT.test(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new EconomyValidationError('timestamp is invalid');
}

function readMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return readMetadata(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
