import type { Queryable } from '../db/types';
import type {
  EconomyAccount,
  EconomyAdjustment,
  EconomyHistoryPage,
  EconomyHistoryQuery,
  EconomyMutation,
  EconomyOperationView,
  EconomyReconciliation,
  EconomyFractionInput,
  EconomySetBalanceInput,
  EconomyTransferInput,
  EconomyWriteInput,
  EnsureAccountInput,
} from './types';

/**
 * Statements that belong to one economic event. The service opens the
 * transaction, or joins the caller's transaction, and passes that client here.
 */
export interface EconomyRepository {
  ensureAccount(tx: Queryable, input: EnsureAccountInput): Promise<EconomyAccount>;
  getAccount(tx: Queryable, playerId: string): Promise<EconomyAccount | null>;
  credit(tx: Queryable, input: EconomyWriteInput): Promise<EconomyMutation>;
  debit(tx: Queryable, input: EconomyWriteInput): Promise<EconomyMutation>;
  transfer(tx: Queryable, input: EconomyTransferInput): Promise<EconomyMutation>;
  transferFraction(tx: Queryable, input: EconomyFractionInput): Promise<EconomyMutation & { readonly amount: number }>;
  setBalance(tx: Queryable, input: EconomySetBalanceInput): Promise<EconomyAdjustment>;
  updateDisplayName(tx: Queryable, playerId: string, displayName: string): Promise<EconomyAccount | null>;
  listTop(tx: Queryable, limit: number): Promise<readonly EconomyAccount[]>;
  history(tx: Queryable, query: EconomyHistoryQuery): Promise<EconomyHistoryPage>;
  getOperation(tx: Queryable, operationId: string): Promise<EconomyOperationView | null>;
  findBySource(tx: Queryable, sourceType: string, sourceId: string): Promise<EconomyOperationView | null>;
  listByRequestId(tx: Queryable, requestId: string): Promise<readonly EconomyOperationView[]>;
  reconcile(tx: Queryable, playerId: string): Promise<EconomyReconciliation>;
}
