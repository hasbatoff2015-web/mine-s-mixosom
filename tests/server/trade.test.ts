import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService } from '../../server/services/economy';
import { TradeService, parseTradeMoney, type TradeOfferState, type TradeSession } from '../../server/services/trade';
import {
  TRADE_BUSY_ERROR,
  TRADE_ITEM_ERROR,
  TRADE_MONEY_BALANCE_ERROR,
  TRADE_MONEY_ERROR,
  TRADE_NOT_READY_ERROR,
  TRADE_SELF_ERROR,
  TRADE_SLOT_COUNT,
  TRADE_STACK_ERROR,
  isTradeSlotIndex,
  tradeSpaceError,
} from '../../shared/trade';

describe('Trade helpers', () => {
  it('accepts six offer slots and whole-number money', () => {
    expect(TRADE_SLOT_COUNT).toBe(6);
    expect(isTradeSlotIndex(0)).toBe(true);
    expect(isTradeSlotIndex(5)).toBe(true);
    expect(isTradeSlotIndex(6)).toBe(false);
    expect(parseTradeMoney(0)).toBe(0);
    expect(parseTradeMoney('12')).toBe(12);
    expect(parseTradeMoney(-1)).toBeUndefined();
    expect(parseTradeMoney('1.5')).toBeUndefined();
  });
});

describe('TradeService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-trade-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const trades = new TradeService(store, economy);
    const inventories = new Map<string, Inventory>([
      ['ada', new Inventory()],
      ['bob', new Inventory()],
    ]);
    const online = new Set(['ada', 'bob']);
    trades.setRuntime({
      isOnline: (id) => online.has(id),
      displayName: (id) => (id === 'ada' ? 'Ada' : id === 'bob' ? 'Bob' : id),
      lookupPlayer: (raw) => {
        const key = raw.trim().toLowerCase();
        if (key === 'ada') return { id: 'ada', name: 'Ada' };
        if (key === 'bob') return { id: 'bob', name: 'Bob' };
        return undefined;
      },
      inventory: (id) => inventories.get(id),
      flushInventory: () => undefined,
    });
    economy.deposit('ada', 200, 'ADMIN_GIVE');
    economy.deposit('bob', 50, 'ADMIN_GIVE');
    inventories.get('ada')!.setSlot(0, createItemStack('stone', 32));
    inventories.get('ada')!.setSlot(1, createItemStack('dirt', 16));
    inventories.get('bob')!.setSlot(0, createItemStack('oak_log', 8));
    return { trades, economy, inventories, online };
  }

  function open(trades: TradeService) {
    expect(trades.request('ada', 'Bob').ok).toBe(true);
    const accepted = trades.acceptRequest('bob', 'ada');
    expect(accepted.ok).toBe(true);
    return accepted.session!;
  }

  function offerOf(session: TradeSession, playerId: string): TradeOfferState {
    const offer = session.offers[playerId];
    if (!offer) throw new Error(`missing trade offer for ${playerId}`);
    return offer;
  }

  it('rejects self trades and forged money', async () => {
    const { trades } = await setup();
    expect(trades.request('ada', 'Ada').error).toBe(TRADE_SELF_ERROR);
    const session = open(trades);
    expect(offerOf(session, 'ada').slots).toHaveLength(6);
    expect(trades.setMoney('ada', -4).error).toBe(TRADE_MONEY_ERROR);
    expect(trades.setMoney('ada', 10_000).error).toBe(TRADE_MONEY_BALANCE_ERROR);
  });

  it('moves stacks into six offer slots and restores them on cancel', async () => {
    const { trades, inventories } = await setup();
    open(trades);
    trades.selectInventory('ada', 0);
    expect(trades.clickOfferSlot('ada', 0).ok).toBe(true);
    expect(inventories.get('ada')!.getSlot(0)).toBeNull();
    expect(offerOf(trades.sessionFor('ada')!, 'ada').slots[0]?.count).toBe(32);
    expect(trades.cancel('ada').ok).toBe(true);
    expect(inventories.get('ada')!.getSlot(0)?.itemId).toBe('stone');
    expect(inventories.get('ada')!.getSlot(0)?.count).toBe(32);
  });

  it('resets both ready flags when either offer changes', async () => {
    const { trades } = await setup();
    open(trades);
    expect(trades.ready('ada').ok).toBe(true);
    expect(trades.ready('bob').ok).toBe(true);
    trades.selectInventory('ada', 0);
    trades.clickOfferSlot('ada', 0);
    const session = trades.sessionFor('ada')!;
    expect(offerOf(session, 'ada').ready).toBe(false);
    expect(offerOf(session, 'bob').ready).toBe(false);
    expect(offerOf(session, 'ada').accepted).toBe(false);
    expect(offerOf(session, 'bob').accepted).toBe(false);
  });

  it('requires double ready then double accept and swaps atomically', async () => {
    const { trades, economy, inventories } = await setup();
    open(trades);
    trades.selectInventory('ada', 0);
    trades.clickOfferSlot('ada', 0);
    trades.selectInventory('bob', 0);
    trades.clickOfferSlot('bob', 1);
    expect(trades.setMoney('ada', 40).ok).toBe(true);
    expect(trades.accept('ada').error).toBe(TRADE_NOT_READY_ERROR);
    expect(trades.ready('ada').ok).toBe(true);
    expect(trades.ready('bob').ok).toBe(true);
    expect(trades.accept('ada').ok).toBe(true);
    expect(offerOf(trades.sessionFor('ada')!, 'ada').accepted).toBe(true);
    expect(offerOf(trades.sessionFor('bob')!, 'bob').accepted).toBe(false);
    const done = trades.accept('bob');
    expect(done.ok).toBe(true);
    expect(done.completed).toBe(true);
    expect(trades.sessionFor('ada')).toBeUndefined();
    expect(inventories.get('bob')!.slots.some((stack) => stack?.itemId === 'stone' && stack.count === 32)).toBe(true);
    expect(inventories.get('ada')!.slots.some((stack) => stack?.itemId === 'oak_log' && stack.count === 8)).toBe(true);
    expect(economy.getBalance('ada')).toBe(260);
    expect(economy.getBalance('bob')).toBe(190);
  });

  it('does not partial-commit when the partner has no inventory space', async () => {
    const { trades, economy, inventories } = await setup();
    const bob = inventories.get('bob')!;
    for (let i = 0; i < Inventory.SLOT_COUNT; i += 1) bob.setSlot(i, createItemStack('cobblestone', 64));
    open(trades);
    trades.selectInventory('ada', 0);
    trades.clickOfferSlot('ada', 0);
    trades.ready('ada');
    trades.ready('bob');
    trades.accept('ada');
    const result = trades.accept('bob');
    expect(result.ok).toBe(false);
    expect(result.error).toBe(tradeSpaceError('Bob'));
    expect(trades.sessionFor('ada')).toBeDefined();
    expect(economy.getBalance('ada')).toBe(300);
    expect(bob.getSlot(0)?.itemId).toBe('cobblestone');
  });

  it('cancels on disconnect and returns escrow without taking money', async () => {
    const { trades, economy, inventories, online } = await setup();
    open(trades);
    trades.selectInventory('ada', 0);
    trades.clickOfferSlot('ada', 0);
    trades.setMoney('ada', 25);
    online.delete('ada');
    expect(trades.disconnect('ada').ok).toBe(true);
    expect(trades.sessionFor('bob')).toBeUndefined();
    expect(inventories.get('ada')!.slots.some((stack) => stack?.itemId === 'stone')).toBe(true);
    expect(economy.getBalance('ada')).toBe(300);
  });

  it('locks concurrent accept attempts', async () => {
    const { trades } = await setup();
    open(trades);
    trades.ready('ada');
    trades.ready('bob');
    const session = trades.sessionFor('ada')!;
    const first = trades.accept('ada');
    expect(first.ok).toBe(true);
    const busy = (trades as unknown as { locks: Set<string> }).locks;
    busy.add(session.leftId);
    expect(trades.accept('bob').error).toBe(TRADE_BUSY_ERROR);
    busy.delete(session.leftId);
  });

  it('ignores a repeated ready and clears own accept when ready is pressed again', async () => {
    const { trades } = await setup();
    open(trades);
    expect(trades.ready('ada').ok).toBe(true);
    expect(trades.ready('ada').ok).toBe(true);
    expect(offerOf(trades.sessionFor('ada')!, 'ada').ready).toBe(true);
    expect(trades.ready('bob').ok).toBe(true);
    expect(trades.accept('ada').ok).toBe(true);
    expect(offerOf(trades.sessionFor('ada')!, 'ada').accepted).toBe(true);
    expect(trades.ready('ada').ok).toBe(true);
    expect(offerOf(trades.sessionFor('ada')!, 'ada').accepted).toBe(false);
    expect(trades.sessionFor('ada')).toBeDefined();
  });

  it('rejects forged slot indexes and a second request while trading', async () => {
    const { trades, inventories } = await setup();
    open(trades);
    expect(trades.clickOfferSlot('ada', 6).error).toBe(TRADE_ITEM_ERROR);
    expect(trades.clickOfferSlot('ada', -1).error).toBe(TRADE_ITEM_ERROR);
    expect(trades.clickOfferSlot('ada', 1.5).error).toBe(TRADE_ITEM_ERROR);
    expect(trades.selectInventory('ada', 999).ok).toBe(false);
    expect(trades.request('ada', 'Bob').error).toBe(TRADE_BUSY_ERROR);
    expect(inventories.get('ada')!.getSlot(0)?.count).toBe(32);
  });

  it('does not move money when an offer changes after accept', async () => {
    const { trades, economy } = await setup();
    open(trades);
    trades.setMoney('ada', 40);
    trades.ready('ada');
    trades.ready('bob');
    expect(trades.accept('ada').ok).toBe(true);
    trades.setMoney('ada', 60);
    const session = trades.sessionFor('ada')!;
    expect(offerOf(session, 'ada').ready).toBe(false);
    expect(offerOf(session, 'ada').accepted).toBe(false);
    expect(offerOf(session, 'bob').ready).toBe(false);
    expect(trades.accept('bob').error).toBe(TRADE_NOT_READY_ERROR);
    expect(economy.getBalance('ada')).toBe(300);
    expect(economy.getBalance('bob')).toBe(150);
  });

  it('rejects overfill beyond the item stack cap', async () => {
    const { trades, inventories } = await setup();
    inventories.get('ada')!.setSlot(2, createItemStack('stone', 40));
    open(trades);
    trades.selectInventory('ada', 0);
    trades.clickOfferSlot('ada', 0);
    trades.selectInventory('ada', 2);
    expect(trades.clickOfferSlot('ada', 0).ok).toBe(true);
    expect(offerOf(trades.sessionFor('ada')!, 'ada').slots[0]?.count).toBe(64);
    expect(inventories.get('ada')!.getSlot(2)?.count).toBe(8);
    inventories.get('ada')!.setSlot(3, createItemStack('stone', 1));
    trades.selectInventory('ada', 3);
    expect(trades.clickOfferSlot('ada', 0).error).toBe(TRADE_STACK_ERROR);
  });
});
