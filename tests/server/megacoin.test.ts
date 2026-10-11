import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DisabledDatabase } from '../../server/db/database';
import { DatabaseDisabledError } from '../../server/db/errors';
import { EconomyValidationError } from '../../server/economy/errors';
import { validateEconomyJsonImport } from '../../server/economy/importPlan';
import { MegacoinService } from '../../server/economy/service';
import { ECONOMY_INITIAL_BALANCE, ECONOMY_MAX_BALANCE, EconomyService } from '../../server/services/economy';

describe('megacoin core without PostgreSQL', () => {
  it('fails closed when the database is disabled and does not mint a balance', async () => {
    const service = new MegacoinService(new DisabledDatabase(), 'dev');
    await expect(service.ensureAccount({ playerId: 'ada', displayName: 'Ada' })).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(service.getBalance('ada')).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(service.credit({
      playerId: 'ada',
      amount: 1,
      reason: 'BLOCK_BREAK',
    })).rejects.toBeInstanceOf(DatabaseDisabledError);
  });

  it('rejects floating-point money before any database call', async () => {
    const service = new MegacoinService(new DisabledDatabase(), 'dev');
    await expect(service.credit({
      playerId: 'ada',
      amount: 1.5,
      reason: 'BLOCK_BREAK',
    })).rejects.toBeInstanceOf(EconomyValidationError);
    await expect(service.setBalance({
      playerId: 'ada',
      balance: ECONOMY_MAX_BALANCE + 1,
    })).rejects.toBeInstanceOf(EconomyValidationError);
  });

  it('validates a future JSON import without writing it', () => {
    expect(validateEconomyJsonImport([
      { playerId: 'ada', displayName: 'Ada', balance: ECONOMY_INITIAL_BALANCE },
    ])).toEqual([
      { playerId: 'ada', displayName: 'Ada', balance: ECONOMY_INITIAL_BALANCE },
    ]);
    expect(() => validateEconomyJsonImport([
      { playerId: 'ada', displayName: 'Ada', balance: 1.5 },
    ])).toThrow(EconomyValidationError);
    expect(() => validateEconomyJsonImport([
      { playerId: 'ada', displayName: 'Ada', balance: 1 },
      { playerId: 'ada', displayName: 'Ada', balance: 2 },
    ])).toThrow(/same player/);
  });

  it('leaves the JSON economy service as the gameplay authority', () => {
    const economy = readFileSync('server/services/economy.ts', 'utf8');
    const auction = readFileSync('server/services/auction.ts', 'utf8');
    const trade = readFileSync('server/services/trade.ts', 'utf8');
    const clan = readFileSync('server/services/clan.ts', 'utf8');
    const buyer = readFileSync('server/services/buyer.ts', 'utf8');
    const world = readFileSync('server/WorldInstance.ts', 'utf8');
    const gameplay = readFileSync('server/gameplay.ts', 'utf8');
    const anarchy = readFileSync('server/AnarchyServer.ts', 'utf8');
    const entry = readFileSync('server/index.ts', 'utf8');
    for (const source of [economy, auction, trade, clan, buyer]) {
      expect(source).not.toContain('MegacoinService');
      expect(source).not.toContain("from '../db/");
    }
    for (const source of [gameplay, anarchy, entry]) {
      expect(source).not.toContain('MegacoinService');
      expect(source).not.toContain("from '../db/");
    }
    expect(world).toContain('createGameplayEconomy');
    expect(auction).not.toContain('PostgresGameplayEconomy');
    expect(trade).not.toContain('PostgresGameplayEconomy');
    expect(clan).not.toContain('PostgresGameplayEconomy');
    expect(buyer).not.toContain('PostgresGameplayEconomy');
    expect(ECONOMY_INITIAL_BALANCE).toBe(100);
    const store = {
      load<T>(_name: string, fallback: T): T { return fallback; },
      save() {},
    };
    expect(new EconomyService(store as never).getBalance('new-player')).toBe(100);
  });
});
