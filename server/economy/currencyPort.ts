import type {
  BlockBreakRewardOptions,
  EconomyResult,
  EconomyTopEntry,
  EconomyTransaction,
} from '../services/economy';

/** Network or admin request. Distinct from an economic source id. */
export interface EconomyCommandRequest {
  readonly requestId: string;
  readonly operation: string;
  readonly actorId: string;
  readonly payload: unknown;
}

/**
 * Gameplay currency port. Legacy methods return a result immediately.
 * PostgreSQL methods return a promise and do not block the simulation tick.
 * A promise is never treated as success before it settles.
 */
export interface CurrencyPort {
  readonly backend?: 'legacy_json' | 'postgres';
  getBalance(playerId: string): number;
  hasBalance(playerId: string, amount: number): boolean;
  displayName(playerId: string): string;
  getKills(playerId: string): number;
  rememberName(playerId: string, name: string): void | Promise<void>;
  deposit(
    playerId: string,
    amount: number,
    reason: string,
    relatedPlayerId?: string,
    pairId?: string,
    request?: EconomyCommandRequest,
  ): EconomyResult | Promise<EconomyResult>;
  withdraw(
    playerId: string,
    amount: number,
    reason: string,
    relatedPlayerId?: string,
    request?: EconomyCommandRequest,
  ): EconomyResult | Promise<EconomyResult>;
  transfer(
    fromPlayerId: string,
    toPlayerId: string,
    amount: number,
    reason: string,
    request?: EconomyCommandRequest,
    sourceId?: string,
  ): EconomyResult | Promise<EconomyResult>;
  settle(
    fromPlayerId: string,
    toPlayerId: string,
    amount: number,
    debitReason: string,
    creditReason: string,
    pairId?: string,
    request?: EconomyCommandRequest,
    sourceId?: string,
  ): EconomyResult | Promise<EconomyResult>;
  setBalance(
    playerId: string,
    amount: number,
    reason: string,
    request?: EconomyCommandRequest,
  ): EconomyResult | Promise<EconomyResult>;
  resetBalance(playerId: string, reason: string, request?: EconomyCommandRequest): EconomyResult | Promise<EconomyResult>;
  rewardBlockBreak(
    playerId: string,
    blockId: number,
    options?: BlockBreakRewardOptions,
    sourceId?: string,
  ): EconomyResult | Promise<EconomyResult>;
  rewardMobKill(playerId: string, kind: string, economyInstanceId: string): EconomyResult | Promise<EconomyResult>;
  rewardPlayerKill(killerId: string, victimId: string, deathEventId: string): EconomyResult | Promise<EconomyResult>;
  recordPvpKill(killerId: string, victimId: string, deathId: string): { ok: boolean; kills: number; error?: string };
  getTransactionHistory(playerId: string, limit?: number): EconomyTransaction[] | Promise<EconomyTransaction[]>;
  getTopBalances(limit?: number): EconomyTopEntry[] | Promise<EconomyTopEntry[]>;
  rankPlayers(metric: 'money' | 'kills'): Array<{
    readonly playerId: string;
    readonly name: string;
    readonly balance: number;
    readonly kills: number;
    readonly rank: number;
  }>;
  markPlacedBlock(x: number, y: number, z: number): void;
  isPlacedBlock(x: number, y: number, z: number): boolean;
  clearPlacedBlock(x: number, y: number, z: number): void;
  clearPlacedCells(cells: readonly { x: number; y: number; z: number }[]): void;
  persistPlaced(force?: boolean): void;
  load(): void;
  persist(): void;
  preparePlayer?(playerId: string, displayName: string): Promise<void>;
  warm?(playerIds: readonly string[]): Promise<void>;
  track?(work: Promise<unknown>): void;
  idle?(): Promise<void>;
  shutdown?(): Promise<void>;
  /** Test hook. Counts writes of currency JSON. Not used for authority. */
  noteJsonCurrencyWrite?(name: string): void;
}

export function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(value) && typeof (value as Promise<T>).then === 'function';
}

export function thenResult<T, R>(
  value: T | Promise<T>,
  map: (value: T) => R | Promise<R>,
): R | Promise<R> {
  if (isPromise(value)) return value.then(map);
  return map(value);
}
