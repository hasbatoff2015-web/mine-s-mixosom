import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, cloneStack, createItemStack } from '../../src/inventory';
import type { ItemStack } from '../../src/inventory/types';
import type { Database, Queryable } from '../../server/db/types';
import { hashPayload } from '../../server/db/canonicalJson';
import type { CurrencyPort, EconomyCommandRequest } from '../../server/economy/currencyPort';
import { syncAuction, AuctionService } from '../../server/services/auction';
import { EconomyService } from '../../server/services/economy';
import { JsonFileStore } from '../../server/services/jsonStore';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';
import type { ItemDurability } from '../../server/settlements/durability';
import { auctionClaimReceipt } from '../../server/settlements/receipts';
import { PostgresSettlementRepository } from '../../server/settlements/repository';
import { SettlementService } from '../../server/settlements/service';
import {
  SettlementConflictError,
  type BeginSettlementInput,
  type SettlementPhase,
  type SettlementRow,
} from '../../server/settlements/types';

const SWORD: ItemStack = {
  itemId: 'iron_sword',
  count: 1,
  durability: 12,
  metadata: { origin: 'trade-window' },
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
    const next = { ...row, phase: to, updatedAt: new Date().toISOString() };
    this.rows.set(settlementId, next);
    return next;
  }

  async listOpen(): Promise<readonly SettlementRow[]> {
    return [...this.rows.values()].filter((row) => row.phase !== 'COMPLETE' && row.phase !== 'CANCELLED');
  }
}

function settlementService(memory = new MemorySettlements()): SettlementService {
  const database = {
    enabled: true,
    deploymentId: 'test',
    appliedMigrations: [],
    start: async () => undefined,
    close: async () => undefined,
    query: async () => ({ rows: [], rowCount: 0 }),
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
  } as Database;
  return new SettlementService(database, memory as unknown as PostgresSettlementRepository);
}

function request(actorId: string): EconomyCommandRequest {
  return {
    requestId: randomUUID(),
    operation: 'economy.auction_purchase',
    actorId,
    payload: { action: 'buy' },
  };
}

function fill(inventory: Inventory, itemId = 'cobblestone'): void {
  for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
    inventory.setSlot(slot, createItemStack(itemId, 64));
  }
}

function heldCount(stacks: readonly ItemStack[] | undefined, itemId: string): number {
  return (stacks ?? []).filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.count, 0);
}

describe('auction purchase identity', () => {
  it('rejects a second buyer on an unpaid PREPARED row, then lets the original buyer finish once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-gap-a-'));
    const store = new JsonFileStore(dir);
    const listedEconomy = new EconomyService(store);
    const auction = new AuctionService(store, listedEconomy, () => 1_000);
    const seller = new Inventory();
    seller.setSlot(0, createItemStack('diamond', 2));
    const listed = syncAuction(auction.createListing('ada', 'Ada', seller, 0, 2, 10));
    expect(listed.ok).toBe(true);
    const listingId = listed.listing!.listingId;
    const memory = new MemorySettlements();
    const charges: Array<{ buyerId: string; sourceId: string }> = [];
    const port = {
      backend: 'postgres',
      settle: async (buyerId: string, _seller: string, _price: number, _debit: string, _credit: string, _pair?: string, _request?: EconomyCommandRequest, sourceId?: string) => {
        const id = sourceId ?? '';
        const prior = charges.find((row) => row.sourceId === id);
        if (prior) {
          return prior.buyerId === buyerId
            ? { ok: true, replayed: true }
            : { ok: false, error: 'conflict' };
        }
        charges.push({ buyerId, sourceId: id });
        return { ok: true, replayed: false };
      },
      rememberName: () => undefined,
    } as unknown as CurrencyPort;
    const durable = new AuctionService(store, port, () => 1_000);
    const disk = new Map<string, Inventory>();
    const bea = new Inventory();
    const cara = new Inventory();
    disk.set('bea', bea);
    disk.set('cara', cara);
    const durability: ItemDurability = {
      hasReceipt: () => false,
      escrow: async () => undefined,
      deliver: async (playerId, _receipt, stack) => {
        const inventory = disk.get(playerId);
        if (!inventory) return 'missing';
        if (inventory.add(cloneStack(stack)!) !== null) return 'full';
        return 'delivered';
      },
      deliverAll: async () => 'delivered',
      restore: async () => 'restored',
      restoreAll: async () => 'restored',
      dropReceipt: async () => undefined,
    };
    durable.setStage2C({ durability, settlements: settlementService(memory) });
    durable.haltAfter = 'purchase-prepared';
    const prepared = await durable.buyListing('bea', 'Bea', bea, listingId, request('bea'));
    expect(prepared.ok).toBe(false);
    expect(charges).toEqual([]);
    const owner = [...memory.rows.values()][0]!;
    expect(owner.phase).toBe('PREPARED');
    expect(owner.payload.buyerId).toBe('bea');
    const settlementId = owner.settlementId;

    const rival = await durable.buyListing('cara', 'Cara', cara, listingId, request('cara'));
    expect(rival.ok).toBe(false);
    expect(charges).toEqual([]);
    expect(memory.rows.get(settlementId)?.payload.buyerId).toBe('bea');
    expect(memory.rows.get(settlementId)?.phase).toBe('PREPARED');
    expect(cara.count('diamond')).toBe(0);

    durable.haltAfter = undefined;
    const finished = await durable.buyListing('bea', 'Bea', bea, listingId, request('bea'));
    expect(finished.ok).toBe(true);
    expect(charges).toEqual([{ buyerId: 'bea', sourceId: settlementId }]);
    expect(bea.count('diamond')).toBe(2);
    expect(memory.rows.get(settlementId)?.phase).toBe('COMPLETE');

    const again = await durable.buyListing('bea', 'Bea', bea, listingId, request('bea'));
    expect(again.ok).toBe(false);
    expect(charges).toHaveLength(1);
    expect(bea.count('diamond')).toBe(2);

    const rebound = await durable.buyListing('cara', 'Cara', cara, listingId, request('cara'));
    expect(rebound.ok).toBe(false);
    expect(charges).toHaveLength(1);
    expect(cara.count('diamond')).toBe(0);
    expect(memory.rows.get(settlementId)?.payload.buyerId).toBe('bea');
    await rm(dir, { recursive: true, force: true });
  });

  it('cancels an abandoned unpaid attempt on recovery and sells once under a new id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-gap-a2-'));
    const store = new JsonFileStore(dir);
    const auction = new AuctionService(store, new EconomyService(store), () => 1_000);
    const seller = new Inventory();
    seller.setSlot(0, createItemStack('diamond', 2));
    const listed = syncAuction(auction.createListing('ada', 'Ada', seller, 0, 2, 10));
    const listingId = listed.listing!.listingId;
    const memory = new MemorySettlements();
    const charges: string[] = [];
    const port = {
      backend: 'postgres',
      settle: async (buyerId: string, _s: string, _p: number, _d: string, _c: string, _pair?: string, _request?: EconomyCommandRequest, sourceId?: string) => {
        charges.push(`${buyerId}:${sourceId}`);
        return { ok: true, replayed: false };
      },
      rememberName: () => undefined,
    } as unknown as CurrencyPort;
    const durable = new AuctionService(store, port, () => 1_000);
    const inventories = new Map<string, Inventory>([['bea', new Inventory()]]);
    const durability: ItemDurability = {
      hasReceipt: () => false,
      escrow: async () => undefined,
      deliver: async (playerId, _receipt, stack) => {
        const inventory = inventories.get(playerId);
        if (!inventory) return 'missing';
        if (inventory.add(cloneStack(stack)!) !== null) return 'full';
        return 'delivered';
      },
      deliverAll: async () => 'delivered',
      restore: async () => 'restored',
      restoreAll: async () => 'restored',
      dropReceipt: async () => undefined,
    };
    durable.setStage2C({ durability, settlements: settlementService(memory) });
    durable.haltAfter = 'purchase-prepared';
    await durable.buyListing('bea', 'Bea', inventories.get('bea')!, listingId, request('bea'));
    const abandoned = [...memory.rows.values()][0]!;
    expect(abandoned.phase).toBe('PREPARED');
    const restarted = new AuctionService(store, port, () => 1_000);
    restarted.setStage2C({ durability, settlements: settlementService(memory) });
    expect(await restarted.recoverPurchases(async () => null)).toBe(0);
    expect(memory.rows.get(abandoned.settlementId)?.phase).toBe('CANCELLED');
    expect(restarted.getListing(listingId)?.status).toBe('ACTIVE');
    const cara = new Inventory();
    inventories.set('cara', cara);
    const bought = await restarted.buyListing('cara', 'Cara', cara, listingId, request('cara'));
    expect(bought.ok).toBe(true);
    expect(charges).toEqual([`cara:${restarted.getListing(listingId)?.economySettlementId}`]);
    expect(restarted.getListing(listingId)?.economySettlementId).not.toBe(abandoned.settlementId);
    expect(memory.rows.get(abandoned.settlementId)?.phase).toBe('CANCELLED');
    expect(memory.rows.get(abandoned.settlementId)?.payload.buyerId).toBe('bea');
    expect(cara.count('diamond')).toBe(2);
    expect(inventories.get('bea')!.count('diamond')).toBe(0);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('unsaved window stacks survive a full inventory save', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(): Promise<{ world: WorldInstance; dataDir: string; worldId: string }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-gap-b-'));
    dirs.push(dataDir);
    const worldId = 'held-world';
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: worldId,
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1',
        FC_ADMIN_IDS: '',
      }),
      dataDir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: join(dataDir, 'plugins'),
    });
    worlds.push(world);
    await world.initialize();
    return { world, dataDir, worldId };
  }

  function addPlayer(world: WorldInstance, name: string, sessionToken?: string): ServerPlayer {
    const joined = world.join({ sink: { send() {} }, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in joined) throw new Error(joined.error);
    return joined.player;
  }

  async function playersFile(dataDir: string, worldId: string) {
    const raw = JSON.parse(await readFile(join(dataDir, worldId, 'players.json'), 'utf8')) as {
      players: Record<string, { inventory: unknown; heldReturns?: ItemStack[]; settlementReceipts?: string[] }>;
    };
    return raw.players;
  }

  function savedCount(row: { inventory: unknown; heldReturns?: ItemStack[] }, itemId: string): number {
    return Inventory.deserialize(row.inventory).count(itemId) + heldCount(row.heldReturns, itemId);
  }

  it('keeps trade offers, a partial stack, and a buyer slot when the inventory cannot absorb them', async () => {
    const { world, dataDir, worldId } = await start();
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    ada.inventory.clear();
    ada.inventory.setSlot(0, cloneStack(SWORD)!);
    ada.inventory.setSlot(1, { itemId: 'diamond', count: 2, metadata: { origin: 'offer' } });
    ada.inventory.setSlot(2, createItemStack('gold_ingot', 3));
    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 1, 1).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 2, 2).ok).toBe(true);
    fill(ada.inventory);
    ada.inventory.setSlot(0, createItemStack('diamond', 63));
    await world.save();
    const saved = (await playersFile(dataDir, worldId))[ada.id]!;
    expect(saved.heldReturns).toEqual([
      expect.objectContaining({ itemId: 'iron_sword', count: 1, durability: 12, metadata: { origin: 'trade-window' } }),
      expect.objectContaining({ itemId: 'diamond', count: 2, metadata: { origin: 'offer' } }),
      expect.objectContaining({ itemId: 'gold_ingot', count: 3 }),
    ]);
    expect(Inventory.deserialize(saved.inventory).count('diamond')).toBe(63);
    expect(Inventory.deserialize(saved.inventory).count('iron_sword')).toBe(0);
    expect(savedCount(saved, 'diamond')).toBe(65);
    expect(savedCount(saved, 'iron_sword')).toBe(1);
    expect(savedCount(saved, 'gold_ingot')).toBe(3);

    const token = ada.sessionToken;
    await world.stop();
    worlds.pop();
    const reloaded = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: worldId,
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1',
        FC_ADMIN_IDS: '',
      }),
      dataDir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: join(dataDir, 'plugins'),
    });
    worlds.push(reloaded);
    await reloaded.initialize();
    const again = addPlayer(reloaded, 'Ada', token);
    expect(again.inventory.count('diamond')).toBe(63);
    expect(heldCount(again.heldReturns, 'diamond')).toBe(2);
    expect(heldCount(again.heldReturns, 'gold_ingot')).toBe(3);
    expect(heldCount(again.heldReturns, 'iron_sword')).toBe(1);
    expect(again.heldReturns.find((stack) => stack.itemId === 'iron_sword')).toMatchObject(SWORD);
    again.inventory.setSlot(1, null);
    again.inventory.setSlot(2, null);
    again.inventory.setSlot(3, null);
    await reloaded.save();
    expect(again.inventory.count('iron_sword')).toBe(1);
    expect(again.inventory.count('diamond')).toBe(65);
    expect(again.inventory.count('gold_ingot')).toBe(3);
    expect(again.heldReturns).toEqual([]);
    expect(again.inventory.slots.find((stack) => stack?.itemId === 'iron_sword')).toMatchObject(SWORD);
    await reloaded.save();
    const second = (await playersFile(dataDir, worldId))[ada.id]!;
    expect(second.heldReturns ?? []).toEqual([]);
    expect(savedCount(second, 'diamond')).toBe(65);
    expect(savedCount(second, 'iron_sword')).toBe(1);
    expect(savedCount(second, 'gold_ingot')).toBe(3);
  });

  it('keeps a buyer trade slot that does not fit, and omits held returns when the offer fits', async () => {
    const { world, dataDir, worldId } = await start();
    const ada = addPlayer(world, 'Ada');
    ada.inventory.clear();
    ada.inventory.setSlot(0, { itemId: 'diamond', count: 4, metadata: { origin: 'buyer' } });
    const created = world.buyer.create({
      name: 'Фермер',
      worldId,
      x: 0,
      y: 64,
      z: 0,
      yaw: 0,
      pitch: 0,
    });
    expect(created.ok).toBe(true);
    const buyerId = created.buyer!.id;
    world.buyer.configure(buyerId, { itemId: 'diamond', pricePerItem: 10 });
    expect(world.buyer.openTrade(ada.id, buyerId, ada.inventory).ok).toBe(true);
    const selected = await world.buyer.handleAction(
      ada.id,
      ada.inventory,
      { type: 'buyer_action', action: 'select_slot', slot: 0 },
      { edit: false, delete: false, use: true },
    );
    expect(selected.ok).toBe(true);
    fill(ada.inventory);
    await world.save();
    const saved = (await playersFile(dataDir, worldId))[ada.id]!;
    expect(heldCount(saved.heldReturns, 'diamond')).toBe(4);
    expect(Inventory.deserialize(saved.inventory).count('diamond')).toBe(0);
    expect(saved.heldReturns?.[0]?.metadata).toEqual({ origin: 'buyer' });

    const quiet = addPlayer(world, 'Bea');
    quiet.inventory.clear();
    quiet.inventory.setSlot(0, cloneStack(SWORD)!);
    expect(world.trade.request(quiet.id, 'Ada').ok).toBe(true);
    expect(world.trade.acceptRequest(ada.id, world.trade.incomingRequests(ada.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(quiet.id, 0, 0).ok).toBe(true);
    await world.save();
    const fitted = (await playersFile(dataDir, worldId))[quiet.id]!;
    expect(fitted.heldReturns ?? []).toEqual([]);
    expect(Inventory.deserialize(fitted.inventory).count('iron_sword')).toBe(1);
    expect(Inventory.deserialize(fitted.inventory).slots.find((stack) => stack?.itemId === 'iron_sword')).toMatchObject(SWORD);
  });
});

describe('auction claim and listing save failure', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(): Promise<{ world: WorldInstance; dataDir: string; worldId: string }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-gap-c-'));
    dirs.push(dataDir);
    const worldId = 'claim-world';
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: worldId,
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1',
        FC_ADMIN_IDS: '',
      }),
      dataDir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: join(dataDir, 'plugins'),
    });
    worlds.push(world);
    await world.initialize();
    const durability = (world as unknown as { itemDurability(): ItemDurability }).itemDurability();
    world.auction.setStage2C({ durability });
    return { world, dataDir, worldId };
  }

  function addPlayer(world: WorldInstance, name: string, sessionToken?: string): ServerPlayer {
    const joined = world.join({ sink: { send() {} }, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in joined) throw new Error(joined.error);
    return joined.player;
  }

  function failNextPlayerSave(world: WorldInstance): { restore: () => void; calls: () => number } {
    const store = (world as unknown as { worldStore: { savePlayers: (worldId: string, players: unknown) => Promise<void> } }).worldStore;
    const original = store.savePlayers.bind(store);
    let calls = 0;
    store.savePlayers = async () => {
      calls += 1;
      throw new Error('disk full');
    };
    return {
      calls: () => calls,
      restore: () => {
        store.savePlayers = original;
      },
    };
  }

  it('rolls a failed claim back and delivers the stack once on retry and reload', async () => {
    const { world, dataDir, worldId } = await start();
    const ada = addPlayer(world, 'Ada');
    ada.inventory.clear();
    ada.inventory.setSlot(0, cloneStack(SWORD)!);
    const listed = await world.auction.createListing(ada.id, 'Ada', ada.inventory, 0, 1, 10);
    expect(listed.ok).toBe(true);
    const listingId = listed.listing!.listingId;
    expect(world.auction.cancelListing(ada.id, listingId).ok).toBe(true);
    expect(ada.inventory.count('iron_sword')).toBe(0);
    const failing = failNextPlayerSave(world);
    const claimed = await world.auction.claimListing(ada.id, ada.inventory, listingId);
    expect(claimed.ok).toBe(false);
    expect(failing.calls()).toBe(1);
    expect(ada.inventory.count('iron_sword')).toBe(0);
    expect(ada.settlementReceipts.has(auctionClaimReceipt(listed.listing!.economySettlementId))).toBe(false);
    expect(world.auction.getListing(listingId)?.status).toBe('CANCELLED');
    failing.restore();
    const delivered = await world.auction.claimListing(ada.id, ada.inventory, listingId);
    expect(delivered.ok).toBe(true);
    expect(ada.inventory.count('iron_sword')).toBe(1);
    expect(ada.inventory.slots.find((stack) => stack?.itemId === 'iron_sword')).toMatchObject(SWORD);
    expect(ada.settlementReceipts.has(auctionClaimReceipt(listed.listing!.economySettlementId))).toBe(true);
    const repeat = await world.auction.claimListing(ada.id, ada.inventory, listingId);
    expect(repeat.ok).toBe(false);
    expect(ada.inventory.count('iron_sword')).toBe(1);
    const token = ada.sessionToken;
    await world.save();
    await world.stop();
    worlds.pop();
    const reloaded = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: worldId,
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1',
        FC_ADMIN_IDS: '',
      }),
      dataDir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: join(dataDir, 'plugins'),
    });
    worlds.push(reloaded);
    await reloaded.initialize();
    const adaAgain = addPlayer(reloaded, 'Ada', token);
    expect(adaAgain.inventory.count('iron_sword')).toBe(1);
    expect(adaAgain.inventory.slots.find((stack) => stack?.itemId === 'iron_sword')).toMatchObject(SWORD);
    expect(reloaded.auction.getListing(listingId)?.status).toBe('CLAIMED');
    expect(adaAgain.settlementReceipts.has(auctionClaimReceipt(listed.listing!.economySettlementId))).toBe(true);
  });

  it('restores the seller stack when listing escrow save or the listing file write fails', async () => {
    const { world } = await start();
    const ada = addPlayer(world, 'Ada');
    ada.inventory.clear();
    ada.inventory.setSlot(0, cloneStack(SWORD)!);
    const failing = failNextPlayerSave(world);
    await expect(world.auction.createListing(ada.id, 'Ada', ada.inventory, 0, 1, 10)).rejects.toThrow('disk full');
    expect(failing.calls()).toBe(1);
    expect(ada.inventory.count('iron_sword')).toBe(1);
    expect(ada.inventory.getSlot(0)).toMatchObject(SWORD);
    expect(ada.settlementReceipts.size).toBe(0);
    expect([...world.auction['listings'].values()].filter((listing) => listing.status === 'ACTIVE' || listing.status === 'PENDING_ESCROW')).toEqual([]);
    failing.restore();
    const created = await world.auction.createListing(ada.id, 'Ada', ada.inventory, 0, 1, 10);
    expect(created.ok).toBe(true);
    expect(created.listing?.status).toBe('ACTIVE');
    expect(ada.inventory.count('iron_sword')).toBe(0);

    const dir = await mkdtemp(join(tmpdir(), 'fc-gap-json-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    let writes = 0;
    store.save = () => {
      writes += 1;
      throw new Error('listing json');
    };
    const auction = new AuctionService(store, new EconomyService(new JsonFileStore(dir)), () => 1_000);
    let escrowed = 0;
    auction.setStage2C({
      durability: {
        hasReceipt: () => false,
        escrow: async () => { escrowed += 1; },
        deliver: async () => 'delivered',
        deliverAll: async () => 'delivered',
        restore: async () => 'restored',
        restoreAll: async () => 'restored',
        dropReceipt: async () => undefined,
      },
    });
    const seller = new Inventory();
    seller.setSlot(0, cloneStack(SWORD)!);
    await expect(Promise.resolve().then(() => auction.createListing('ada', 'Ada', seller, 0, 1, 10))).rejects.toThrow('listing json');
    expect(writes).toBeGreaterThan(0);
    expect(escrowed).toBe(0);
    expect(seller.getSlot(0)).toMatchObject(SWORD);
    expect(auction.queryBrowse().totalCount).toBe(0);
  });
});
