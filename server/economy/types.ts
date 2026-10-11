/**
 * Three different identities. Stage 2B composes them. This module does not.
 *
 * Request identity is `IdempotencyService`: `(deployment_id, request_id)` plus
 * operation name, actor, and payload hash. A retried admin or gameplay command
 * returns the stored response. `economy_operations.request_id` only points at
 * that request. It is not unique and it does not decide whether money moves.
 *
 * Operation identity is `economy_operations.operation_id`. One row is one
 * economic event (an initial grant, a source, a transfer, a sink, or an
 * adjustment). Source identity `(deployment_id, source_type, source_id)` makes
 * the same automatic reward, such as one mob death, post at most once.
 *
 * Ledger identity is `economy_ledger.entry_id`. A transfer has one operation
 * and two ledger legs. Corrections are new operations. Ledger rows are not edited.
 *
 * `listByRequestId` is a lookup, not a second idempotency store. It refuses
 * more than `ECONOMY_REQUEST_LOOKUP_LIMIT` rows instead of returning a prefix.
 */
export const ECONOMY_OPERATION_KINDS = ['INITIAL', 'SOURCE', 'TRANSFER', 'SINK', 'ADJUSTMENT'] as const;
export type EconomyOperationKind = (typeof ECONOMY_OPERATION_KINDS)[number];

export const ECONOMY_HISTORY_DEFAULT_LIMIT = 50;
export const ECONOMY_HISTORY_MAX_LIMIT = 100;
export const ECONOMY_REQUEST_LOOKUP_LIMIT = 100;

/** UTC timestamp text with up to microseconds. Cursors keep this text as stored. */
export const ECONOMY_TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

export interface EconomyAccount {
  readonly playerId: string;
  readonly deploymentId: string;
  readonly balance: number;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EconomyLedgerEntry {
  readonly entryId: string;
  readonly operationId: string;
  readonly legIndex: number;
  readonly playerId: string;
  readonly delta: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly reason: string;
  readonly counterpartyPlayerId: string | null;
  readonly createdAt: string;
}

export interface EconomyOperationView {
  readonly operationId: string;
  readonly kind: EconomyOperationKind;
  readonly actorId: string | null;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly requestId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly legs: readonly EconomyLedgerEntry[];
}

export interface EconomyMutation {
  readonly replayed: boolean;
  readonly operation: EconomyOperationView;
  readonly accounts: readonly EconomyAccount[];
}

/**
 * A zero-delta set returns `changed: false` and `operation: null`.
 * No ledger row is appended, because a zero delta is not an economic event.
 * That call also does not consume a source identity.
 */
export interface EconomyAdjustment {
  readonly changed: boolean;
  readonly replayed: boolean;
  readonly account: EconomyAccount;
  readonly operation: EconomyOperationView | null;
}

export interface EconomyHistoryCursor {
  readonly createdAt: string;
  readonly entryId: string;
}

export interface EconomyHistoryPage {
  readonly playerId: string;
  readonly entries: readonly EconomyLedgerEntry[];
  readonly nextCursor: EconomyHistoryCursor | null;
}

export interface EconomyReconciliation {
  readonly playerId: string;
  readonly balance: number;
  readonly ledgerTotal: number;
  readonly matches: boolean;
}

export interface EconomySource {
  readonly type: string;
  readonly id: string;
}

export interface EnsureAccountInput {
  readonly playerId: string;
  readonly displayName: string;
}

export interface EconomyWriteInput {
  readonly playerId: string;
  readonly displayName?: string;
  readonly amount: number;
  readonly reason: string;
  readonly actorId?: string;
  readonly source?: EconomySource;
  readonly requestId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EconomyTransferInput {
  readonly fromPlayerId: string;
  readonly toPlayerId: string;
  readonly fromDisplayName?: string;
  readonly toDisplayName?: string;
  readonly amount: number;
  readonly reason: string;
  readonly actorId?: string;
  readonly source?: EconomySource;
  readonly requestId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EconomySetBalanceInput {
  readonly playerId: string;
  readonly displayName?: string;
  readonly balance: number;
  readonly reason?: string;
  readonly actorId?: string;
  readonly source?: EconomySource;
  readonly requestId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EconomyHistoryQuery {
  readonly playerId: string;
  readonly limit?: number;
  readonly before?: EconomyHistoryCursor;
  readonly after?: EconomyHistoryCursor;
}

/**
 * Future JSON balance import. Stage 2B chooses whether to run one.
 * Validating a plan does not read or write PostgreSQL and is not called on startup.
 */
export interface EconomyJsonImportAccount {
  readonly playerId: string;
  readonly displayName: string;
  readonly balance: number;
}
