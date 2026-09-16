import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService } from '../../server/services/economy';
import { TradeService } from '../../server/services/trade';
import {
  TRADE_BUSY_ERROR,
  TRADE_MONEY_ERROR,
  TRADE_NOT_READY_ERROR,
  TRADE_SELF_ERROR,
  TRADE_SLOT_COUNT,
  tradeInventoryFullError,
} from '../../shared/trade';

function countItem(inventory: Inventory, itemId: string): number {
  let total = 0;
  for (let index = 0; index < Inventory.SLOT_COUNT; index += 1) {
    const stack = inventory.getSlot(index);
    if (stack?.itemId === itemId) total += stack.count;
  }
  return total;
}

describe('TradeService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-trade-'));
    dirs.push(dir);
    const inventories = new Map<string, Inventory>([
      ['ada', new Inventory()],
      ['bob', new Inventory()],
    ]);
    const online = new Set(['ada', 'bob']);
    const economy = new EconomyService(new JsonFileStore(dir));
    economy.rememberName('ada', 'Ada');
    economy.rememberName('bob', 'Bob');
    const trade = new TradeService(economy);
    trade.setRuntime({
      isOnline: (id) => online.has(id),
      displayName: (id) => (id === 'ada' ? 'Ada' : id === 'bob' ? 'Bob' : id),
      lookupPlayer: (raw) => {
        const name = raw.trim().toLowerCase();
        if (name === 'ada') return { id: 'ada', name: 'Ada', connected: online.has('ada') };
        if (name === 'bob') return { id: 'bob', name: 'Bob', connected: online.has('bob') };
        return undefined;
      },
      inventory: (id) => inventories.get(id),
      balance: (id) => economy.getBalance(id),
      sendMessage: () => undefined,
    });
    return { trade, economy, inventories, online };
  }

  it('rejects self-trade and duplicate active sessions', async () => {
    const { trade } = await setup();
    expect(trade.request('ada', 'Ada').error).toBe(TRADE_SELF_ERROR);
    expect(trade.request('ada', 'Bob').ok).toBe(true);
    const request = trade.incomingRequests('bob')[0]!;
    expect(trade.acceptRequest('bob', request.requestId).ok).toBe(true);
    expect(trade.request('ada', 'Bob').error).toBe(TRADE_BUSY_ERROR);
  });

  it('moves stacks into six trade slots and resets ready after offer changes', async () => {
    const { trade, inventories } = await setup();
    inventories.get('ada')!.setSlot(0, createItemStack('stone', 32));
    trade.request('ada', 'Bob');
    trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId);
    expect(trade.putItem('ada', 0, 0).ok).toBe(true);
    expect(inventories.get('ada')!.getSlot(0)).toBeNull();
    expect(trade.sessionFor('ada')!.offers.ada!.slots[0]?.count).toBe(32);
    expect(trade.sessionFor('ada')!.offers.ada!.slots).toHaveLength(TRADE_SLOT_COUNT);
    expect(trade.ready('ada').ok).toBe(true);
    expect(trade.ready('bob').ok).toBe(true);
    expect(trade.setMoney('ada', 10).ok).toBe(true);
    expect(trade.sessionFor('ada')!.offers.ada!.ready).toBe(false);
    expect(trade.sessionFor('bob')!.offers.bob!.ready).toBe(false);
    expect(trade.accept('ada').error).toBe(TRADE_NOT_READY_ERROR);
  });

  it('completes an atomic item+money swap only after both ready and accept', async () => {
    const { trade, economy, inventories } = await setup();
    inventories.get('ada')!.setSlot(0, createItemStack('diamond', 2));
    inventories.get('bob')!.setSlot(0, createItemStack('oak_log', 8));
    trade.request('ada', 'Bob');
    trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId);
    expect(trade.putItem('ada', 0, 0).ok).toBe(true);
    expect(trade.putItem('bob', 0, 0).ok).toBe(true);
    expect(trade.setMoney('ada', 15).ok).toBe(true);
    expect(trade.ready('ada').ok).toBe(true);
    expect(trade.ready('bob').ok).toBe(true);
    expect(trade.accept('ada').ok).toBe(true);
    expect(trade.sessionFor('ada')).toBeDefined();
    const done = trade.accept('bob');
    expect(done.ok).toBe(true);
    expect(done.completed).toBe(true);
    expect(trade.sessionFor('ada')).toBeUndefined();
    expect(countItem(inventories.get('ada')!, 'oak_log')).toBe(8);
    expect(countItem(inventories.get('bob')!, 'diamond')).toBe(2);
    expect(economy.getBalance('bob') - economy.getBalance('ada')).toBe(30);
  });

  it('cancels on disconnect, returns items, and refuses a full destination inventory', async () => {
    const { trade, inventories, online, economy } = await setup();
    inventories.get('ada')!.setSlot(0, createItemStack('stone', 16));
    trade.request('ada', 'Bob');
    trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId);
    expect(trade.putItem('ada', 0, 0).ok).toBe(true);
    const before = economy.getBalance('ada');
    online.delete('bob');
    const cancelled = trade.disconnect('bob');
    expect(cancelled.closed).toBe(true);
    expect(countItem(inventories.get('ada')!, 'stone')).toBe(16);
    expect(economy.getBalance('ada')).toBe(before);

    inventories.get('ada')!.setSlot(1, createItemStack('dirt', 64));
    inventories.get('bob')!.clear();
    for (let index = 0; index < Inventory.SLOT_COUNT; index += 1) {
      inventories.get('bob')!.setSlot(index, createItemStack('cobblestone', 64));
    }
    online.add('bob');
    trade.request('ada', 'Bob');
    trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId);
    expect(trade.putItem('ada', 1, 0).ok).toBe(true);
    expect(trade.ready('ada').ok).toBe(true);
    expect(trade.ready('bob').ok).toBe(true);
    trade.accept('ada');
    const blocked = trade.accept('bob');
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe(tradeInventoryFullError('Bob'));
    expect(countItem(inventories.get('ada')!, 'dirt')).toBe(0);
    expect(trade.sessionFor('ada')).toBeDefined();
  });

  it('rejects money above the current balance', async () => {
    const { trade, economy } = await setup();
    trade.request('ada', 'Bob');
    trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId);
    expect(trade.setMoney('ada', economy.getBalance('ada') + 1).error).toBe(TRADE_MONEY_ERROR);
    expect(trade.setMoney('ada', -1).error).toBe(TRADE_MONEY_ERROR);
  });
});
