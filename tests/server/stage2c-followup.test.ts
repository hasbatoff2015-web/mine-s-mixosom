import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Inventory, cloneStack, createItemStack } from '../../src/inventory';
import type { ItemStack } from '../../src/inventory/types';
import type { Database, Queryable } from '../../server/db/types';
import { hashPayload } from '../../server/db/canonicalJson';
import type { CurrencyPort, EconomyCommandRequest } from '../../server/economy/currencyPort';
import { syncAuction, AuctionService } from '../../server/services/auction';
import { BuyerService } from '../../server/services/buyer';
import { ClanService } from '../../server/services/clan';
import { EconomyService } from '../../server/services/economy';
import { HologramNetwork } from '../../server/services/holograms';
import { JsonFileStore } from '../../server/services/jsonStore';
import { TradeService } from '../../server/services/trade';
import type { ItemDurability, ItemEffectResult } from '../../server/settlements/durability';
import { buyerConsumedReceipt, tradeEscrowReceipt } from '../../server/settlements/receipts';
import { PostgresSettlementRepository } from '../../server/settlements/repository';
import { SettlementService } from '../../server/settlements/service';
import { SettlementConflictError, type BeginSettlementInput, type SettlementPhase, type SettlementRow } from '../../server/settlements/types';

const SWORD: ItemStack = {
  itemId: 'iron_sword',
  count: 1,
  durability: 10,
  metadata: { enchantments: [{ id: 'sharpness', level: 1 }] },
};

class MemorySettlements {
  readonly rows = new Map<string, SettlementRow>();

  async begin(_tx: Queryable, input: BeginSettlementInput): Promise<SettlementRow> {
    const existing = this.rows.get(input.settlementId);
    const payloadHash = hashPayload(input.payload);
    if (existing) {
      if (existing.kind !== input.kind || existing.payloadHash !== payloadHash) throw new SettlementConflictError();
      return existing;
    }
    const row: SettlementRow = {
      settlementId: input.settlementId,
      deploymentId: 'test',
      economyScope: 'anarchy',
      worldId: 'anarchy',
      kind: input.kind,
      phase: 'PREPARED',
      requestId: input.requestId ?? null,
      payload: input.payload,
      payloadHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      lastErrorCode: null,
    };
    this.rows.set(row.settlementId, row);
    return row;
  }

  async get(_tx: Queryable, settlementId: string): Promise<SettlementRow | null> {
    return this.rows.get(settlementId) ?? null;
  }

  async transition(_tx: Queryable, settlementId: string, from: SettlementPhase, to: SettlementPhase): Promise<SettlementRow> {
    const row = this.rows.get(settlementId);
    if (!row || row.phase !== from) throw new Error(`${from} -> ${to}`);
    const next: SettlementRow = {
      ...row,
      phase: to,
      updatedAt: new Date().toISOString(),
      completedAt: to === 'COMPLETE' || to === 'CANCELLED' ? new Date().toISOString() : null,
    };
    this.rows.set(settlementId, next);
    return next;
  }

  async listOpen(): Promise<readonly SettlementRow[]> {
    return [...this.rows.values()].filter((row) => row.phase !== 'COMPLETE' && row.phase !== 'CANCELLED');
  }
}

function settlementService(memory = new MemorySettlements()): { service: SettlementService; memory: MemorySettlements } {
  const database = {
    enabled: true,
    deploymentId: 'test',
    appliedMigrations: [],
    start: async () => undefined,
    close: async () => undefined,
    query: async () => ({ rows: [], rowCount: 0 }),
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
  } as Database;
  return { service: new SettlementService(database, memory as unknown as PostgresSettlementRepository), memory };
}

interface PlayerFile {
  inventory: unknown;
  receipts: string[];
}

class Disk implements ItemDurability {
  readonly inventories = new Map<string, Inventory>();
  readonly receipts = new Map<string, Set<string>>();
  readonly files = new Map<string, string>();

  constructor(players: Record<string, Inventory>) {
    for (const [id, inventory] of Object.entries(players)) {
      this.inventories.set(id, inventory);
      this.commit(id);
    }
  }

  private setOf(playerId: string): Set<string> {
    const existing = this.receipts.get(playerId);
    if (existing) return existing;
    const created = new Set<string>();
    this.receipts.set(playerId, created);
    return created;
  }

  private commit(playerId: string): void {
    const inventory = this.inventories.get(playerId);
    const file: PlayerFile = {
      inventory: inventory ? inventory.serialize() : null,
      receipts: [...(this.receipts.get(playerId) ?? [])],
    };
    this.files.set(playerId, JSON.stringify(file));
  }

  reload(): Disk {
    const next = new Disk({});
    for (const [id, raw] of this.files) {
      const parsed = JSON.parse(raw) as PlayerFile;
      next.inventories.set(id, Inventory.deserialize(parsed.inventory));
      next.receipts.set(id, new Set(parsed.receipts));
      next.commit(id);
    }
    return next;
  }

  hasReceipt(playerId: string, receipt: string): boolean {
    return this.setOf(playerId).has(receipt);
  }

  async escrow(playerId: string, receipt: string): Promise<void> {
    this.setOf(playerId).add(receipt);
    this.commit(playerId);
  }

  async deliver(playerId: string, receipt: string, stack: ItemStack): Promise<ItemEffectResult> {
    return this.deliverAll(playerId, receipt, [stack]);
  }

  async deliverAll(playerId: string, receipt: string, stacks: readonly ItemStack[]): Promise<ItemEffectResult> {
    if (this.hasReceipt(playerId, receipt)) return 'already';
    const inventory = this.inventories.get(playerId);
    if (!inventory) return 'missing';
    const copy = inventory.clone();
    for (const stack of stacks) {
      if (copy.add(structuredClone(stack)) !== null) return 'full';
    }
    inventory.restore(copy.serialize());
    this.setOf(playerId).add(receipt);
    this.commit(playerId);
    return 'delivered';
  }

  async restore(playerId: string, receipt: string, stack: ItemStack): Promise<ItemEffectResult> {
    return this.restoreAll(playerId, receipt, [stack]);
  }

  async restoreAll(playerId: string, receipt: string, stacks: readonly ItemStack[]): Promise<ItemEffectResult> {
    if (!this.hasReceipt(playerId, receipt)) return 'already';
    const inventory = this.inventories.get(playerId);
    if (!inventory) return 'missing';
    const copy = inventory.clone();
    for (const stack of stacks) {
      if (copy.add(structuredClone(stack)) !== null) return 'full';
    }
    inventory.restore(copy.serialize());
    this.setOf(playerId).delete(receipt);
    this.commit(playerId);
    return 'restored';
  }

  async dropReceipt(playerId: string, receipt: string): Promise<void> {
    this.setOf(playerId).delete(receipt);
    this.commit(playerId);
  }

  persist(playerId: string): void {
    this.commit(playerId);
  }

  total(playerId: string, itemId: string): number {
    return this.inventories.get(playerId)?.count(itemId) ?? 0;
  }
}

function fill(inventory: Inventory, itemId = 'cobblestone'): void {
  inventory.clear();
  for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
    inventory.setSlot(slot, createItemStack(itemId, 64));
  }
}

function stacks(inventory: Inventory, itemId: string): ItemStack[] {
  const found: ItemStack[] = [];
  for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
    const stack = inventory.getSlot(slot);
    if (stack?.itemId === itemId) found.push(stack);
  }
  return found;
}

function phaseOf(memory: MemorySettlements, kind?: string): string | undefined {
  return [...memory.rows.values()].find((row) => !kind || row.kind === kind)?.phase;
}

async function until(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40 && !ready(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function moneyRequest(actorId: string, operation: EconomyCommandRequest['operation'], payload: EconomyCommandRequest['payload']): EconomyCommandRequest {
  return { requestId: randomUUID(), operation, actorId, payload };
}

interface TradeEnv {
  trade: TradeService;
  disk: Disk;
  memory: MemorySettlements;
  online: Set<string>;
  calls: Array<{ delta: number }>;
}

function tradeHarness(options: { moneyOk?: boolean; adaMoney?: number; bobMoney?: number } = {}): TradeEnv {
  const ada = new Inventory();
  const bob = new Inventory();
  ada.setSlot(0, createItemStack('diamond', 1));
  bob.setSlot(0, cloneStack(SWORD)!);
  const disk = new Disk({ ada, bob });
  const { service, memory } = settlementService();
  const calls: Array<{ delta: number }> = [];
  const economy = {
    backend: 'postgres' as const,
    settleNet: async (_a: string, _b: string, delta: number) => {
      calls.push({ delta });
      return options.moneyOk === false
        ? { ok: false, error: 'Недостаточно Мегакоинов.' }
        : { ok: true, amount: Math.abs(delta) };
    },
    getBalance: () => 1000,
    transfer: async () => ({ ok: true }),
  } as unknown as CurrencyPort;
  const trade = new TradeService(economy);
  const online = new Set(['ada', 'bob']);
  trade.setRuntime({
    isOnline: (id) => online.has(id),
    displayName: (id) => id,
    lookupPlayer: (raw) => ({ id: raw.toLowerCase(), name: raw, connected: online.has(raw.toLowerCase()) }),
    inventory: (id) => (online.has(id) ? disk.inventories.get(id) : undefined),
    balance: () => 1000,
    sendMessage: () => undefined,
  });
  trade.setStage2C({ durability: disk, settlements: service });
  trade.request('ada', 'bob');
  trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId);
  trade.putItem('ada', 0, 0);
  trade.putItem('bob', 0, 0);
  if (options.adaMoney) trade.setMoney('ada', options.adaMoney);
  if (options.bobMoney) trade.setMoney('bob', options.bobMoney);
  trade.ready('ada');
  trade.ready('bob');
  trade.accept('ada');
  return { trade, disk, memory, online, calls };
}

/** Same merge WorldInstance uses: offers stay in the saved inventory until the escrow receipt exists. */
function captureTrade(disk: Disk, trade: TradeService): string {
  const players: Record<string, PlayerFile> = {};
  for (const id of disk.inventories.keys()) {
    const copy = disk.inventories.get(id)!.clone();
    const receipts = new Set(disk.receipts.get(id) ?? []);
    for (const stack of trade.unsavedOfferStacks(id, receipts)) {
      if (copy.add(cloneStack(stack)!) !== null) throw new Error(`snapshot dropped ${id}`);
    }
    players[id] = { inventory: copy.serialize(), receipts: [...receipts] };
  }
  return JSON.stringify(players);
}

function bootTrade(raw: string, memory: MemorySettlements): { trade: TradeService; disk: Disk; calls: Array<{ delta: number }> } {
  const parsed = JSON.parse(raw) as Record<string, PlayerFile>;
  const disk = new Disk({});
  for (const [id, saved] of Object.entries(parsed)) {
    disk.inventories.set(id, Inventory.deserialize(saved.inventory));
    disk.receipts.set(id, new Set(saved.receipts));
    disk.files.set(id, JSON.stringify(saved));
  }
  const { service } = settlementService(memory);
  const calls: Array<{ delta: number }> = [];
  const economy = {
    backend: 'postgres' as const,
    settleNet: async (_a: string, _b: string, delta: number) => {
      calls.push({ delta });
      return { ok: true, amount: Math.abs(delta) };
    },
    getBalance: () => 1000,
  } as unknown as CurrencyPort;
  const trade = new TradeService(economy);
  const online = new Set<string>();
  trade.setRuntime({
    isOnline: (id) => online.has(id),
    displayName: (id) => id,
    lookupPlayer: () => undefined,
    inventory: () => undefined,
    balance: () => 1000,
    sendMessage: () => undefined,
  });
  trade.setStage2C({ durability: disk, settlements: service });
  return { trade, disk, calls };
}

describe('stage 2C trade crash boundaries', () => {
  it('keeps the offer in the saved inventory when the journal exists and escrow does not', async () => {
    const { trade, disk, memory } = tradeHarness();
    trade.haltAfter = 'trade-prepared';
    const result = await trade.accept('bob', randomUUID());
    expect(result.ok).toBe(false);
    expect(phaseOf(memory)).toBe('PREPARED');
    expect(disk.hasReceipt('ada', tradeEscrowReceipt([...memory.rows.keys()][0]!))).toBe(false);
    expect(disk.total('ada', 'diamond')).toBe(0);
    const saved = captureTrade(disk, trade);
    const restarted = bootTrade(saved, memory);
    expect(restarted.disk.total('ada', 'diamond')).toBe(1);
    expect(restarted.disk.total('bob', 'iron_sword')).toBe(1);
    expect(await restarted.trade.recoverTrades(async () => false)).toBe(1);
    expect(restarted.disk.total('ada', 'diamond')).toBe(1);
    expect(restarted.disk.total('bob', 'iron_sword')).toBe(1);
    expect(phaseOf(memory)).toBe('CANCELLED');
    expect(await restarted.trade.recoverTrades(async () => false)).toBe(0);
    expect(restarted.calls).toEqual([]);
  });

  it('restores only the escrowed side after a crash between the two receipts', async () => {
    const { trade, disk, memory } = tradeHarness();
    trade.haltAfter = 'trade-escrow-a';
    await trade.accept('bob', randomUUID());
    const settlementId = [...memory.rows.keys()][0]!;
    expect(disk.hasReceipt('ada', tradeEscrowReceipt(settlementId))).toBe(true);
    expect(disk.hasReceipt('bob', tradeEscrowReceipt(settlementId))).toBe(false);
    const restarted = bootTrade(captureTrade(disk, trade), memory);
    expect(restarted.disk.total('ada', 'diamond')).toBe(0);
    expect(restarted.disk.total('bob', 'iron_sword')).toBe(1);
    await restarted.trade.recoverTrades(async () => false);
    expect(restarted.disk.total('ada', 'diamond')).toBe(1);
    expect(restarted.disk.total('bob', 'iron_sword')).toBe(1);
    expect(stacks(restarted.disk.inventories.get('bob')!, 'iron_sword')[0]).toMatchObject(SWORD);
    expect(phaseOf(memory)).toBe('CANCELLED');
    await restarted.trade.recoverTrades(async () => false);
    expect(restarted.disk.total('ada', 'diamond')).toBe(1);
    expect(restarted.disk.total('bob', 'iron_sword')).toBe(1);
  });

  it('returns both original offers when both escrows exist and money does not', async () => {
    const { trade, disk, memory, calls } = tradeHarness({ adaMoney: 40 });
    trade.haltAfter = 'trade-escrowed';
    await trade.accept('bob', randomUUID());
    expect(calls).toEqual([]);
    expect(phaseOf(memory)).toBe('ESCROW_DURABLE');
    const restarted = bootTrade(captureTrade(disk, trade), memory);
    expect(restarted.disk.total('ada', 'diamond')).toBe(0);
    expect(restarted.disk.total('bob', 'iron_sword')).toBe(0);
    await restarted.trade.recoverTrades(async () => false);
    expect(restarted.disk.total('ada', 'diamond')).toBe(1);
    expect(restarted.disk.total('bob', 'iron_sword')).toBe(1);
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(0);
    expect(restarted.disk.total('bob', 'diamond')).toBe(0);
    expect(phaseOf(memory)).toBe('CANCELLED');
    expect(restarted.calls).toEqual([]);
  });

  it('delivers a paid trade to offline players exactly once', async () => {
    const { trade, disk, memory, calls } = tradeHarness();
    trade.haltAfter = 'trade-money';
    await trade.accept('bob', randomUUID());
    expect(calls).toEqual([{ delta: 0 }]);
    expect(phaseOf(memory)).toBe('MONEY_COMMITTED');
    const restarted = bootTrade(captureTrade(disk, trade), memory);
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(0);
    expect(restarted.disk.total('bob', 'diamond')).toBe(0);
    expect(await restarted.trade.recoverTrades(async () => true)).toBe(1);
    expect(phaseOf(memory)).toBe('COMPLETE');
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(1);
    expect(restarted.disk.total('bob', 'diamond')).toBe(1);
    expect(stacks(restarted.disk.inventories.get('ada')!, 'iron_sword')[0]).toMatchObject(SWORD);
    expect(restarted.calls).toEqual([]);
    expect(await restarted.trade.recoverTrades(async () => true)).toBe(0);
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(1);
    expect(restarted.disk.total('bob', 'diamond')).toBe(1);
  });

  it('delivers when money committed before the phase advance', async () => {
    const { trade, disk, memory, calls } = tradeHarness({ bobMoney: 25 });
    trade.haltAfter = 'trade-paid';
    await trade.accept('bob', randomUUID());
    expect(calls).toEqual([{ delta: 25 }]);
    expect(phaseOf(memory)).toBe('ESCROW_DURABLE');
    const restarted = bootTrade(captureTrade(disk, trade), memory);
    expect(restarted.disk.total('bob', 'diamond')).toBe(0);
    expect(await restarted.trade.recoverTrades(async () => true)).toBe(1);
    expect(phaseOf(memory)).toBe('COMPLETE');
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(1);
    expect(restarted.disk.total('bob', 'diamond')).toBe(1);
    expect(restarted.calls).toEqual([]);
    expect(await restarted.trade.recoverTrades(async () => true)).toBe(0);
    expect(restarted.disk.total('bob', 'diamond')).toBe(1);
  });

  it('delivers only the missing side after one delivery receipt', async () => {
    const { trade, disk, memory } = tradeHarness({ adaMoney: 15, bobMoney: 15 });
    trade.haltAfter = 'trade-delivered-a';
    await trade.accept('bob', randomUUID());
    const restarted = bootTrade(captureTrade(disk, trade), memory);
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(1);
    expect(restarted.disk.total('bob', 'diamond')).toBe(0);
    await restarted.trade.recoverTrades(async () => true);
    expect(phaseOf(memory)).toBe('COMPLETE');
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(1);
    expect(restarted.disk.total('bob', 'diamond')).toBe(1);
    expect(restarted.disk.total('ada', 'diamond')).toBe(0);
    await restarted.trade.recoverTrades(async () => true);
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(1);
    expect(restarted.disk.total('bob', 'diamond')).toBe(1);
    expect(restarted.calls).toEqual([]);
  });

  it('does not complete or partially insert when the offline recipient is full or missing', async () => {
    const { trade, disk, memory } = tradeHarness();
    trade.haltAfter = 'trade-money';
    await trade.accept('bob', randomUUID());
    const saved = JSON.parse(captureTrade(disk, trade)) as Record<string, PlayerFile>;
    const full = new Inventory();
    fill(full);
    saved.bob = { inventory: full.serialize(), receipts: saved.bob!.receipts };
    const restarted = bootTrade(JSON.stringify(saved), memory);
    expect(await restarted.trade.recoverTrades(async () => true)).toBe(0);
    expect(phaseOf(memory)).not.toBe('COMPLETE');
    expect(restarted.disk.total('bob', 'diamond')).toBe(0);
    expect(stacks(restarted.disk.inventories.get('bob')!, 'cobblestone')).toHaveLength(Inventory.SLOT_COUNT);
    restarted.disk.inventories.delete('bob');
    expect(await restarted.trade.recoverTrades(async () => true)).toBe(0);
    expect(phaseOf(memory)).not.toBe('COMPLETE');
    const freed = new Inventory();
    fill(freed);
    freed.setSlot(0, null);
    restarted.disk.inventories.set('bob', freed);
    expect(await restarted.trade.recoverTrades(async () => true)).toBe(1);
    expect(phaseOf(memory)).toBe('COMPLETE');
    expect(restarted.disk.total('bob', 'diamond')).toBe(1);
    expect(restarted.disk.total('ada', 'iron_sword')).toBe(1);
    expect(await restarted.trade.recoverTrades(async () => true)).toBe(0);
    expect(restarted.disk.total('bob', 'diamond')).toBe(1);
  });

  it('freezes both offers while final settlement is awaiting money', async () => {
    const { trade, disk } = tradeHarness({ adaMoney: 10 });
    let release: () => void = () => {};
    let entered = false;
    const economy = (trade as unknown as {
      economy: { settleNet: (a: string, b: string, delta: number) => Promise<{ ok: boolean }> };
    }).economy;
    economy.settleNet = (_a, _b, delta) => {
      entered = true;
      expect(delta).toBe(-10);
      return new Promise((resolve) => { release = () => resolve({ ok: true }); });
    };
    const pending = trade.accept('bob', randomUUID());
    await until(() => entered);
    expect(trade.cancel('ada').ok).toBe(false);
    expect(trade.disconnect('bob').ok).toBe(false);
    expect(trade.putItem('ada', 0, 0).ok).toBe(false);
    expect(trade.returnItem('bob', 0).ok).toBe(false);
    expect(trade.setMoney('ada', 0).ok).toBe(false);
    expect(trade.ready('ada').ok).toBe(false);
    expect(trade.accept('bob', randomUUID()).ok).toBe(false);
    expect(disk.total('ada', 'diamond') + disk.total('bob', 'diamond')).toBe(0);
    release();
    const done = await pending;
    expect(done.ok).toBe(true);
    expect(disk.total('ada', 'diamond') + disk.total('bob', 'diamond')).toBe(1);
    expect(disk.total('ada', 'iron_sword') + disk.total('bob', 'iron_sword')).toBe(1);
  });

  it('returns a failed payment to exactly one owner and does not stay restartable as a second copy', async () => {
    const { trade, disk, memory, calls } = tradeHarness({ moneyOk: false });
    const done = await trade.accept('bob', randomUUID());
    expect(done.ok).toBe(false);
    expect(phaseOf(memory)).toBe('CANCELLED');
    expect(disk.total('ada', 'diamond')).toBe(1);
    expect(disk.total('bob', 'iron_sword')).toBe(1);
    expect(calls).toEqual([{ delta: 0 }]);
    expect(trade.sessionFor('ada')).toBeUndefined();
    const restarted = bootTrade(captureTrade(disk, trade), memory);
    expect(await restarted.trade.recoverTrades(async () => false)).toBe(0);
    expect(restarted.disk.total('ada', 'diamond')).toBe(1);
    expect(restarted.disk.total('bob', 'iron_sword')).toBe(1);
  });
});

describe('stage 2C buyer sale failure', () => {
  function buyerEnv(deposit: CurrencyPort['deposit']) {
    const dir = mkdtempSync(join(tmpdir(), 'fc-s2c-buyer-'));
    const store = new JsonFileStore(dir);
    const inventory = new Inventory();
    inventory.setSlot(0, { itemId: 'diamond', count: 2, metadata: { origin: 'sale' } });
    const disk = new Disk({ ada: inventory });
    const { service, memory } = settlementService();
    const economy = { backend: 'postgres' as const, deposit } as unknown as CurrencyPort;
    const buyer = new BuyerService(store, economy, new HologramNetwork(() => undefined), () => 'anarchy', () => 1, () => 'aabbccdd');
    buyer.setStage2C({ durability: disk, settlements: service });
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'diamond', pricePerItem: 10 });
    buyer.openTrade('ada', 'aabbccdd', inventory);
    return { dir, store, disk, memory, service, buyer, inventory };
  }

  async function selectAndSell(
    env: ReturnType<typeof buyerEnv>,
    requestId = randomUUID(),
  ) {
    await env.buyer.handleAction('ada', env.inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, { edit: false, delete: false, use: true });
    return env.buyer.handleAction('ada', env.inventory, {
      type: 'buyer_action',
      action: 'sell',
      clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
  }

  it('returns a rejected credit to the ordinary inventory and not the trade slot', async () => {
    let credits = 0;
    const env = buyerEnv(async () => {
      credits += 1;
      return { ok: false, error: 'Превышен максимальный баланс.' };
    });
    const requestId = randomUUID();
    const sold = await selectAndSell(env, requestId);
    expect(sold.ok).toBe(false);
    expect(env.buyer.unsavedTradeSlot('ada')).toBeNull();
    expect(env.disk.total('ada', 'diamond')).toBe(2);
    expect(stacks(env.inventory, 'diamond')[0]?.metadata).toEqual({ origin: 'sale' });
    expect(env.disk.hasReceipt('ada', buyerConsumedReceipt(requestId))).toBe(false);
    expect(phaseOf(env.memory, 'BUYER_SALE')).toBe('CANCELLED');
    const reloaded = env.disk.reload();
    expect(reloaded.total('ada', 'diamond')).toBe(2);
    const again = await selectAndSell({ ...env, inventory: env.disk.inventories.get('ada')! }, requestId);
    expect(again.ok).toBe(false);
    expect(credits).toBe(1);
    expect(env.disk.total('ada', 'diamond') + (env.buyer.unsavedTradeSlot('ada')?.count ?? 0)).toBe(2);
  });

  it('restores one stack after a receipt when credit never landed, including a thrown debit', async () => {
    const env = buyerEnv(async () => { throw new Error('connection reset'); });
    env.buyer.haltAfter = 'sale-escrowed';
    const requestId = randomUUID();
    const halted = await selectAndSell(env, requestId);
    expect(halted.ok).toBe(false);
    expect(env.buyer.unsavedTradeSlot('ada')).toBeNull();
    expect(env.disk.total('ada', 'diamond')).toBe(0);
    expect(env.disk.hasReceipt('ada', buyerConsumedReceipt(requestId))).toBe(true);
    const disk = env.disk.reload();
    const buyer = new BuyerService(env.store, { backend: 'postgres', deposit: async () => { throw new Error('no'); } } as unknown as CurrencyPort, new HologramNetwork(() => undefined));
    const { service } = settlementService(env.memory);
    buyer.setStage2C({ durability: disk, settlements: service });
    expect(await buyer.recoverSales(async () => false)).toBe(1);
    expect(disk.total('ada', 'diamond')).toBe(2);
    expect(stacks(disk.inventories.get('ada')!, 'diamond')[0]?.metadata).toEqual({ origin: 'sale' });
    expect(phaseOf(env.memory, 'BUYER_SALE')).toBe('CANCELLED');
    expect(await buyer.recoverSales(async () => false)).toBe(0);
    expect(disk.reload().total('ada', 'diamond')).toBe(2);
  });

  it('restores one stack when the credit call throws after the receipt', async () => {
    const env = buyerEnv(async () => { throw new Error('connection reset'); });
    const requestId = randomUUID();
    await expect(selectAndSell(env, requestId)).rejects.toThrow('connection reset');
    expect(env.buyer.unsavedTradeSlot('ada')).toBeNull();
    expect(env.disk.total('ada', 'diamond')).toBe(0);
    expect(env.disk.hasReceipt('ada', buyerConsumedReceipt(requestId))).toBe(true);
    const disk = env.disk.reload();
    const buyer = new BuyerService(env.store, { backend: 'postgres', deposit: async () => { throw new Error('no'); } } as unknown as CurrencyPort, new HologramNetwork(() => undefined));
    buyer.setStage2C({ durability: disk, settlements: settlementService(env.memory).service });
    expect(await buyer.recoverSales(async () => false)).toBe(1);
    expect(disk.total('ada', 'diamond')).toBe(2);
    expect(stacks(disk.inventories.get('ada')!, 'diamond')[0]).toMatchObject({ count: 2, metadata: { origin: 'sale' } });
    expect(disk.reload().total('ada', 'diamond')).toBe(2);
    expect(await buyer.recoverSales(async () => false)).toBe(0);
    expect(disk.total('ada', 'diamond')).toBe(2);
  });

  it('does not mint the stack again after a committed credit', async () => {
    let credits = 0;
    const env = buyerEnv(async () => {
      credits += 1;
      return { ok: true, amount: 20 };
    });
    env.buyer.haltAfter = 'sale-paid';
    await selectAndSell(env);
    expect(credits).toBe(1);
    expect(env.disk.total('ada', 'diamond')).toBe(0);
    const disk = env.disk.reload();
    const buyer = new BuyerService(env.store, { backend: 'postgres', deposit: async () => { credits += 1; return { ok: true }; } } as unknown as CurrencyPort, new HologramNetwork(() => undefined));
    buyer.setStage2C({ durability: disk, settlements: settlementService(env.memory).service });
    expect(await buyer.recoverSales(async () => true)).toBe(1);
    expect(phaseOf(env.memory, 'BUYER_SALE')).toBe('COMPLETE');
    expect(disk.total('ada', 'diamond')).toBe(0);
    expect(await buyer.recoverSales(async () => true)).toBe(0);
    expect(disk.total('ada', 'diamond')).toBe(0);
    expect(credits).toBe(1);
  });

  it('keeps the sale unresolved when the restored stack does not fit', async () => {
    const env = buyerEnv(async () => {
      fill(env.inventory);
      return { ok: false, error: 'Превышен максимальный баланс.' };
    });
    const sold = await selectAndSell(env);
    expect(sold.ok).toBe(false);
    expect(env.disk.total('ada', 'diamond')).toBe(0);
    expect(env.buyer.unsavedTradeSlot('ada')).toBeNull();
    expect(phaseOf(env.memory, 'BUYER_SALE')).toBe('PREPARED');
    env.disk.persist('ada');
    const disk = env.disk.reload();
    const buyer = new BuyerService(env.store, { backend: 'postgres', deposit: async () => ({ ok: false, error: 'no' }) } as unknown as CurrencyPort, new HologramNetwork(() => undefined));
    buyer.setStage2C({ durability: disk, settlements: settlementService(env.memory).service });
    expect(await buyer.recoverSales(async () => false)).toBe(0);
    expect(disk.total('ada', 'diamond')).toBe(0);
    disk.inventories.get('ada')!.setSlot(0, null);
    expect(await buyer.recoverSales(async () => false)).toBe(1);
    expect(disk.total('ada', 'diamond')).toBe(2);
    expect(stacks(disk.inventories.get('ada')!, 'diamond')[0]?.metadata).toEqual({ origin: 'sale' });
    expect(phaseOf(env.memory, 'BUYER_SALE')).toBe('CANCELLED');
  });
});

describe('stage 2C clan id reservation', () => {
  it('reserves two ids before either debit finishes and keeps them after reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-s2c-clan-'));
    const { service, memory } = settlementService();
    let waiting = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let debits = 0;
    const economy = {
      backend: 'postgres' as const,
      withdraw: () => {
        debits += 1;
        waiting += 1;
        return gate.then(() => ({ ok: true }));
      },
      getBalance: () => 100_000,
    } as unknown as CurrencyPort;
    const clans = new ClanService(new JsonFileStore(dir), economy);
    clans.setStage2C(service);
    const first = clans.createClan('ada', 'North', 'crown', moneyRequest('ada', 'economy.clan_create', { name: 'North', icon: 'crown' }));
    const second = clans.createClan('bob', 'South', 'crown', moneyRequest('bob', 'economy.clan_create', { name: 'South', icon: 'crown' }));
    await until(() => waiting === 2);
    expect(waiting).toBe(2);
    release();
    const created = await Promise.all([first, second]);
    expect(created.every((row) => row.ok)).toBe(true);
    const ids = [...clans['clans'].values()].map((clan) => clan.clanId);
    expect(ids).toEqual(['clan-1', 'clan-2']);
    expect(debits).toBe(2);
    expect([...memory.rows.values()].every((row) => row.phase === 'COMPLETE')).toBe(true);
    const reloaded = new ClanService(new JsonFileStore(dir), economy);
    expect([...reloaded['clans'].values()].map((clan) => [clan.clanId, clan.ownerId])).toEqual([['clan-1', 'ada'], ['clan-2', 'bob']]);
    reloaded.setStage2C(settlementService().service);
    const third = await reloaded.createClan('cara', 'East', 'crown', moneyRequest('cara', 'economy.clan_create', { name: 'East', icon: 'crown' }));
    expect(third.ok).toBe(true);
    expect(third.ok && third.clan?.clanId).toBe('clan-3');
    expect(debits).toBe(3);
  });

  it('reuses the reserved id after a fee when the clan file was not written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-s2c-clan-'));
    const store = new JsonFileStore(dir);
    const { service, memory } = settlementService();
    let debits = 0;
    const economy = {
      backend: 'postgres' as const,
      withdraw: async () => {
        debits += 1;
        return { ok: true };
      },
      getBalance: () => 100_000,
    } as unknown as CurrencyPort;
    const clans = new ClanService(store, economy);
    clans.setStage2C(service);
    clans.haltAfter = 'clan-paid';
    const created = await clans.createClan('ada', 'North', 'crown', moneyRequest('ada', 'economy.clan_create', { name: 'North', icon: 'crown' }));
    expect(created.ok).toBe(false);
    expect(clans['clans'].size).toBe(0);
    expect(phaseOf(memory, 'CLAN_CREATE')).toBe('MONEY_COMMITTED');
    const reserved = String([...memory.rows.values()][0]?.payload.clanId);
    let extraDebits = 0;
    const reloaded = new ClanService(store, {
      backend: 'postgres',
      withdraw: async () => {
        extraDebits += 1;
        return { ok: true };
      },
      getBalance: () => 100_000,
    } as unknown as CurrencyPort);
    reloaded.setStage2C(service);
    expect(await reloaded.recoverCreates(async () => true)).toBe(1);
    expect(reloaded['clans'].get(reserved)?.ownerId).toBe('ada');
    expect(reloaded['clans'].size).toBe(1);
    expect(phaseOf(memory, 'CLAN_CREATE')).toBe('COMPLETE');
    expect(await reloaded.recoverCreates(async () => true)).toBe(0);
    expect(reloaded['clans'].size).toBe(1);
    expect(debits).toBe(1);
    expect(extraDebits).toBe(0);
    reloaded.setStage2C(settlementService().service);
    const next = await reloaded.createClan('bob', 'South', 'crown', moneyRequest('bob', 'economy.clan_create', { name: 'South', icon: 'crown' }));
    expect(next.ok && next.clan?.clanId).toBe('clan-2');
    expect(extraDebits).toBe(1);
  });

  it('does not overwrite an existing clan when the reserved id collides', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-s2c-clan-'));
    const clans = new ClanService(new JsonFileStore(dir), {
      backend: 'legacy_json',
      withdraw: () => ({ ok: true }),
      getBalance: () => 100_000,
    } as unknown as CurrencyPort);
    const first = clans.createClan('ada', 'North', 'crown');
    expect(first.ok && first.clan?.clanId).toBe('clan-1');
    const { service, memory } = settlementService();
    const settlementId = randomUUID();
    await service.begin({
      settlementId,
      kind: 'CLAN_CREATE',
      requestId: randomUUID(),
      payload: { playerId: 'bob', name: 'South', nameKey: 'south', icon: 'crown', clanId: 'clan-1' },
    });
    await service.advance(settlementId, 'PREPARED', 'MONEY_COMMITTED');
    clans.setStage2C(service);
    expect(await clans.recoverCreates(async () => true)).toBe(1);
    expect(phaseOf(memory, 'CLAN_CREATE')).toBe('RECOVERY_REQUIRED');
    expect(clans['clans'].size).toBe(1);
    expect(clans['clans'].get('clan-1')?.ownerId).toBe('ada');
    expect(await clans.recoverCreates(async () => true)).toBe(1);
    expect(clans['clans'].get('clan-1')?.ownerId).toBe('ada');
  });
});

describe('stage 2C auction delivery', () => {
  function auctionEnv() {
    const dir = mkdtempSync(join(tmpdir(), 'fc-s2c-ah-'));
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    economy.rememberName('ada', 'Ada');
    const auction = new AuctionService(store, economy, () => 1_000);
    const seller = new Inventory();
    seller.setSlot(0, createItemStack('diamond', 2));
    const listed = syncAuction(auction.createListing('ada', 'Ada', seller, 0, 2, 10));
    expect(listed.ok).toBe(true);
    const { service, memory } = settlementService();
    return { store, service, memory, listingId: listed.ok ? listed.listing!.listingId : '' };
  }

  function durable(env: ReturnType<typeof auctionEnv>, disk: Disk, settle: CurrencyPort['settle']) {
    let calls = 0;
    const port = {
      backend: 'postgres' as const,
      settle: async (...args: Parameters<NonNullable<CurrencyPort['settle']>>) => {
        calls += 1;
        return settle(...args);
      },
      rememberName: () => undefined,
    } as unknown as CurrencyPort;
    const auction = new AuctionService(env.store, port, () => 1_000);
    auction.setStage2C({ durability: disk, settlements: env.service });
    return { auction, calls: () => calls };
  }

  it('inserts nothing and stays recoverable when the stack does not fit', async () => {
    const env = auctionEnv();
    const buyer = new Inventory();
    const disk = new Disk({ bea: buyer });
    const { auction, calls } = durable(env, disk, async () => {
      fill(buyer);
      buyer.setSlot(Inventory.SLOT_COUNT - 1, createItemStack('diamond', 63));
      return { ok: true };
    });
    const bought = await auction.buyListing('bea', 'Bea', buyer, env.listingId, moneyRequest('bea', 'economy.auction_purchase', { listingId: env.listingId }));
    expect(bought.ok).toBe(false);
    expect(disk.total('bea', 'diamond')).toBe(63);
    expect(phaseOf(env.memory, 'AUCTION_PURCHASE')).not.toBe('COMPLETE');
    disk.persist('bea');
    const reloadedDisk = disk.reload();
    const reloaded = new AuctionService(env.store, { backend: 'postgres', settle: async () => { throw new Error('second charge'); }, rememberName: () => undefined } as unknown as CurrencyPort, () => 1_000);
    reloaded.setStage2C({ durability: reloadedDisk, settlements: settlementService(env.memory).service });
    expect(await reloaded.recoverPurchases(async () => 'bea')).toBe(0);
    expect(reloadedDisk.total('bea', 'diamond')).toBe(63);
    reloadedDisk.inventories.get('bea')!.setSlot(0, null);
    expect(await reloaded.recoverPurchases(async () => 'bea')).toBe(1);
    expect(reloadedDisk.total('bea', 'diamond')).toBe(65);
    expect(phaseOf(env.memory, 'AUCTION_PURCHASE')).toBe('COMPLETE');
    expect(calls()).toBe(1);
    expect(await reloaded.recoverPurchases(async () => 'bea')).toBe(1);
    expect(reloadedDisk.total('bea', 'diamond')).toBe(65);
  });

  it('delivers an offline buyer from the stored inventory and blocks a second buyer', async () => {
    const env = auctionEnv();
    const buyer = new Inventory();
    const disk = new Disk({ bea: buyer });
    let release: () => void = () => {};
    let entered = false;
    const { auction, calls } = durable(env, disk, () => new Promise((resolve) => {
      entered = true;
      release = () => resolve({ ok: true });
    }));
    const pending = auction.buyListing('bea', 'Bea', buyer, env.listingId, moneyRequest('bea', 'economy.auction_purchase', { listingId: env.listingId }));
    await until(() => entered);
    const rival = auction.buyListing('cara', 'Cara', new Inventory(), env.listingId, moneyRequest('cara', 'economy.auction_purchase', { listingId: env.listingId }));
    expect(rival.ok).toBe(false);
    expect(calls()).toBe(1);
    release();
    expect((await pending).ok).toBe(true);
    expect(disk.total('bea', 'diamond')).toBe(2);
    const again = await auction.buyListing('cara', 'Cara', new Inventory(), env.listingId, moneyRequest('cara', 'economy.auction_purchase', { listingId: env.listingId }));
    expect(again.ok).toBe(false);
    expect(calls()).toBe(1);
    const restarted = new AuctionService(env.store, { backend: 'postgres', settle: async () => { throw new Error('second charge'); } } as unknown as CurrencyPort, () => 1_000);
    const reloaded = disk.reload();
    restarted.setStage2C({ durability: reloaded, settlements: settlementService(env.memory).service });
    expect(await restarted.recoverPurchases(async () => 'bea')).toBe(1);
    expect(reloaded.total('bea', 'diamond')).toBe(2);
  });

  it('binds the listing before the journal and delivers that buyer after restart', async () => {
    const env = auctionEnv();
    const buyer = new Inventory();
    const disk = new Disk({ bea: buyer });
    const { auction, calls } = durable(env, disk, async () => ({ ok: true }));
    auction.haltAfter = 'purchase-paid';
    const bought = await auction.buyListing('bea', 'Bea', buyer, env.listingId, moneyRequest('bea', 'economy.auction_purchase', { listingId: env.listingId }));
    expect(bought.ok).toBe(false);
    expect(env.memory.rows.size).toBe(0);
    expect(disk.total('bea', 'diamond')).toBe(0);
    const rival = await auction.buyListing('cara', 'Cara', new Inventory(), env.listingId, moneyRequest('cara', 'economy.auction_purchase', { listingId: env.listingId }));
    expect(rival.ok).toBe(false);
    expect(calls()).toBe(1);
    const restarted = new AuctionService(env.store, { backend: 'postgres', settle: async () => { throw new Error('second charge'); } } as unknown as CurrencyPort, () => 1_000);
    const reloaded = disk.reload();
    restarted.setStage2C({ durability: reloaded, settlements: env.service });
    expect(await restarted.recoverPurchases(async () => 'bea')).toBe(1);
    expect(reloaded.total('bea', 'diamond')).toBe(2);
    expect(phaseOf(env.memory, 'AUCTION_PURCHASE')).toBe('COMPLETE');
    expect(await restarted.recoverPurchases(async () => 'bea')).toBe(1);
    expect(reloaded.total('bea', 'diamond')).toBe(2);
  });

  it('completes after a delivery receipt without inserting the stack twice', async () => {
    const env = auctionEnv();
    const buyer = new Inventory();
    const disk = new Disk({ bea: buyer });
    const { auction } = durable(env, disk, async () => ({ ok: true }));
    auction.haltAfter = 'purchase-delivered';
    const bought = await auction.buyListing('bea', 'Bea', buyer, env.listingId, moneyRequest('bea', 'economy.auction_purchase', { listingId: env.listingId }));
    expect(bought.ok).toBe(false);
    expect(disk.total('bea', 'diamond')).toBe(2);
    expect(phaseOf(env.memory, 'AUCTION_PURCHASE')).toBe('DOMAIN_DURABLE');
    const reloaded = disk.reload();
    const restarted = new AuctionService(env.store, { backend: 'postgres', settle: async () => { throw new Error('second charge'); } } as unknown as CurrencyPort, () => 1_000);
    restarted.setStage2C({ durability: reloaded, settlements: settlementService(env.memory).service });
    expect(await restarted.recoverPurchases(async () => 'bea')).toBe(1);
    expect(phaseOf(env.memory, 'AUCTION_PURCHASE')).toBe('COMPLETE');
    expect(reloaded.total('bea', 'diamond')).toBe(2);
    expect(await restarted.recoverPurchases(async () => 'bea')).toBe(1);
    expect(reloaded.total('bea', 'diamond')).toBe(2);
  });

  it('rejects a partial stack before any receipt is written', async () => {
    const inventory = new Inventory();
    fill(inventory);
    inventory.setSlot(Inventory.SLOT_COUNT - 1, createItemStack('diamond', 63));
    const disk = new Disk({ bea: inventory });
    const before = disk.files.get('bea');
    expect(await disk.deliverAll('bea', 'receipt-1', [createItemStack('diamond', 2)])).toBe('full');
    expect(disk.total('bea', 'diamond')).toBe(63);
    expect(disk.hasReceipt('bea', 'receipt-1')).toBe(false);
    expect(disk.files.get('bea')).toBe(before);
  });
});
