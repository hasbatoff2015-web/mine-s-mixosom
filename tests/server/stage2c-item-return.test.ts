import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, cloneStack, createItemStack } from '../../src/inventory';
import type { ItemStack } from '../../src/inventory/types';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';
import type { ItemDurability } from '../../server/settlements/durability';
import { auctionListingReceipt } from '../../server/settlements/receipts';
import { AuctionService } from '../../server/services/auction';
import { EconomyService } from '../../server/services/economy';
import { JsonFileStore } from '../../server/services/jsonStore';

const SWORD: ItemStack = {
  itemId: 'iron_sword',
  count: 1,
  durability: 12,
  metadata: { origin: 'listed' },
};
const OTHER_SWORD: ItemStack = {
  itemId: 'iron_sword',
  count: 1,
  durability: 12,
  metadata: { origin: 'other' },
};
const SWEEP_MS = 5 * 60_000;

function fill(inventory: Inventory, itemId = 'cobblestone'): void {
  for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
    inventory.setSlot(slot, createItemStack(itemId, 64));
  }
}

function owned(player: ServerPlayer, itemId: string): number {
  return player.inventory.count(itemId) + player.heldReturns.filter((stack) => stack.itemId === itemId)
    .reduce((sum, stack) => sum + stack.count, 0);
}

describe('item return ownership', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(worldId: string): Promise<{ world: WorldInstance; dataDir: string }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-return-'));
    dirs.push(dataDir);
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
    return { world, dataDir };
  }

  function addPlayer(world: WorldInstance, name: string, sessionToken?: string): ServerPlayer {
    const joined = world.join({ sink: { send() {} }, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in joined) throw new Error(joined.error);
    return joined.player;
  }

  async function boot(dataDir: string, worldId: string): Promise<WorldInstance> {
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
    return world;
  }

  async function savedPlayer(dataDir: string, worldId: string, playerId: string) {
    const raw = JSON.parse(await readFile(join(dataDir, worldId, 'players.json'), 'utf8')) as {
      players: Record<string, { inventory: unknown; heldReturns?: ItemStack[]; sessionToken?: string }>;
    };
    return raw.players[playerId];
  }

  function sweep(world: WorldInstance, player: ServerPlayer): void {
    player.disconnectedAt = Date.now() - SWEEP_MS - 1;
    world.tick();
  }

  it('keeps heldReturns across disconnect, the disconnected-player sweep, and restart', async () => {
    const worldId = 'return-world';
    const { world, dataDir } = await start(worldId);
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    ada.inventory.clear();
    fill(ada.inventory);
    ada.heldReturns = [cloneStack(SWORD)!];
    bob.inventory.clear();
    bob.heldReturns = [];
    await world.save();
    const token = ada.sessionToken;

    world.disconnect(ada.id);
    const resumed = addPlayer(world, 'Ada', token);
    expect(resumed.id).toBe(ada.id);
    expect(owned(resumed, 'iron_sword')).toBe(1);
    expect(resumed.heldReturns).toEqual([expect.objectContaining(SWORD)]);
    world.disconnect(resumed.id);
    sweep(world, resumed);
    expect(world.players.has(ada.id)).toBe(false);
    await world.save();
    const swept = await savedPlayer(dataDir, worldId, ada.id);
    expect(swept?.heldReturns).toEqual([expect.objectContaining(SWORD)]);
    expect(Inventory.deserialize(swept!.inventory).count('iron_sword')).toBe(0);
    const quiet = await savedPlayer(dataDir, worldId, bob.id);
    expect(quiet?.heldReturns ?? []).toEqual([]);

    await world.stop();
    worlds.pop();
    const reloaded = await boot(dataDir, worldId);
    const again = addPlayer(reloaded, 'Ada', token);
    expect(again.id).toBe(ada.id);
    expect(owned(again, 'iron_sword')).toBe(1);
    expect(again.heldReturns).toEqual([expect.objectContaining(SWORD)]);
    again.inventory.setSlot(0, null);
    await reloaded.save();
    expect(again.inventory.count('iron_sword')).toBe(1);
    expect(again.heldReturns).toEqual([]);
    expect(again.inventory.slots.find((stack) => stack?.itemId === 'iron_sword')).toMatchObject(SWORD);
    worldStop: {
      reloaded.disconnect(again.id);
      sweep(reloaded, again);
      await reloaded.save();
    }
    await reloaded.stop();
    worlds.pop();
    const third = await boot(dataDir, worldId);
    const finalAda = addPlayer(third, 'Ada', token);
    expect(owned(finalAda, 'iron_sword')).toBe(1);
    expect(finalAda.heldReturns).toEqual([]);
    expect(finalAda.inventory.slots.filter((stack) => stack?.itemId === 'iron_sword')).toHaveLength(1);
  });

  it('parks a full trade offer in heldReturns on cancel and on disconnect', async () => {
    const worldId = 'trade-return';
    const { world, dataDir } = await start(worldId);
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    ada.inventory.clear();
    ada.inventory.setSlot(0, createItemStack('diamond', 64));
    ada.inventory.setSlot(1, createItemStack('gold_ingot', 7));
    ada.inventory.setSlot(2, cloneStack(SWORD)!);
    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 1, 1).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 2, 2).ok).toBe(true);
    fill(ada.inventory);
    ada.inventory.setSlot(0, createItemStack('diamond', 63));
    const before = 63 + 64;
    expect(world.trade.cancel(ada.id).ok).toBe(true);
    expect(world.trade.sessionFor(ada.id)).toBeUndefined();
    expect(ada.inventory.count('diamond')).toBe(63);
    expect(ada.heldReturns.filter((stack) => stack.itemId === 'diamond').reduce((sum, stack) => sum + stack.count, 0)).toBe(64);
    expect(ada.heldReturns.find((stack) => stack.itemId === 'gold_ingot')?.count).toBe(7);
    expect(ada.heldReturns.find((stack) => stack.itemId === 'iron_sword')).toMatchObject(SWORD);
    expect(owned(ada, 'diamond')).toBe(before);
    expect(world.trade.cancel(ada.id).ok).toBe(true);
    expect(owned(ada, 'diamond')).toBe(before);
    const token = ada.sessionToken;
    await world.save();
    await world.stop();
    worlds.pop();
    const reloaded = await boot(dataDir, worldId);
    const again = addPlayer(reloaded, 'Ada', token);
    expect(owned(again, 'diamond')).toBe(before);
    expect(owned(again, 'gold_ingot')).toBe(7);
    expect(owned(again, 'iron_sword')).toBe(1);
    again.inventory.setSlot(1, null);
    again.inventory.setSlot(2, null);
    again.inventory.setSlot(3, null);
    await reloaded.save();
    expect(again.heldReturns).toEqual([]);
    expect(again.inventory.count('diamond')).toBe(before);
    expect(again.inventory.slots.find((stack) => stack?.itemId === 'iron_sword')).toMatchObject(SWORD);
    await reloaded.save();
    expect(again.inventory.count('diamond')).toBe(before);
  });

  it('returns a disconnecting trader\'s offer once and does not refund a settling trade', async () => {
    const worldId = 'trade-disc';
    const { world, dataDir } = await start(worldId);
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    ada.inventory.clear();
    ada.inventory.setSlot(0, createItemStack('diamond', 64));
    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    fill(ada.inventory);
    const token = ada.sessionToken;
    world.disconnect(ada.id);
    expect(world.trade.sessionFor(ada.id)).toBeUndefined();
    expect(ada.inventory.count('diamond')).toBe(0);
    expect(ada.heldReturns.reduce((sum, stack) => sum + (stack.itemId === 'diamond' ? stack.count : 0), 0)).toBe(64);
    world.disconnect(ada.id);
    expect(owned(ada, 'diamond')).toBe(64);
    sweep(world, ada);
    await world.save();
    await world.stop();
    worlds.pop();
    const reloaded = await boot(dataDir, worldId);
    const again = addPlayer(reloaded, 'Ada', token);
    expect(owned(again, 'diamond')).toBe(64);

    const cara = addPlayer(reloaded, 'Cara');
    const dee = addPlayer(reloaded, 'Dee');
    cara.inventory.clear();
    cara.inventory.setSlot(0, createItemStack('diamond', 64));
    expect(reloaded.trade.request(cara.id, 'Dee').ok).toBe(true);
    expect(reloaded.trade.acceptRequest(dee.id, reloaded.trade.incomingRequests(dee.id)[0]!.requestId).ok).toBe(true);
    expect(reloaded.trade.putItem(cara.id, 0, 0).ok).toBe(true);
    fill(cara.inventory);
    const session = reloaded.trade.sessionFor(cara.id)!;
    session.settling = true;
    expect(reloaded.trade.cancel(cara.id).ok).toBe(false);
    expect(reloaded.trade.disconnect(cara.id).ok).toBe(false);
    expect(session.offers[cara.id]?.slots[0]?.count).toBe(64);
    expect(cara.heldReturns.filter((stack) => stack.itemId === 'diamond')).toEqual([]);
    expect(cara.inventory.count('diamond')).toBe(0);
    expect(owned(cara, 'diamond') + (session.offers[cara.id]?.slots[0]?.count ?? 0)).toBe(64);
  });

  it('keeps an auction stack when escrow save fails after the original slot changes', async () => {
    const worldId = 'auction-return';
    const { world, dataDir } = await start(worldId);
    const durability = (world as unknown as { itemDurability(): ItemDurability }).itemDurability();
    world.auction.setStage2C({ durability });
    const ada = addPlayer(world, 'Ada');
    ada.inventory.clear();
    ada.inventory.setSlot(0, cloneStack(SWORD)!);
    await world.save();
    const store = (world as unknown as { worldStore: { savePlayers: (worldId: string, players: unknown) => Promise<void> } }).worldStore;
    const originalSave = store.savePlayers.bind(store);
    let rejectSave: (error: Error) => void = () => {};
    let started = false;
    store.savePlayers = () => new Promise<void>((_resolve, reject) => {
      started = true;
      rejectSave = reject;
    });
    const pending = world.auction.createListing(ada.id, 'Ada', ada.inventory, 0, 1, 10);
    for (let attempt = 0; attempt < 20 && !started; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(started).toBe(true);
    ada.inventory.setSlot(0, cloneStack(OTHER_SWORD)!);
    for (let slot = 1; slot < Inventory.SLOT_COUNT; slot += 1) ada.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    rejectSave(new Error('disk full'));
    await expect(pending).rejects.toThrow('disk full');
    expect(ada.inventory.getSlot(0)).toMatchObject(OTHER_SWORD);
    expect(ada.heldReturns).toEqual([expect.objectContaining(SWORD)]);
    expect(ada.settlementReceipts.has(auctionListingReceipt(world.auction.getListing('ah-1')?.economySettlementId ?? 'missing'))).toBe(false);
    expect(world.auction.queryBrowse().totalCount).toBe(0);
    expect(ada.inventory.slots.filter((stack) => stack && stack.metadata && (stack.metadata as { origin?: string }).origin === 'listed')).toEqual([]);
    store.savePlayers = originalSave;
    const token = ada.sessionToken;
    await world.save();
    await world.stop();
    worlds.pop();
    const reloaded = await boot(dataDir, worldId);
    const again = addPlayer(reloaded, 'Ada', token);
    expect(owned(again, 'iron_sword')).toBe(2);
    expect(again.inventory.getSlot(0)).toMatchObject(OTHER_SWORD);
    expect(again.heldReturns).toEqual([expect.objectContaining(SWORD)]);
    again.inventory.setSlot(1, null);
    await reloaded.save();
    expect(again.heldReturns).toEqual([]);
    expect(again.inventory.count('iron_sword')).toBe(2);
    const origins = again.inventory.slots.filter((stack) => stack?.itemId === 'iron_sword').map((stack) => stack?.metadata);
    expect(origins).toEqual(expect.arrayContaining([SWORD.metadata, OTHER_SWORD.metadata]));
    await reloaded.save();
    await reloaded.stop();
    worlds.pop();
    const third = await boot(dataDir, worldId);
    const finalAda = addPlayer(third, 'Ada', token);
    expect(owned(finalAda, 'iron_sword')).toBe(2);
    expect(finalAda.heldReturns).toEqual([]);

    const seller = addPlayer(third, 'Bea');
    seller.inventory.clear();
    seller.inventory.setSlot(0, cloneStack(SWORD)!);
    const durabilityAgain = (third as unknown as { itemDurability(): ItemDurability }).itemDurability();
    third.auction.setStage2C({ durability: durabilityAgain });
    const listed = await third.auction.createListing(seller.id, 'Bea', seller.inventory, 0, 1, 10);
    expect(listed.ok).toBe(true);
    expect(listed.listing?.status).toBe('ACTIVE');
    expect(seller.inventory.count('iron_sword')).toBe(0);
    expect(third.auction.queryBrowse().totalCount).toBe(1);
  });

  it('restores the original stack when the listing file write fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-return-json-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    store.save = () => { throw new Error('listing json'); };
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
    expect(escrowed).toBe(0);
    expect(seller.getSlot(0)).toMatchObject(SWORD);
    expect(auction.queryBrowse().totalCount).toBe(0);
  });
});
