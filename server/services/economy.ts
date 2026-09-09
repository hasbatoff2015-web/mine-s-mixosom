import { BlockId, getBlockDefinition } from '../../src/blocks';
import type { MobKind } from '../../src/entities/mobDefinitions';
import type { JsonFileStore } from './jsonStore';

export const ECONOMY_PLUGIN_NAME = 'economy';
export const ECONOMY_CURRENCY_NAME = 'Мегакоин';
export const ECONOMY_INITIAL_BALANCE = 100;
export const ECONOMY_MAX_BALANCE = 999_999_999;
export const ECONOMY_PVP_KILL_SHARE = 0.1;
export const ECONOMY_PVP_KILL_COOLDOWN_MS = 5 * 60 * 1000;
export const ECONOMY_TRANSACTION_HISTORY_LIMIT = 100;
export const ECONOMY_BALT0P_DEFAULT_LIMIT = 10;
export const ECONOMY_COMMAND_HISTORY_LIMIT = 10;

export type EconomyReason =
  | 'BLOCK_BREAK'
  | 'MOB_KILL'
  | 'PLAYER_KILL'
  | 'PLAYER_TRANSFER'
  | 'ADMIN_GIVE'
  | 'ADMIN_TAKE'
  | 'ADMIN_SET'
  | 'ADMIN_RESET'
  | 'TRADER'
  | 'TRADER_PURCHASE'
  | 'TRADER_SELL'
  | 'AUCTION'
  | 'AUCTION_PURCHASE'
  | 'AUCTION_SALE'
  | 'OTHER';

export type EconomyTxType = 'deposit' | 'withdraw' | 'set';

export interface EconomyTransaction {
  readonly transactionId: string;
  readonly playerId: string;
  readonly type: EconomyTxType;
  readonly amount: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly reason: string;
  readonly timestamp: number;
  readonly relatedPlayerId?: string;
  readonly pairId?: string;
}

export interface EconomyBalanceRecord {
  readonly playerId: string;
  balance: number;
  name: string;
}

export interface EconomyResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly amount?: number;
  readonly balance?: number;
  readonly fromBalance?: number;
  readonly toBalance?: number;
  readonly transaction?: EconomyTransaction;
  readonly transactions?: readonly EconomyTransaction[];
}

export interface EconomyTopEntry {
  readonly playerId: string;
  readonly name: string;
  readonly balance: number;
}

export interface BlockBreakRewardOptions {
  readonly placed?: boolean;
  readonly explosion?: boolean;
  /** AutoMine fill is generated content, not a player-placed block. */
  readonly source?: 'player' | 'automine';
}

/**
 * Small natural-block payouts. Ores are the noticeable ones; one diamond must
 * not replace a starting bank. Player-placed copies of these ids pay 0.
 */
export const BLOCK_REWARDS: Readonly<Partial<Record<BlockId, number>>> = Object.freeze({
  [BlockId.Dirt]: 1,
  [BlockId.GrassBlock]: 1,
  [BlockId.Sand]: 1,
  [BlockId.Gravel]: 1,
  [BlockId.Clay]: 1,
  [BlockId.Sandstone]: 1,
  [BlockId.Stone]: 2,
  [BlockId.OakLog]: 3,
  [BlockId.BirchLog]: 3,
  [BlockId.SpruceLog]: 3,
  [BlockId.CoalOre]: 8,
  [BlockId.DiamondOre]: 25,
});

/** Peaceful mobs are small change; hostiles pay more; creeper is the top ordinary kill. */
export const MOB_REWARDS: Readonly<Partial<Record<MobKind, number>>> = Object.freeze({
  chicken: 2,
  pig: 3,
  sheep: 3,
  cow: 4,
  spider: 8,
  zombie: 10,
  skeleton: 12,
  creeper: 15,
});

const REASON_LABELS: Readonly<Record<string, string>> = {
  BLOCK_BREAK: 'добыча',
  MOB_KILL: 'убийство моба',
  PLAYER_KILL: 'убийство игрока',
  PLAYER_TRANSFER: 'перевод',
  ADMIN_GIVE: 'выдача администратором',
  ADMIN_TAKE: 'снятие администратором',
  ADMIN_SET: 'установка администратором',
  ADMIN_RESET: 'сброс администратором',
  TRADER: 'торговец',
  TRADER_PURCHASE: 'покупка у торговца',
  TRADER_SELL: 'продажа торговцу',
  AUCTION: 'аукцион',
  AUCTION_PURCHASE: 'покупка на аукционе',
  AUCTION_SALE: 'продажа на аукционе',
  OTHER: 'другое',
};

interface BalanceFile {
  players: EconomyBalanceRecord[];
}

interface TransactionFile {
  nextId: number;
  transactions: EconomyTransaction[];
}

interface PlacedFile {
  cells: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function formatMegacoinAmount(amount: number): string {
  const n = Math.trunc(amount);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped}`;
}

/** 1 Мегакоин, 2 Мегакоина, 5 Мегакоинов. 11–14 always Мегакоинов. */
export function megacoinWord(amount: number): string {
  const abs = Math.abs(Math.trunc(amount));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'Мегакоинов';
  if (mod10 === 1) return 'Мегакоин';
  if (mod10 >= 2 && mod10 <= 4) return 'Мегакоина';
  return 'Мегакоинов';
}

export function formatMegacoins(amount: number): string {
  return `${formatMegacoinAmount(amount)} ${megacoinWord(amount)}`;
}

export function pvpKillReward(victimBalance: number): number {
  if (!Number.isFinite(victimBalance) || victimBalance <= 0) return 0;
  return Math.floor(victimBalance * ECONOMY_PVP_KILL_SHARE);
}

export function blockReward(blockId: number): number {
  return BLOCK_REWARDS[blockId as BlockId] ?? 0;
}

export function mobReward(kind: string): number {
  return MOB_REWARDS[kind as MobKind] ?? 0;
}

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function parseIntegerAmount(amount: number): number | undefined {
  if (!Number.isInteger(amount) || !Number.isSafeInteger(amount)) return undefined;
  return amount;
}

export class EconomyService {
  private players = new Map<string, EconomyBalanceRecord>();
  private transactions: EconomyTransaction[] = [];
  private nextId = 1;
  private readonly placed = new Set<string>();
  private placedDirty = false;
  private readonly rewardedDeaths = new Set<string>();
  private readonly pvpDeathBurst = new Map<string, number>();
  private readonly pvpCooldowns = new Map<string, number>();

  constructor(
    private readonly store: JsonFileStore,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  load(): void {
    const balances = this.store.load<BalanceFile>('economy/balances', { players: [] });
    this.players.clear();
    for (const entry of Array.isArray(balances.players) ? balances.players : []) {
      if (!entry || typeof entry.playerId !== 'string') continue;
      const balance = Number(entry.balance);
      if (!Number.isInteger(balance)) continue;
      this.players.set(entry.playerId, {
        playerId: entry.playerId,
        balance: Math.max(0, Math.min(ECONOMY_MAX_BALANCE, balance)),
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.playerId.slice(0, 8),
      });
    }
    const tx = this.store.load<TransactionFile>('economy/transactions', { nextId: 1, transactions: [] });
    this.nextId = Number.isInteger(tx.nextId) && tx.nextId > 0 ? tx.nextId : 1;
    this.transactions = Array.isArray(tx.transactions) ? tx.transactions.filter((entry) => isRecord(entry)) as EconomyTransaction[] : [];
    const placed = this.store.load<PlacedFile>('economy/placed-blocks', { cells: [] });
    this.placed.clear();
    for (const cell of Array.isArray(placed.cells) ? placed.cells : []) {
      if (typeof cell === 'string' && cell.length > 0) this.placed.add(cell);
    }
    this.placedDirty = false;
  }

  persist(): void {
    this.persistBalances();
    this.persistTransactions();
    this.persistPlaced(true);
  }

  persistPlaced(force = false): void {
    if (!force && !this.placedDirty) return;
    this.store.save('economy/placed-blocks', { cells: [...this.placed] });
    this.placedDirty = false;
  }

  getBalance(playerId: string): number {
    return this.ensurePlayer(playerId).balance;
  }

  hasBalance(playerId: string, amount: number): boolean {
    const value = parseIntegerAmount(amount);
    if (value === undefined || value < 0) return false;
    return this.getBalance(playerId) >= value;
  }

  deposit(playerId: string, amount: number, reason: string, relatedPlayerId?: string, pairId?: string): EconomyResult {
    const value = parseIntegerAmount(amount);
    if (value === undefined || value <= 0) return failAmount();
    const player = this.ensurePlayer(playerId);
    if (player.balance + value > ECONOMY_MAX_BALANCE) {
      return { ok: false, error: 'Превышен максимальный баланс.', balance: player.balance };
    }
    return this.apply(player, 'deposit', value, reason, relatedPlayerId, pairId);
  }

  withdraw(playerId: string, amount: number, reason: string, relatedPlayerId?: string): EconomyResult {
    const value = parseIntegerAmount(amount);
    if (value === undefined || value <= 0) return failAmount();
    const player = this.ensurePlayer(playerId);
    if (player.balance < value) {
      return { ok: false, error: 'Недостаточно Мегакоинов.', balance: player.balance };
    }
    return this.apply(player, 'withdraw', value, reason, relatedPlayerId);
  }

  /**
   * Atomic two-sided move. Either both balances change or neither does.
   * Two linked transaction rows share `pairId`.
   */
  transfer(fromPlayerId: string, toPlayerId: string, amount: number, reason: string): EconomyResult {
    if (fromPlayerId === toPlayerId) {
      return { ok: false, error: 'Нельзя перевести Мегакоины самому себе.' };
    }
    const value = parseIntegerAmount(amount);
    if (value === undefined || value <= 0) return failAmount();
    const from = this.ensurePlayer(fromPlayerId);
    const to = this.ensurePlayer(toPlayerId);
    if (from.balance < value) {
      return { ok: false, error: 'Недостаточно Мегакоинов.', balance: from.balance };
    }
    if (to.balance + value > ECONOMY_MAX_BALANCE) {
      return { ok: false, error: 'У получателя недостаточно места для этой суммы.', balance: to.balance };
    }
    const pairId = this.nextPairId();
    const debit = this.apply(from, 'withdraw', value, reason, toPlayerId, pairId, false);
    const credit = this.apply(to, 'deposit', value, reason, fromPlayerId, pairId, false);
    this.persistBalances();
    this.persistTransactions();
    return {
      ok: true,
      amount: value,
      fromBalance: debit.balance,
      toBalance: credit.balance,
      transactions: [debit.transaction!, credit.transaction!],
    };
  }

  /**
   * Atomic two-sided move with independent debit/credit reasons (Auction purchase/sale).
   * `pairId` links both rows; callers typically pass a listing id.
   */
  settle(
    fromPlayerId: string,
    toPlayerId: string,
    amount: number,
    debitReason: string,
    creditReason: string,
    pairId?: string,
  ): EconomyResult {
    if (fromPlayerId === toPlayerId) {
      return { ok: false, error: 'Нельзя перевести Мегакоины самому себе.' };
    }
    const value = parseIntegerAmount(amount);
    if (value === undefined || value <= 0) return failAmount();
    const from = this.ensurePlayer(fromPlayerId);
    const to = this.ensurePlayer(toPlayerId);
    if (from.balance < value) {
      return { ok: false, error: 'Недостаточно Мегакоинов.', balance: from.balance };
    }
    if (to.balance + value > ECONOMY_MAX_BALANCE) {
      return { ok: false, error: 'У получателя недостаточно места для этой суммы.', balance: to.balance };
    }
    const link = pairId ?? this.nextPairId();
    const debit = this.apply(from, 'withdraw', value, debitReason, toPlayerId, link, false);
    const credit = this.apply(to, 'deposit', value, creditReason, fromPlayerId, link, false);
    this.persistBalances();
    this.persistTransactions();
    return {
      ok: true,
      amount: value,
      fromBalance: debit.balance,
      toBalance: credit.balance,
      transactions: [debit.transaction!, credit.transaction!],
    };
  }

  setBalance(playerId: string, amount: number, reason: string): EconomyResult {
    const value = parseIntegerAmount(amount);
    if (value === undefined || value < 0) return failAmount();
    if (value > ECONOMY_MAX_BALANCE) {
      return { ok: false, error: 'Превышен максимальный баланс.' };
    }
    const player = this.ensurePlayer(playerId);
    const delta = value - player.balance;
    const type: EconomyTxType = delta >= 0 ? 'deposit' : 'withdraw';
    return this.apply(player, type, Math.abs(delta), reason, undefined, undefined, true, value);
  }

  /** Restore the new-player starting balance (100), not zero. */
  resetBalance(playerId: string, reason: string): EconomyResult {
    return this.setBalance(playerId, ECONOMY_INITIAL_BALANCE, reason);
  }

  getTransactionHistory(playerId: string, limit = ECONOMY_TRANSACTION_HISTORY_LIMIT): EconomyTransaction[] {
    const cap = Math.max(1, Math.min(limit, ECONOMY_TRANSACTION_HISTORY_LIMIT));
    const list: EconomyTransaction[] = [];
    for (let i = this.transactions.length - 1; i >= 0 && list.length < cap; i -= 1) {
      const entry = this.transactions[i]!;
      if (entry.playerId === playerId) list.push(entry);
    }
    return list;
  }

  getTopBalances(limit = ECONOMY_BALT0P_DEFAULT_LIMIT): EconomyTopEntry[] {
    const cap = Math.max(1, Math.min(limit, 50));
    return [...this.players.values()]
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'ru'))
      .slice(0, cap)
      .map((entry) => ({ playerId: entry.playerId, name: entry.name, balance: entry.balance }));
  }

  rememberName(playerId: string, name: string): void {
    const player = this.ensurePlayer(playerId, name);
    if (player.name !== name && name.length > 0) {
      player.name = name;
      this.persistBalances();
    }
  }

  displayName(playerId: string): string {
    return this.players.get(playerId)?.name || playerId.slice(0, 8);
  }

  markPlacedBlock(x: number, y: number, z: number): void {
    const key = cellKey(x, y, z);
    if (this.placed.has(key)) return;
    this.placed.add(key);
    this.placedDirty = true;
  }

  isPlacedBlock(x: number, y: number, z: number): boolean {
    return this.placed.has(cellKey(x, y, z));
  }

  clearPlacedBlock(x: number, y: number, z: number): void {
    if (this.placed.delete(cellKey(x, y, z))) this.placedDirty = true;
  }

  /** AutoMine fill/restore overwrites voxels; they become generated content again. */
  clearPlacedCells(cells: readonly { x: number; y: number; z: number }[]): void {
    let changed = false;
    for (const cell of cells) {
      if (this.placed.delete(cellKey(cell.x, cell.y, cell.z))) changed = true;
    }
    if (changed) this.placedDirty = true;
  }

  rewardBlockBreak(playerId: string, blockId: number, options: BlockBreakRewardOptions = {}): EconomyResult {
    if (options.explosion) return { ok: false, error: 'explosion', amount: 0 };
    const placed = options.source === 'automine' ? false : Boolean(options.placed);
    if (placed) return { ok: false, error: 'placed', amount: 0 };
    const amount = blockReward(blockId);
    if (amount <= 0) return { ok: false, error: 'no-reward', amount: 0 };
    return this.deposit(playerId, amount, 'BLOCK_BREAK');
  }

  rewardMobKill(playerId: string, kind: string, entityId: string): EconomyResult {
    if (this.rewardedDeaths.has(entityId)) return { ok: false, error: 'duplicate', amount: 0 };
    const amount = mobReward(kind);
    if (amount <= 0) return { ok: false, error: 'unknown-mob', amount: 0 };
    this.rewardedDeaths.add(entityId);
    this.pruneDeathGuards();
    return this.deposit(playerId, amount, 'MOB_KILL');
  }

  /**
   * Atomic 10% of the victim's balance at death, floored.
   * Same killer→victim pair is ignored until `ECONOMY_PVP_KILL_COOLDOWN_MS`.
   */
  rewardPlayerKill(killerId: string, victimId: string, deathId: string): EconomyResult {
    if (killerId === victimId) return { ok: false, error: 'self', amount: 0 };
    const now = this.now();
    const burstKey = deathId || `pvp-death:${victimId}`;
    const lastBurst = Math.max(
      this.pvpDeathBurst.get(burstKey) ?? 0,
      this.pvpDeathBurst.get(`pvp-death:${victimId}`) ?? 0,
    );
    if (now - lastBurst < 500) return { ok: false, error: 'duplicate', amount: 0 };
    this.pvpDeathBurst.set(burstKey, now);
    this.pvpDeathBurst.set(`pvp-death:${victimId}`, now);
    const cooldownKey = `${killerId}:${victimId}`;
    const until = this.pvpCooldowns.get(cooldownKey) ?? 0;
    if (now < until) return { ok: false, error: 'cooldown', amount: 0 };
    const victimBalance = this.getBalance(victimId);
    const amount = pvpKillReward(victimBalance);
    if (amount <= 0) return { ok: true, amount: 0, fromBalance: victimBalance, toBalance: this.getBalance(killerId) };
    const moved = this.transfer(victimId, killerId, amount, 'PLAYER_KILL');
    if (!moved.ok) return moved;
    this.pvpCooldowns.set(cooldownKey, now + ECONOMY_PVP_KILL_COOLDOWN_MS);
    this.pruneDeathGuards();
    return moved;
  }

  wasDeathRewarded(deathId: string): boolean {
    return this.rewardedDeaths.has(deathId);
  }

  pvpCooldownRemaining(killerId: string, victimId: string): number {
    return Math.max(0, (this.pvpCooldowns.get(`${killerId}:${victimId}`) ?? 0) - this.now());
  }

  private ensurePlayer(playerId: string, name?: string): EconomyBalanceRecord {
    const existing = this.players.get(playerId);
    if (existing) {
      if (name && existing.name !== name) existing.name = name;
      return existing;
    }
    const created: EconomyBalanceRecord = {
      playerId,
      balance: ECONOMY_INITIAL_BALANCE,
      name: name && name.length > 0 ? name : playerId.slice(0, 8),
    };
    this.players.set(playerId, created);
    this.persistBalances();
    return created;
  }

  private apply(
    player: EconomyBalanceRecord,
    type: EconomyTxType,
    amount: number,
    reason: string,
    relatedPlayerId?: string,
    pairId?: string,
    persist = true,
    absolute?: number,
  ): EconomyResult {
    const balanceBefore = player.balance;
    const balanceAfter = absolute !== undefined
      ? absolute
      : type === 'deposit'
        ? player.balance + amount
        : player.balance - amount;
    player.balance = balanceAfter;
    const transaction: EconomyTransaction = {
      transactionId: `tx-${this.nextId++}`,
      playerId: player.playerId,
      type: absolute !== undefined ? 'set' : type,
      amount,
      balanceBefore,
      balanceAfter,
      reason,
      timestamp: this.now(),
      ...(relatedPlayerId ? { relatedPlayerId } : {}),
      ...(pairId ? { pairId } : {}),
    };
    this.transactions.push(transaction);
    if (this.transactions.length > ECONOMY_TRANSACTION_HISTORY_LIMIT * 200) {
      this.transactions = this.transactions.slice(-ECONOMY_TRANSACTION_HISTORY_LIMIT * 100);
    }
    if (persist) {
      this.persistBalances();
      this.persistTransactions();
    }
    return { ok: true, amount, balance: balanceAfter, transaction };
  }

  private nextPairId(): string {
    return `pair-${this.nextId}`;
  }

  private pruneDeathGuards(): void {
    if (this.rewardedDeaths.size > 4000) {
      const keep = [...this.rewardedDeaths].slice(-2000);
      this.rewardedDeaths.clear();
      for (const id of keep) this.rewardedDeaths.add(id);
    }
    const now = this.now();
    for (const [key, at] of this.pvpDeathBurst) {
      if (now - at > 5_000) this.pvpDeathBurst.delete(key);
    }
    for (const [key, until] of this.pvpCooldowns) {
      if (until <= now) this.pvpCooldowns.delete(key);
    }
  }

  private persistBalances(): void {
    this.store.save('economy/balances', {
      players: [...this.players.values()].map((entry) => ({
        playerId: entry.playerId,
        balance: entry.balance,
        name: entry.name,
      })),
    });
  }

  private persistTransactions(): void {
    this.store.save('economy/transactions', {
      nextId: this.nextId,
      transactions: this.transactions,
    });
  }
}

function failAmount(): EconomyResult {
  return { ok: false, error: 'Сумма должна быть целым положительным числом.' };
}

export function reasonLabel(reason: string, extra?: string): string {
  const base = REASON_LABELS[reason] ?? reason.toLowerCase();
  return extra ? `${base} ${extra}` : base;
}

export function formatTransactionLine(
  tx: EconomyTransaction,
  resolveName: (playerId: string) => string,
  blockName?: string,
): string {
  const signed = tx.type === 'withdraw' ? -tx.amount : tx.type === 'set'
    ? tx.balanceAfter - tx.balanceBefore
    : tx.amount;
  const prefix = signed > 0 ? `+${formatMegacoinAmount(signed)}` : formatMegacoinAmount(signed);
  let detail = reasonLabel(tx.reason);
  if (tx.reason === 'BLOCK_BREAK' && blockName) detail = `добыча ${blockName}`;
  else if (tx.reason === 'PLAYER_TRANSFER' && tx.relatedPlayerId) {
    detail = signed < 0 ? `перевод ${resolveName(tx.relatedPlayerId)}` : `перевод от ${resolveName(tx.relatedPlayerId)}`;
  } else if (tx.reason === 'PLAYER_KILL' && tx.relatedPlayerId) {
    detail = signed > 0
      ? `убийство игрока ${resolveName(tx.relatedPlayerId)}`
      : `смерть от ${resolveName(tx.relatedPlayerId)}`;
  } else if (tx.reason === 'MOB_KILL') detail = 'убийство моба';
  return `${prefix} — ${detail}`;
}

export function blockDisplayName(blockId: number): string {
  try {
    return getBlockDefinition(blockId).name;
  } catch {
    return `блок ${blockId}`;
  }
}
