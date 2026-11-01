import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import type { CurrencyPort, EconomyCommandRequest } from '../../server/economy/currencyPort';
import { MONEY_REQUEST_REQUIRED } from '../../server/economy/moneyRequest';
import { syncAuction, AuctionService } from '../../server/services/auction';
import { BuyerService } from '../../server/services/buyer';
import { ClanService } from '../../server/services/clan';
import { HologramNetwork } from '../../server/services/holograms';
import { JsonFileStore } from '../../server/services/jsonStore';
import { TradeService } from '../../server/services/trade';
import type { EconomyResult } from '../../server/services/economy';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function postgresPort(mutate: (kind: string) => EconomyResult | Promise<EconomyResult>): CurrencyPort {
  const ok = (): Promise<EconomyResult> => Promise.resolve({ ok: true, balance: 1000 });
  return {
    backend: 'postgres',
    getBalance: () => 1000,
    hasBalance: () => true,
    displayName: (id) => id,
    getKills: () => 0,
    rememberName: () => undefined,
    deposit: () => mutate('deposit'),
    withdraw: () => mutate('withdraw'),
    transfer: () => mutate('transfer'),
    settle: () => mutate('settle'),
    setBalance: () => ok(),
    resetBalance: () => ok(),
    rewardBlockBreak: () => ok(),
    rewardMobKill: () => ok(),
    rewardPlayerKill: () => ok(),
    recordPvpKill: () => ({ ok: true, kills: 0 }),
    getTransactionHistory: () => [],
    getTopBalances: () => [],
    rankPlayers: () => [],
    markPlacedBlock: () => undefined,
    isPlacedBlock: () => false,
    clearPlacedBlock: () => undefined,
    clearPlacedCells: () => undefined,
    persistPlaced: () => undefined,
    load: () => undefined,
    persist: () => undefined,
  };
}

describe('client money request boundaries', () => {
  it('rejects auction, buyer, clan, and trade money without a request uuid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-req-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const calls: string[] = [];
    const economy = postgresPort((kind) => {
      calls.push(kind);
      return Promise.resolve({ ok: true, balance: 1000 });
    });
    const auction = new AuctionService(store, economy);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('diamond', 1));
    const listed = syncAuction(auction.createListing('ada', 'Ada', inventory, 0, 1, 10));
    const buyerInventory = new Inventory();
    const bought = await auction.buyListing('bea', 'Bea', buyerInventory, listed.listing!.listingId);
    expect(bought.ok).toBe(false);
    expect(bought.error).toBe(MONEY_REQUEST_REQUIRED);
    expect(buyerInventory.count('diamond')).toBe(0);
    expect(auction.getListing(listed.listing!.listingId)?.status).toBe('ACTIVE');

    const paid = await auction.buyListing('bea', 'Bea', buyerInventory, listed.listing!.listingId, {
      requestId: randomUUID(),
      operation: 'economy.auction_purchase',
      actorId: 'bea',
      payload: { listingId: listed.listing!.listingId },
    });
    expect(paid.ok).toBe(true);
    expect(calls).toEqual(['settle']);

    const buyer = new BuyerService(
      store,
      economy,
      new HologramNetwork(() => undefined),
      () => 'anarchy',
      () => Date.now(),
      () => 'aabbccdd',
    );
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50 });
    const sellInventory = new Inventory();
    sellInventory.addItem('pumpkin', 1);
    buyer.openTrade('ada', 'aabbccdd', sellInventory);
    await buyer.handleAction('ada', sellInventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: false,
      delete: false,
      use: true,
    });
    const unsold = await buyer.handleAction('ada', sellInventory, { type: 'buyer_action', action: 'sell' }, {
      edit: false,
      delete: false,
      use: true,
    });
    expect(unsold.ok).toBe(false);
    expect(unsold.error).toBe(MONEY_REQUEST_REQUIRED);
    expect(buyer.session('ada')?.tradeSlot?.count).toBe(1);
    expect(calls).toEqual(['settle']);

    const clans = new ClanService(store, economy);
    const missingFee = await clans.createClan('ada', 'North', 'crown');
    expect(missingFee.ok).toBe(false);
    expect(missingFee.error).toBe(MONEY_REQUEST_REQUIRED);
    expect(clans.playerClan('ada')).toBeUndefined();
    expect(calls).toEqual(['settle']);
    const request: EconomyCommandRequest = {
      requestId: randomUUID(),
      operation: 'economy.clan_create',
      actorId: 'ada',
      payload: { name: 'North', icon: 'crown' },
    };
    const created = await clans.createClan('ada', 'North', 'crown', request);
    expect(created.ok).toBe(true);
    expect(calls).toEqual(['settle', 'withdraw']);

    const trade = new TradeService(economy);
    const inventories = new Map<string, Inventory>([['ada', new Inventory()], ['bob', new Inventory()]]);
    trade.setRuntime({
      isOnline: () => true,
      displayName: (id) => id,
      lookupPlayer: (raw) => (raw.toLowerCase() === 'bob' ? { id: 'bob', name: 'Bob', connected: true } : undefined),
      inventory: (id) => inventories.get(id),
      balance: () => 1000,
      sendMessage: () => undefined,
    });
    trade.request('ada', 'Bob');
    trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId);
    trade.setMoney('ada', 25);
    trade.ready('ada');
    trade.ready('bob');
    trade.accept('ada');
    const missingTrade = await trade.accept('bob');
    expect(missingTrade.ok).toBe(false);
    expect(missingTrade.error).toBe(MONEY_REQUEST_REQUIRED);
    expect(calls.filter((kind) => kind === 'transfer')).toEqual([]);
    const settled = await trade.accept('bob', randomUUID());
    expect(settled.ok).toBe(true);
    expect(calls.filter((kind) => kind === 'transfer')).toEqual(['transfer']);
  });
});
