import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { JsonFileStore } from '../../server/services/jsonStore';
import {
  BLOCK_REWARDS,
  ECONOMY_INITIAL_BALANCE,
  ECONOMY_MAX_BALANCE,
  ECONOMY_PVP_KILL_COOLDOWN_MS,
  EconomyService,
  MOB_REWARDS,
  formatMegacoinAmount,
  formatMegacoins,
  megacoinWord,
  pvpKillReward,
} from '../../server/services/economy';

describe('Megacoin formatting', () => {
  it('groups thousands with spaces and keeps integers', () => {
    expect(formatMegacoinAmount(100)).toBe('100');
    expect(formatMegacoinAmount(1000)).toBe('1 000');
    expect(formatMegacoinAmount(25500)).toBe('25 500');
    expect(formatMegacoinAmount(999_999_999)).toBe('999 999 999');
    expect(formatMegacoins(1250)).toBe('1 250 Мегакоинов');
    expect(megacoinWord(1)).toBe('Мегакоин');
    expect(megacoinWord(2)).toBe('Мегакоина');
    expect(megacoinWord(5)).toBe('Мегакоинов');
    expect(megacoinWord(21)).toBe('Мегакоин');
  });
});

describe('EconomyService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function service(now?: () => number): Promise<EconomyService> {
    const dir = await mkdtemp(join(tmpdir(), 'fc-eco-'));
    dirs.push(dir);
    return new EconomyService(new JsonFileStore(dir), now);
  }

  it('gives a new player 100 Мегакоинов', async () => {
    const economy = await service();
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE);
  });

  it('deposits and withdraws through the service', async () => {
    const economy = await service();
    expect(economy.deposit('p1', 50, 'TRADER_SELL').ok).toBe(true);
    expect(economy.getBalance('p1')).toBe(150);
    expect(economy.withdraw('p1', 20, 'TRADER_PURCHASE').ok).toBe(true);
    expect(economy.getBalance('p1')).toBe(130);
    expect(economy.hasBalance('p1', 130)).toBe(true);
    expect(economy.hasBalance('p1', 131)).toBe(false);
  });

  it('transfers atomically and writes two linked rows', async () => {
    const economy = await service();
    economy.deposit('from', 400, 'ADMIN_GIVE');
    const result = economy.transfer('from', 'to', 250, 'PLAYER_TRANSFER');
    expect(result.ok).toBe(true);
    expect(economy.getBalance('from')).toBe(250);
    expect(economy.getBalance('to')).toBe(350);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions![0]!.pairId).toBe(result.transactions![1]!.pairId);
    expect(result.transactions![0]!.type).toBe('withdraw');
    expect(result.transactions![1]!.type).toBe('deposit');
  });

  it('rejects a transfer that would overflow the recipient without changing either side', async () => {
    const economy = await service();
    economy.setBalance('from', 50, 'ADMIN_SET');
    economy.setBalance('to', ECONOMY_MAX_BALANCE - 5, 'ADMIN_SET');
    const beforeFrom = economy.getBalance('from');
    const beforeTo = economy.getBalance('to');
    const result = economy.transfer('from', 'to', 10, 'AUCTION_PURCHASE');
    expect(result.ok).toBe(false);
    expect(economy.getBalance('from')).toBe(beforeFrom);
    expect(economy.getBalance('to')).toBe(beforeTo);
  });

  it('rejects negative and non-integer amounts', async () => {
    const economy = await service();
    expect(economy.deposit('p1', -1, 'OTHER').ok).toBe(false);
    expect(economy.withdraw('p1', -5, 'OTHER').ok).toBe(false);
    expect(economy.transfer('p1', 'p2', 1.5, 'OTHER').ok).toBe(false);
    expect(economy.deposit('p1', 0, 'OTHER').ok).toBe(false);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE);
  });

  it('rejects deposits that would exceed the max balance', async () => {
    const economy = await service();
    economy.setBalance('p1', ECONOMY_MAX_BALANCE, 'ADMIN_SET');
    expect(economy.deposit('p1', 1, 'ADMIN_GIVE').ok).toBe(false);
    expect(economy.getBalance('p1')).toBe(ECONOMY_MAX_BALANCE);
  });

  it('rejects withdraw greater than the balance', async () => {
    const economy = await service();
    expect(economy.withdraw('p1', 101, 'ADMIN_TAKE').ok).toBe(false);
    expect(economy.getBalance('p1')).toBe(100);
  });

  it('resets to the starting balance and records history', async () => {
    const economy = await service();
    economy.deposit('p1', 50, 'ADMIN_GIVE');
    expect(economy.resetBalance('p1', 'ADMIN_RESET').balance).toBe(ECONOMY_INITIAL_BALANCE);
    expect(economy.getBalance('p1')).toBe(100);
    const history = economy.getTransactionHistory('p1');
    expect(history.some((tx) => tx.reason === 'ADMIN_RESET')).toBe(true);
  });

  it('persists balances and transactions across reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-eco-persist-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const first = new EconomyService(store);
    first.rememberName('p1', 'Steve');
    first.deposit('p1', 40, 'BLOCK_BREAK');
    first.transfer('p1', 'p2', 10, 'PLAYER_TRANSFER');
    const second = new EconomyService(store);
    expect(second.getBalance('p1')).toBe(130);
    expect(second.getBalance('p2')).toBe(110);
    expect(second.displayName('p1')).toBe('Steve');
    expect(second.getTransactionHistory('p1').length).toBeGreaterThan(0);
  });

  it('builds baltop from balances storage, not the transaction log', async () => {
    const economy = await service();
    economy.rememberName('a', 'Alex');
    economy.rememberName('s', 'Steve');
    economy.setBalance('s', 125_000, 'ADMIN_SET');
    economy.setBalance('a', 98_500, 'ADMIN_SET');
    expect(economy.getTopBalances(2)).toEqual([
      { playerId: 's', name: 'Steve', balance: 125_000 },
      { playerId: 'a', name: 'Alex', balance: 98_500 },
    ]);
  });
});

describe('Economy rewards', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function service(now?: () => number): Promise<EconomyService> {
    const dir = await mkdtemp(join(tmpdir(), 'fc-eco-r-'));
    dirs.push(dir);
    return new EconomyService(new JsonFileStore(dir), now);
  }

  it('pays the centralized block table and skips placed / TNT / unknown', async () => {
    const economy = await service();
    expect(BLOCK_REWARDS[BlockId.Dirt]).toBe(1);
    expect(BLOCK_REWARDS[BlockId.Stone]).toBe(2);
    expect(BLOCK_REWARDS[BlockId.OakLog]).toBe(3);
    expect(BLOCK_REWARDS[BlockId.CoalOre]).toBe(8);
    expect(BLOCK_REWARDS[BlockId.DiamondOre]).toBe(25);
    expect(economy.rewardBlockBreak('p', BlockId.Stone).ok).toBe(true);
    expect(economy.getBalance('p')).toBe(102);
    expect(economy.rewardBlockBreak('p', BlockId.Stone, { placed: true }).ok).toBe(false);
    expect(economy.rewardBlockBreak('p', BlockId.DiamondOre, { explosion: true }).ok).toBe(false);
    expect(economy.rewardBlockBreak('p', BlockId.IronOre).ok).toBe(false);
    expect(economy.rewardBlockBreak('p', BlockId.DiamondOre, { source: 'automine' }).amount).toBe(25);
    expect(economy.getBalance('p')).toBe(127);
  });

  it('pays peaceful mobs less than hostiles and ignores unknown or duplicate deaths', async () => {
    const economy = await service();
    expect(MOB_REWARDS.cow).toBeLessThan(MOB_REWARDS.zombie!);
    expect(economy.rewardMobKill('p', 'cow', 'mob-1').amount).toBe(4);
    expect(economy.rewardMobKill('p', 'zombie', 'mob-2').amount).toBe(10);
    expect(economy.rewardMobKill('p', 'cow', 'mob-1').ok).toBe(false);
    expect(economy.rewardMobKill('p', 'ender_dragon', 'mob-3').ok).toBe(false);
    expect(economy.getBalance('p')).toBe(114);
  });

  it('takes a floored 10% on PvP, stays atomic, and respects cooldown', async () => {
    let now = 1_000_000;
    const economy = await service(() => now);
    expect(pvpKillReward(57)).toBe(5);
    expect(pvpKillReward(0)).toBe(0);
    expect(pvpKillReward(1)).toBe(0);
    economy.setBalance('victim', 57, 'ADMIN_SET');
    economy.setBalance('killer', 100, 'ADMIN_SET');
    const first = economy.rewardPlayerKill('killer', 'victim', 'death-1');
    expect(first.ok).toBe(true);
    expect(first.amount).toBe(5);
    expect(economy.getBalance('victim')).toBe(52);
    expect(economy.getBalance('killer')).toBe(105);
    expect(economy.rewardPlayerKill('killer', 'victim', 'death-1b').error).toBe('duplicate');
    now += 600;
    expect(economy.rewardPlayerKill('killer', 'victim', 'death-2').error).toBe('cooldown');
    now += 600;
    economy.setBalance('victim', 10_000, 'ADMIN_SET');
    const other = economy.rewardPlayerKill('other', 'victim', 'death-3');
    expect(other.amount).toBe(1000);
    now += ECONOMY_PVP_KILL_COOLDOWN_MS + 1;
    economy.setBalance('victim', 10_000, 'ADMIN_SET');
    expect(economy.rewardPlayerKill('killer', 'victim', 'death-4').amount).toBe(1000);
    economy.setBalance('broke', 0, 'ADMIN_SET');
    now += 600;
    expect(economy.rewardPlayerKill('killer', 'broke', 'death-5').amount).toBe(0);
    economy.setBalance('rich', ECONOMY_MAX_BALANCE, 'ADMIN_SET');
    now += 600;
    const cap = pvpKillReward(ECONOMY_MAX_BALANCE);
    expect(economy.rewardPlayerKill('killer', 'rich', 'death-6').amount).toBe(cap);
    expect(economy.getBalance('rich')).toBe(ECONOMY_MAX_BALANCE - cap);
  });

  it('settles auction purchase and sale as one atomic pair', async () => {
    const economy = await service();
    economy.setBalance('buyer', 500, 'ADMIN_SET');
    economy.setBalance('seller', 100, 'ADMIN_SET');
    const moved = economy.settle('buyer', 'seller', 250, 'AUCTION_PURCHASE', 'AUCTION_SALE', 'ah-1');
    expect(moved.ok).toBe(true);
    expect(economy.getBalance('buyer')).toBe(250);
    expect(economy.getBalance('seller')).toBe(350);
    const buy = economy.getTransactionHistory('buyer')[0]!;
    const sale = economy.getTransactionHistory('seller')[0]!;
    expect(buy.reason).toBe('AUCTION_PURCHASE');
    expect(sale.reason).toBe('AUCTION_SALE');
    expect(buy.pairId).toBe('ah-1');
    expect(sale.pairId).toBe('ah-1');
    const overflow = economy.settle('buyer', 'seller', 999_999_999, 'AUCTION_PURCHASE', 'AUCTION_SALE', 'ah-2');
    expect(overflow.ok).toBe(false);
    expect(economy.getBalance('buyer')).toBe(250);
    expect(economy.getBalance('seller')).toBe(350);
  });
});
