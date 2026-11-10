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
  DailyRewardClaimInput,
  DailyRewardClaimResult,
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
  /**
   * Posts at most one DAILY_REWARD for `playerId:claimDate` in this scope.
   * The account lock, source check, balance update, and ledger leg commit together.
   * A repeated source returns the original ledger amount and does not compare a new series.
   */
  claimDailyReward(tx: Queryable, input: DailyRewardClaimInput): Promise<DailyRewardClaimResult>;
  transfer(tx: Queryable, input: EconomyTransferInput): Promise<EconomyMutation>;
  transferFraction(tx: Queryable, input: EconomyFractionInput): Promise<EconomyMutation & { readonly amount: number }>;
  setBalance(tx: Queryable, input: EconomySetBalanceInput): Promise<EconomyAdjustment>;
  updateDisplayName(tx: Queryable, playerId: string, displayName: string): Promise<EconomyAccount | null>;
  listTop(tx: Queryable, limit: number): Promise<readonly EconomyAccount[]>;
  history(tx: Queryable, query: EconomyHistoryQuery): Promise<EconomyHistoryPage>;
  getOperation(tx: Queryable, operationId: string): Promise<EconomyOperationView | null>;
  findBySource(tx: Queryable, sourceType: string, sourceId: string): Promise<EconomyOperationView | null>;
  consumeSource?(tx: Queryable, source: import('./types').EconomySource): Promise<{ replayed: boolean }>;
  listByRequestId(tx: Queryable, requestId: string): Promise<readonly EconomyOperationView[]>;
  reconcile(tx: Queryable, playerId: string): Promise<EconomyReconciliation>;
}
