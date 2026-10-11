import { serverLog } from '../log';
import { IdempotencyConflictError, IdempotencyPendingError } from '../db/errors';
import type { IdempotencyService } from '../db/idempotency';
import {
  ECONOMY_BALT0P_DEFAULT_LIMIT,
  ECONOMY_INITIAL_BALANCE,
  ECONOMY_PVP_KILL_COOLDOWN_MS,
  ECONOMY_TRANSACTION_HISTORY_LIMIT,
  blockReward,
  mobReward,
  type EconomyResult,
  type EconomyService,
  type EconomyTopEntry,
  type EconomyTransaction,
  type BlockBreakRewardOptions,
} from '../services/economy';
import type { KillStatistics } from '../services/killStats';
import {
  EconomyInsufficientError,
  EconomyLimitError,
  EconomySourceConflictError,
  EconomyValidationError,
} from './errors';
import type { EconomyCommandRequest, CurrencyPort } from './currencyPort';
import type { MegacoinService } from './service';
import type { EconomyAccount, EconomyLedgerEntry, EconomyMutation } from './types';

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNTIME_MOB_ID = /^mob-\d+$/;
const ECONOMY_DRAIN_MS = 5_000;

/**
 * PostgreSQL is the only currency authority for this object.
 * The wrapped EconomyService is used for placed-block markers only.
 * It is never asked to deposit, withdraw, transfer, or persist balances.
 */
export class PostgresGameplayEconomy implements CurrencyPort {
  readonly backend = 'postgres' as const;
  private readonly balances = new Map<string, number>();
  private readonly names = new Map<string, string>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly pvpCooldowns = new Map<string, number>();
  private readonly pvpDeathBurst = new Map<string, number>();
  private closed = false;

  constructor(
    private readonly megacoin: MegacoinService,
    private readonly idempotency: IdempotencyService,
    private readonly placed: EconomyService,
    private readonly kills: KillStatistics,
    private readonly now: () => number = Date.now,
  ) {}

  getBalance(playerId: string): number {
    return this.balances.get(playerId) ?? 0;
  }

  hasBalance(playerId: string, amount: number): boolean {
    return Number.isInteger(amount) && amount >= 0 && this.getBalance(playerId) >= amount;
  }

  displayName(playerId: string): string {
    return this.names.get(playerId) || playerId.slice(0, 8);
  }

  getKills(playerId: string): number {
    return this.kills.get(playerId);
  }

  rememberName(playerId: string, name: string): Promise<void> {
    return this.preparePlayer(playerId, name);
  }

  async preparePlayer(playerId: string, displayName: string): Promise<void> {
    const account = await this.megacoin.ensureAccount({ playerId, displayName });
    this.note(account);
  }

  async warm(playerIds: readonly string[]): Promise<void> {
    for (const playerId of new Set(playerIds)) {
      const account = await this.megacoin.getAccount(playerId);
      if (account) this.note(account);
    }
  }

  deposit(
    playerId: string,
    amount: number,
    reason: string,
    _relatedPlayerId?: string,
    _pairId?: string,
    request?: EconomyCommandRequest,
  ): Promise<EconomyResult> {
    return this.credit(playerId, amount, reason, request, request ? { type: reason, id: request.requestId } : undefined);
  }

  withdraw(
    playerId: string,
    amount: number,
    reason: string,
    _relatedPlayerId?: string,
    request?: EconomyCommandRequest,
  ): Promise<EconomyResult> {
    return this.debit(playerId, amount, reason, request, request ? { type: reason, id: request.requestId } : undefined);
  }

  transfer(
    fromPlayerId: string,
    toPlayerId: string,
    amount: number,
    reason: string,
    request?: EconomyCommandRequest,
    sourceId?: string,
  ): Promise<EconomyResult> {
    const source = sourceId ? { type: reason, id: sourceId } : request ? { type: reason, id: request.requestId } : undefined;
    return this.move(fromPlayerId, toPlayerId, amount, reason, reason, request, source);
  }

  settle(
    fromPlayerId: string,
    toPlayerId: string,
    amount: number,
    debitReason: string,
    creditReason: string,
    pairId?: string,
    request?: EconomyCommandRequest,
  ): Promise<EconomyResult> {
    const source = pairId ? { type: 'AUCTION', id: pairId } : undefined;
    return this.move(fromPlayerId, toPlayerId, amount, debitReason, creditReason, request, source);
  }

  setBalance(
    playerId: string,
    amount: number,
    reason: string,
    request?: EconomyCommandRequest,
  ): Promise<EconomyResult> {
    const source = request ? { type: 'ADMIN', id: request.requestId } : undefined;
    const run = async (tx?: Parameters<MegacoinService['setBalance']>[1]) => {
      const adjusted = await this.megacoin.setBalance({
        playerId,
        balance: amount,
        reason,
        ...(source ? { source } : {}),
        ...(request ? { requestId: request.requestId, actorId: request.actorId } : {}),
        displayName: this.names.get(playerId),
      }, tx);
      if (!tx) this.note(adjusted.account);
      return {
        ok: true,
        balance: adjusted.account.balance,
        amount: adjusted.operation?.legs[0] ? Math.abs(adjusted.operation.legs[0].delta) : 0,
        replayed: adjusted.replayed,
      } satisfies EconomyResult & { replayed?: boolean };
    };
    if (!request) return this.guard(() => run());
    return this.command(request, (tx) => run(tx), [playerId]);
  }

  resetBalance(playerId: string, reason: string, request?: EconomyCommandRequest): Promise<EconomyResult> {
    return this.setBalance(playerId, ECONOMY_INITIAL_BALANCE, reason, request);
  }

  rewardBlockBreak(
    playerId: string,
    blockId: number,
    options: BlockBreakRewardOptions = {},
    sourceId?: string,
  ): Promise<EconomyResult> {
    if (options.explosion) return Promise.resolve({ ok: false, error: 'explosion', amount: 0 });
    const placed = options.source === 'automine' ? false : Boolean(options.placed);
    if (placed) return Promise.resolve({ ok: false, error: 'placed', amount: 0 });
    const amount = blockReward(blockId);
    if (amount <= 0) return Promise.resolve({ ok: false, error: 'no-reward', amount: 0 });
    if (!sourceId || !UUID_TEXT.test(sourceId)) {
      return Promise.resolve({ ok: false, error: 'invalid-source', amount: 0 });
    }
    return this.credit(playerId, amount, 'BLOCK_BREAK', undefined, { type: 'BLOCK_BREAK', id: sourceId });
  }

  rewardMobKill(playerId: string, kind: string, economyInstanceId: string): Promise<EconomyResult> {
    if (RUNTIME_MOB_ID.test(economyInstanceId) || !UUID_TEXT.test(economyInstanceId)) {
      return Promise.resolve({ ok: false, error: 'invalid-source', amount: 0 });
    }
    const payout = mobReward(kind);
    if (payout <= 0) return Promise.resolve({ ok: false, error: 'unknown-mob', amount: 0 });
    return this.credit(playerId, payout, 'MOB_KILL', undefined, { type: 'MOB_KILL', id: economyInstanceId }).then((result) => {
      if (result.replayed) return { ok: false, error: 'duplicate', amount: 0, balance: result.balance };
      return result;
    });
  }

  rewardPlayerKill(killerId: string, victimId: string, deathEventId: string): Promise<EconomyResult> {
    if (killerId === victimId) return Promise.resolve({ ok: false, error: 'self', amount: 0 });
    if (!UUID_TEXT.test(deathEventId)) return Promise.resolve({ ok: false, error: 'invalid-source', amount: 0 });
    const now = this.now();
    const lastBurst = Math.max(
      this.pvpDeathBurst.get(deathEventId) ?? 0,
      this.pvpDeathBurst.get(`pvp-death:${victimId}`) ?? 0,
    );
    if (now - lastBurst < 500 && this.pvpDeathBurst.has(deathEventId)) {
      return Promise.resolve({ ok: false, error: 'duplicate', amount: 0 });
    }
    const cooldownKey = `${killerId}:${victimId}`;
    if (now < (this.pvpCooldowns.get(cooldownKey) ?? 0)) {
      return Promise.resolve({ ok: false, error: 'cooldown', amount: 0 });
    }
    this.pvpDeathBurst.set(deathEventId, now);
    this.pvpDeathBurst.set(`pvp-death:${victimId}`, now);
    return this.guard(async () => {
      const moved = await this.megacoin.transferFraction({
        fromPlayerId: victimId,
        toPlayerId: killerId,
        fromDisplayName: this.names.get(victimId),
        toDisplayName: this.names.get(killerId),
        numerator: 1,
        denominator: 10,
        reason: 'PLAYER_KILL',
        source: { type: 'PLAYER_KILL', id: deathEventId },
      });
      for (const account of moved.accounts) this.note(account);
      if (moved.replayed) return { ok: false, error: 'duplicate', amount: 0, balance: this.getBalance(victimId) };
      if (moved.amount > 0) this.pvpCooldowns.set(cooldownKey, this.now() + ECONOMY_PVP_KILL_COOLDOWN_MS);
      const victim = moved.accounts.find((account) => account.playerId === victimId);
      const killer = moved.accounts.find((account) => account.playerId === killerId);
      return {
        ok: true,
        amount: moved.amount,
        fromBalance: victim?.balance,
        toBalance: killer?.balance,
      };
    });
  }

  recordPvpKill(killerId: string, victimId: string, deathId: string): { ok: boolean; kills: number; error?: string } {
    return this.kills.record(killerId, victimId, deathId);
  }

  async getTransactionHistory(playerId: string, limit = ECONOMY_TRANSACTION_HISTORY_LIMIT): Promise<EconomyTransaction[]> {
    const page = await this.megacoin.history({
      playerId,
      limit: Math.max(1, Math.min(limit, ECONOMY_TRANSACTION_HISTORY_LIMIT)),
    });
    return page.entries.map(toTransaction);
  }

  rankPlayers(metric: 'money' | 'kills'): Array<{
    playerId: string;
    name: string;
    balance: number;
    kills: number;
    rank: number;
  }> {
    const ids = new Set<string>([...this.balances.keys()]);
    const rows = [...ids].map((playerId) => ({
      playerId,
      name: this.displayName(playerId),
      balance: this.getBalance(playerId),
      kills: this.kills.get(playerId),
    }));
    rows.sort((a, b) => {
      const av = metric === 'money' ? a.balance : a.kills;
      const bv = metric === 'money' ? b.balance : b.kills;
      if (bv !== av) return bv - av;
      return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' });
    });
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
  }

  async getTopBalances(limit = ECONOMY_BALT0P_DEFAULT_LIMIT): Promise<EconomyTopEntry[]> {
    const cap = Math.max(1, Math.min(limit, 50));
    const rows = await this.megacoin.listTop(cap);
    for (const account of rows) this.note(account);
    return rows.map((account) => ({
      playerId: account.playerId,
      name: account.displayName,
      balance: account.balance,
      kills: this.kills.get(account.playerId),
    }));
  }

  markPlacedBlock(x: number, y: number, z: number): void {
    this.placed.markPlacedBlock(x, y, z);
  }

  isPlacedBlock(x: number, y: number, z: number): boolean {
    return this.placed.isPlacedBlock(x, y, z);
  }

  clearPlacedBlock(x: number, y: number, z: number): void {
    this.placed.clearPlacedBlock(x, y, z);
  }

  clearPlacedCells(cells: readonly { x: number; y: number; z: number }[]): void {
    this.placed.clearPlacedCells(cells);
  }

  persistPlaced(force = false): void {
    this.placed.persistPlaced(force);
  }

  load(): void {
    this.placed.load();
    this.kills.load();
  }

  persist(): void {
    this.placed.persistPlaced(true);
    this.kills.persist();
  }

  track(work: Promise<unknown>): void {
    if (this.closed) return;
    const tracked = work.finally(() => {
      this.pending.delete(tracked);
    });
    this.pending.add(tracked);
  }

  async idle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.race([
      this.idle(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, ECONOMY_DRAIN_MS);
      }),
    ]);
    this.persist();
  }

  private credit(
    playerId: string,
    amount: number,
    reason: string,
    request: EconomyCommandRequest | undefined,
    source: { type: string; id: string } | undefined,
  ): Promise<EconomyResult> {
    const run = async (tx?: Parameters<MegacoinService['credit']>[1]) => {
      const mutation = await this.megacoin.credit({
        playerId,
        amount,
        reason,
        displayName: this.names.get(playerId),
        ...(source ? { source } : {}),
        ...(request ? { requestId: request.requestId, actorId: request.actorId } : {}),
      }, tx);
      return this.fromMutation(mutation, !tx);
    };
    if (!request) return this.guard(() => run());
    return this.command(request, (tx) => run(tx), [playerId]);
  }

  private debit(
    playerId: string,
    amount: number,
    reason: string,
    request: EconomyCommandRequest | undefined,
    source: { type: string; id: string } | undefined,
  ): Promise<EconomyResult> {
    const run = async (tx?: Parameters<MegacoinService['debit']>[1]) => {
      const mutation = await this.megacoin.debit({
        playerId,
        amount,
        reason,
        displayName: this.names.get(playerId),
        ...(source ? { source } : {}),
        ...(request ? { requestId: request.requestId, actorId: request.actorId } : {}),
      }, tx);
      return this.fromMutation(mutation, !tx);
    };
    if (!request) return this.guard(() => run());
    return this.command(request, (tx) => run(tx), [playerId]);
  }

  private move(
    fromPlayerId: string,
    toPlayerId: string,
    amount: number,
    debitReason: string,
    creditReason: string,
    request: EconomyCommandRequest | undefined,
    source: { type: string; id: string } | undefined,
  ): Promise<EconomyResult> {
    const run = async (tx?: Parameters<MegacoinService['transfer']>[1]) => {
      const mutation = await this.megacoin.transfer({
        fromPlayerId,
        toPlayerId,
        amount,
        reason: debitReason,
        debitReason,
        creditReason,
        fromDisplayName: this.names.get(fromPlayerId),
        toDisplayName: this.names.get(toPlayerId),
        ...(source ? { source } : {}),
        ...(request ? { requestId: request.requestId, actorId: request.actorId } : {}),
      }, tx);
      return this.fromTransfer(mutation, fromPlayerId, toPlayerId, !tx);
    };
    if (!request) return this.guard(() => run());
    return this.command(request, (tx) => run(tx), [fromPlayerId, toPlayerId]);
  }

  private command(
    request: EconomyCommandRequest,
    run: (tx: Parameters<MegacoinService['credit']>[1]) => Promise<EconomyResult & { replayed?: boolean }>,
    playerIds: readonly string[],
  ): Promise<EconomyResult> {
    return this.guard(async () => {
      const detailed = await this.idempotency.executeDetailed({
        deploymentId: this.megacoin.deploymentId,
        requestId: request.requestId,
        operation: request.operation,
        actorId: request.actorId,
        payload: request.payload,
      }, async (tx) => run(tx));
      await this.warm(playerIds);
      return detailed.value;
    });
  }

  private async guard(run: () => Promise<EconomyResult>): Promise<EconomyResult> {
    try {
      return await run();
    } catch (error) {
      return this.fail(error);
    }
  }

  private fromMutation(mutation: EconomyMutation, committed: boolean): EconomyResult & { replayed?: boolean } {
    const account = mutation.accounts[0];
    if (committed && account) this.note(account);
    return {
      ok: true,
      amount: account && mutation.operation.legs[0] ? Math.abs(mutation.operation.legs[0].delta) : 0,
      balance: account?.balance,
      replayed: mutation.replayed,
    };
  }

  private fromTransfer(
    mutation: EconomyMutation,
    fromPlayerId: string,
    toPlayerId: string,
    committed: boolean,
  ): EconomyResult & { replayed?: boolean } {
    if (committed) {
      for (const account of mutation.accounts) this.note(account);
    }
    const from = mutation.accounts.find((account) => account.playerId === fromPlayerId);
    const to = mutation.accounts.find((account) => account.playerId === toPlayerId);
    const leg = mutation.operation.legs.find((entry) => entry.playerId === fromPlayerId);
    return {
      ok: true,
      amount: leg ? Math.abs(leg.delta) : 0,
      fromBalance: from?.balance,
      toBalance: to?.balance,
      balance: from?.balance,
      replayed: mutation.replayed,
    };
  }

  private note(account: EconomyAccount): void {
    this.balances.set(account.playerId, account.balance);
    this.names.set(account.playerId, account.displayName);
  }

  private fail(error: unknown): EconomyResult {
    if (error instanceof EconomyInsufficientError) {
      return { ok: false, error: 'Недостаточно Мегакоинов.' };
    }
    if (error instanceof EconomyLimitError) {
      return { ok: false, error: 'Превышен максимальный баланс.' };
    }
    if (error instanceof EconomySourceConflictError || error instanceof IdempotencyConflictError) {
      return { ok: false, error: 'conflict' };
    }
    if (error instanceof EconomyValidationError) {
      return { ok: false, error: 'Сумма должна быть целым положительным числом.' };
    }
    if (error instanceof IdempotencyPendingError) {
      return { ok: false, error: 'Экономика временно недоступна.' };
    }
    serverLog('economy mutation failed', 'error');
    return { ok: false, error: 'Экономика временно недоступна.' };
  }
}

function toTransaction(entry: EconomyLedgerEntry): EconomyTransaction {
  return {
    transactionId: entry.entryId,
    playerId: entry.playerId,
    type: entry.delta < 0 ? 'withdraw' : 'deposit',
    amount: Math.abs(entry.delta),
    balanceBefore: entry.balanceBefore,
    balanceAfter: entry.balanceAfter,
    reason: entry.reason,
    timestamp: Date.parse(entry.createdAt),
    ...(entry.counterpartyPlayerId ? { relatedPlayerId: entry.counterpartyPlayerId } : {}),
  };
}
