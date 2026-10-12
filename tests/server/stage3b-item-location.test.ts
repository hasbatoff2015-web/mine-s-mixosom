import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { Inventory, createItemStack, withItemInstanceId, readItemInstanceId } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { Vec3 } from '../../src/math/vec3';
import { loadServerConfig } from '../../server/config';
import { IDENTITY_TRANSFER_BLOCKED, scanIdentity, type IdentityScanInput } from '../../server/identity/locationScan';
import { AUCTION_MIN_PRICE } from '../../server/services/auction';
import { EconomyService } from '../../server/services/economy';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';

const PAINT = ItemId.Painting01VillagerHmm;
const OTHER = ItemId.Painting02NightGuardian;
const X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SWEEP_MS = 5 * 60_000;

function tracked(itemId: string, instanceId: string) {
  return withItemInstanceId(createItemStack(itemId, 1), instanceId);
}

function emptyScan(extra: Partial<IdentityScanInput> = {}): IdentityScanInput {
  return {
    worldId: 'anarchy',
    players: [],
    chests: [],
    furnaces: [],
    drops: [],
    paintings: [],
    auctions: [],
    trades: [],
    buyerWindows: [],
    buyerReturns: [],
    ...extra,
  };
}

describe('stage 3B unique item locations', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(worldId: string): Promise<WorldInstance> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-3b-'));
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
    return world;
  }

  async function reopen(dataDir: string, worldId: string): Promise<WorldInstance> {
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

  function addPlayer(world: WorldInstance, name: string, sessionToken?: string, clearInventory = true): ServerPlayer {
    const joined = world.join({ sink: { send() {} }, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in joined) throw new Error(joined.error);
    if (clearInventory) joined.player.inventory.clear();
    return joined.player;
  }

  function money(world: WorldInstance): EconomyService {
    return world.money as EconomyService;
  }

  function of(world: WorldInstance, instanceId: string) {
    const report = world.inspectUniqueItems();
    return {
      report,
      locations: report.locations.filter((location) => location.itemInstanceId === instanceId),
      finding: report.findings.find((finding) => finding.itemInstanceId === instanceId),
    };
  }

  it('confirms two players, two slots, a chest, a drop, and two paintings', async () => {
    const world = await start('dupes');
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    const beforeAda = money(world).getBalance(ada.id);
    const beforeBob = money(world).getBalance(bob.id);
    ada.inventory.setSlot(0, tracked(PAINT, X));
    bob.inventory.setSlot(3, tracked(PAINT, X));
    let seen = of(world, X);
    expect(seen.finding?.status).toBe('confirmed-duplicate');
    expect(seen.locations.map((location) => location.playerId).sort()).toEqual([ada.id, bob.id].sort());
    expect(ada.inventory.count(PAINT)).toBe(1);
    expect(bob.inventory.count(PAINT)).toBe(1);
    expect(money(world).getBalance(ada.id)).toBe(beforeAda);
    expect(money(world).getBalance(bob.id)).toBe(beforeBob);

    bob.inventory.setSlot(3, null);
    ada.inventory.setSlot(8, tracked(PAINT, X));
    seen = of(world, X);
    expect(seen.finding?.status).toBe('confirmed-duplicate');
    expect(seen.locations).toHaveLength(2);
    expect(seen.locations.every((location) => location.playerId === ada.id)).toBe(true);
    expect(ada.inventory.count(PAINT)).toBe(2);

    ada.inventory.setSlot(8, null);
    const x = Math.floor(ada.controller.position.x) + 2;
    const y = Math.floor(ada.controller.position.y);
    const z = Math.floor(ada.controller.position.z);
    world.world.setBlock(x, y, z, BlockId.Chest);
    world.world.chests.set(`${x},${y},${z}`, { slots: [tracked(PAINT, X)] });
    seen = of(world, X);
    expect(seen.finding?.status).toBe('confirmed-duplicate');
    expect(seen.locations.map((location) => location.kind).sort()).toEqual(['player-inventory', 'world-chest']);
    expect(ada.inventory.count(PAINT)).toBe(1);
    expect(world.world.chests.get(`${x},${y},${z}`)?.slots[0]?.count).toBe(1);

    world.world.setBlock(x, y, z, BlockId.Furnace);
    world.world.furnaces.set(`${x},${y},${z}`, {
      slots: [tracked(PAINT, X), null, null],
      burnTime: 0,
      burnTotal: 0,
      cookTime: 0,
    });
    seen = of(world, X);
    expect(seen.finding?.status).toBe('confirmed-duplicate');
    expect(seen.locations.map((location) => location.kind).sort()).toEqual(['player-inventory', 'world-furnace']);
    expect(seen.locations.find((location) => location.kind === 'world-furnace')?.slot).toBe('input');
    world.world.furnaces.delete(`${x},${y},${z}`);

    world.gameplay.spawnDroppedStack(tracked(PAINT, X), new Vec3(ada.controller.position.x, ada.controller.position.y, ada.controller.position.z));
    seen = of(world, X);
    expect(seen.finding?.status).toBe('confirmed-duplicate');
    expect(seen.locations.map((location) => location.kind).sort()).toEqual(['player-inventory', 'world-drop']);
    expect(world.gameplay.drops.entities.filter((entity) => readItemInstanceId(entity.stack) === X)).toHaveLength(1);

    world.gameplay.drops.entities.forEach((entity) => world.gameplay.drops.remove(entity.id));
    ada.inventory.clear();
    world.world.setBlock(x, y, z, BlockId.CollectiblePainting);
    world.world.setBlock(x, y + 1, z, BlockId.CollectiblePainting);
    world.world.setBlockState(x, y, z, {
      attachment: 'wall', facing: 'east', paintingItemId: PAINT, paintingInstanceId: X,
    });
    world.world.setBlockState(x, y + 1, z, {
      attachment: 'wall', facing: 'east', paintingItemId: PAINT, paintingInstanceId: X,
    });
    world.world.setBlock(x + 1, y, z, BlockId.Stone);
    world.world.setBlockState(x + 1, y, z, {
      attachment: 'wall', facing: 'east', paintingItemId: PAINT, paintingInstanceId: X,
    });
    seen = of(world, X);
    expect(seen.finding?.status).toBe('confirmed-duplicate');
    expect(seen.locations).toHaveLength(2);
    expect(seen.locations.every((location) => location.kind === 'placed-painting')).toBe(true);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.CollectiblePainting);
    expect(world.world.getBlock(x, y + 1, z)).toBe(BlockId.CollectiblePainting);
  });

  it('confirms an inventory copy beside an active listing and a type mismatch', async () => {
    const world = await start('auction-dupe');
    const ada = addPlayer(world, 'Ada');
    ada.inventory.setSlot(0, tracked(PAINT, X));
    const listed = world.auction.createListing(ada.id, ada.name, ada.inventory, 0, 1, AUCTION_MIN_PRICE);
    expect(listed.ok).toBe(true);
    ada.inventory.setSlot(1, tracked(PAINT, X));
    const seen = of(world, X);
    expect(seen.finding?.status).toBe('confirmed-duplicate');
    expect(seen.locations.map((location) => location.kind).sort()).toEqual(['auction', 'player-inventory']);
    expect(ada.inventory.count(PAINT)).toBe(1);
    expect(world.auction.getListing(listed.listing!.listingId)?.status).toBe('ACTIVE');

    ada.inventory.setSlot(2, tracked(ItemId.GodSword, X));
    const mismatch = of(world, X);
    expect(mismatch.finding?.status).toBe('identity-type-conflict');
    expect(mismatch.finding?.itemIds).toEqual([ItemId.GodSword, PAINT].sort());
    expect(ada.inventory.getSlot(2)?.itemId).toBe(ItemId.GodSword);
    expect(ada.inventory.getSlot(1)?.itemId).toBe(PAINT);
  });

  it('does not flag a slot move, a cursor move, a trade, or an auction delivery', async () => {
    const world = await start('clean-moves');
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    ada.inventory.setSlot(1, tracked(PAINT, X));
    ada.inventory.setSlot(2, ada.inventory.getSlot(1));
    ada.inventory.setSlot(1, null);
    let seen = of(world, X);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'player-inventory', slot: '2', playerId: ada.id })]);
    expect(readItemInstanceId(ada.inventory.getSlot(2))).toBe(X);

    ada.cursor = ada.inventory.getSlot(2);
    ada.inventory.setSlot(2, null);
    seen = of(world, X);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'player-cursor', playerId: ada.id })]);

    ada.inventory.setSlot(0, ada.cursor);
    ada.cursor = null;
    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    seen = of(world, X);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'trade-offer', tradeId: world.trade.sessionFor(ada.id)?.tradeId })]);
    expect(ada.inventory.count(PAINT)).toBe(0);
    const before = money(world).getBalance(ada.id);
    expect(world.trade.ready(ada.id).ok).toBe(true);
    expect(world.trade.ready(bob.id).ok).toBe(true);
    expect(world.trade.accept(ada.id).ok).toBe(true);
    expect(world.trade.accept(bob.id).ok).toBe(true);
    seen = of(world, X);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'player-inventory', playerId: bob.id })]);
    expect(bob.inventory.count(PAINT)).toBe(1);
    expect(readItemInstanceId(bob.inventory.slots.find((stack) => stack?.itemId === PAINT) ?? null)).toBe(X);
    expect(money(world).getBalance(ada.id)).toBe(before);

    bob.inventory.setSlot(0, null);
    ada.inventory.setSlot(0, tracked(PAINT, Y));
    money(world).setBalance(bob.id, 1_000, 'ADMIN_SET');
    const balance = money(world).getBalance(bob.id);
    const listed = world.auction.createListing(ada.id, ada.name, ada.inventory, 0, 1, AUCTION_MIN_PRICE);
    expect(listed.ok).toBe(true);
    const bought = world.auction.buyListing(bob.id, bob.name, bob.inventory, listed.listing!.listingId);
    expect(bought.ok).toBe(true);
    seen = of(world, Y);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'player-inventory', playerId: bob.id })]);
    expect(world.auction.getListing(listed.listing!.listingId)?.status).toBe('SOLD');
    expect(bob.inventory.count(PAINT)).toBe(1);

    ada.inventory.setSlot(0, tracked(OTHER, X));
    const cancelled = world.auction.createListing(ada.id, ada.name, ada.inventory, 0, 1, AUCTION_MIN_PRICE);
    expect(cancelled.ok).toBe(true);
    expect(world.auction.cancelListing(ada.id, cancelled.listing!.listingId).ok).toBe(true);
    seen = of(world, X);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'auction', listingId: cancelled.listing!.listingId })]);
    expect(ada.inventory.count(OTHER)).toBe(0);
    const claim = new Inventory();
    expect(world.auction.claimListing(ada.id, claim, cancelled.listing!.listingId).ok).toBe(true);
    ada.inventory.setSlot(0, claim.getSlot(0));
    seen = of(world, X);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'player-inventory', playerId: ada.id })]);
    expect(world.auction.getListing(cancelled.listing!.listingId)?.status).toBe('CLAIMED');

    bob.inventory.clear();
    ada.inventory.setSlot(0, tracked(PAINT, Y));
    const active = world.auction.createListing(ada.id, ada.name, ada.inventory, 0, 1, AUCTION_MIN_PRICE);
    expect(active.ok).toBe(true);
    const relisted = world.auction.relist(ada.id, active.listing!.listingId, AUCTION_MIN_PRICE + 1);
    expect(relisted.ok).toBe(true);
    seen = of(world, Y);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toHaveLength(1);
    expect(seen.locations[0]?.listingId).toBe(relisted.listing!.listingId);
    expect(seen.locations[0]?.listingId).not.toBe(active.listing!.listingId);
    expect(world.auction.getListing(active.listing!.listingId)?.status).toBe('RELISTED');
    expect(money(world).getBalance(bob.id)).toBe(balance - AUCTION_MIN_PRICE);
  });

  it('counts a disconnected player once, then the stored row once after sweep', async () => {
    const world = await start('offline');
    const ada = addPlayer(world, 'Ada');
    ada.inventory.setSlot(0, tracked(PAINT, X));
    world.disconnect(ada.id);
    let seen = of(world, X);
    expect(world.players.has(ada.id)).toBe(true);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toHaveLength(1);
    expect(seen.locations[0]).toMatchObject({ kind: 'player-inventory', playerId: ada.id });

    const held = world.players.get(ada.id)!;
    held.disconnectedAt = Date.now() - SWEEP_MS - 1;
    world.tick();
    expect(world.players.has(ada.id)).toBe(false);
    seen = of(world, X);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'player-inventory', playerId: ada.id })]);
    expect(readItemInstanceId(seen.locations[0] ? tracked(PAINT, seen.locations[0].itemInstanceId) : null)).toBe(X);
  });

  it('counts held returns, a buyer window, and an open trade offer once', async () => {
    const world = await start('holders');
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) ada.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    ada.heldReturns = [tracked(PAINT, X)];
    let seen = of(world, X);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'player-held-return', playerId: ada.id })]);
    expect(ada.inventory.count(PAINT)).toBe(0);
    expect(ada.heldReturns).toHaveLength(1);

    ada.heldReturns = [];
    ada.inventory.setSlot(0, tracked(PAINT, Y));
    const created = world.buyer.create({
      name: 'Фермер',
      worldId: world.worldId,
      x: 1, y: 64, z: 1, yaw: 0, pitch: 0,
    });
    expect(created.ok).toBe(true);
    expect(world.buyer.configure(created.buyer!.id, { itemId: PAINT, pricePerItem: AUCTION_MIN_PRICE }).ok).toBe(true);
    expect(world.buyer.openTrade(ada.id, created.buyer!.id, ada.inventory).ok).toBe(true);
    expect(world.buyer.handleAction(ada.id, ada.inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 0,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    seen = of(world, Y);
    expect(seen.finding).toBeUndefined();
    expect(seen.locations).toEqual([expect.objectContaining({ kind: 'buyer-window', playerId: ada.id })]);
    expect(ada.inventory.count(PAINT)).toBe(0);
    expect(readItemInstanceId(world.buyer.unsavedTradeSlot(ada.id))).toBe(Y);

    world.buyer.closeSession(ada.id, ada.inventory);
    ada.inventory.setSlot(0, tracked(OTHER, X));
    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    const session = world.trade.sessionFor(ada.id)!;
    session.settling = true;
    ada.inventory.setSlot(1, tracked(OTHER, X));
    seen = of(world, X);
    expect(seen.finding?.status).toBe('transitional');
    expect(seen.finding?.status).not.toBe('confirmed-duplicate');
    expect(ada.inventory.count(OTHER)).toBe(1);
    expect(session.offers[ada.id]?.slots[0]?.count).toBe(1);
  });

  it('ignores legacy stacks, distinct creative copies, and a malformed record', async () => {
    const world = await start('legacy');
    const ada = addPlayer(world, 'Ada');
    ada.inventory.setSlot(0, createItemStack(PAINT, 1));
    const before = readItemInstanceId(ada.inventory.getSlot(0));
    let seen = of(world, X);
    expect(before).toBeUndefined();
    expect(seen.report.findings.filter((finding) => finding.status === 'confirmed-duplicate')).toEqual([]);
    expect(readItemInstanceId(ada.inventory.getSlot(0))).toBeUndefined();
    expect(ada.inventory.count(PAINT)).toBe(1);

    ada.inventory.clear();
    world.handleChat(ada, `/give ${PAINT} 1`);
    world.handleChat(ada, `/give ${PAINT} 1`);
    const ids = ada.inventory.slots.filter((stack) => stack?.itemId === PAINT).map((stack) => readItemInstanceId(stack));
    expect(new Set(ids).size).toBe(2);
    expect(of(world, ids[0]!).finding).toBeUndefined();
    expect(of(world, ids[1]!).finding).toBeUndefined();

    const evil = {
      get itemId(): string { throw new Error('bad record'); },
      count: 1,
    };
    const scanned = scanIdentity(emptyScan({
      players: [{
        playerId: 'ada',
        inventory: [evil as never],
        armor: {},
        craft: [],
        portal: [],
        heldReturns: [],
      }],
    }));
    expect(scanned.skippedMalformed).toBe(1);
    expect(scanned.findings).toEqual([]);
    expect(world.inspectUniqueItems().worldId).toBe('legacy');
  });

  it('keeps one incident, resolves it without deleting evidence, and reloads it', async () => {
    const worldId = 'incident';
    const world = await start(worldId);
    const dataDir = dirs.at(-1)!;
    const ada = addPlayer(world, 'Ada');
    ada.inventory.setSlot(0, tracked(PAINT, X));
    ada.inventory.setSlot(1, tracked(PAINT, X));
    const first = world.inspectUniqueItems();
    const again = world.inspectUniqueItems();
    expect(again.incidents.filter((incident) => incident.itemInstanceId === X)).toHaveLength(1);
    expect(again.incidents.find((incident) => incident.itemInstanceId === X)?.seenCount).toBe(2);
    expect(again.incidents.find((incident) => incident.itemInstanceId === X)?.id).toBe(first.incidents.find((incident) => incident.itemInstanceId === X)?.id);
    expect(ada.inventory.count(PAINT)).toBe(2);

    ada.inventory.setSlot(1, null);
    const resolved = world.inspectUniqueItems();
    const row = resolved.incidents.find((incident) => incident.itemInstanceId === X);
    expect(resolved.findings.find((finding) => finding.itemInstanceId === X)).toBeUndefined();
    expect(row?.confirmed).toBe(false);
    expect(row?.locations).toHaveLength(2);
    expect(ada.inventory.count(PAINT)).toBe(1);

    ada.inventory.setSlot(1, tracked(PAINT, X));
    const token = ada.sessionToken;
    await world.save();
    await world.stop();
    worlds.pop();
    const saved = await reopen(dataDir, worldId);
    const reloaded = addPlayer(saved, 'Ada', token, false);
    expect(reloaded.inventory.count(PAINT)).toBe(2);
    const booted = saved.inspectUniqueItems();
    expect(booted.findings.find((finding) => finding.itemInstanceId === X)?.status).toBe('confirmed-duplicate');
    expect(booted.locations.filter((location) => location.itemInstanceId === X)).toHaveLength(2);
    expect(booted.incidents.some((incident) => incident.itemInstanceId === X && incident.confirmed)).toBe(true);
  });

  it('blocks a new transfer of a live conflict and allows the item after the conflict is gone', async () => {
    const world = await start('guard');
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    const balance = money(world).getBalance(bob.id);
    ada.inventory.setSlot(0, tracked(PAINT, X));
    const x = Math.floor(ada.controller.position.x) + 3;
    const y = Math.floor(ada.controller.position.y);
    const z = Math.floor(ada.controller.position.z);
    world.world.setBlock(x, y, z, BlockId.Chest);
    world.world.chests.set(`${x},${y},${z}`, { slots: [tracked(PAINT, X)] });
    world.handleAuctionAction(ada, {
      type: 'auction_action', action: 'create', slot: 0, amount: 1, price: AUCTION_MIN_PRICE,
    });
    expect(world.auction.session(ada.id).message).toBe(IDENTITY_TRANSFER_BLOCKED);
    expect(ada.inventory.count(PAINT)).toBe(1);
    expect(world.world.chests.get(`${x},${y},${z}`)?.slots[0]?.count).toBe(1);
    expect(world.auction.holdingListings()).toHaveLength(0);

    world.world.chests.delete(`${x},${y},${z}`);
    const listed = world.auction.createListing(ada.id, ada.name, ada.inventory, 0, 1, AUCTION_MIN_PRICE);
    expect(listed.ok).toBe(true);
    bob.inventory.setSlot(0, tracked(PAINT, X));
    money(world).setBalance(bob.id, 500, 'ADMIN_SET');
    world.handleAuctionAction(bob, { type: 'auction_action', action: 'buy', listingId: listed.listing!.listingId });
    expect(world.auction.session(bob.id).message).toBe(IDENTITY_TRANSFER_BLOCKED);
    expect(world.auction.getListing(listed.listing!.listingId)?.status).toBe('ACTIVE');
    expect(bob.inventory.count(PAINT)).toBe(1);
    expect(money(world).getBalance(bob.id)).toBe(500);

    bob.inventory.setSlot(0, null);
    ada.inventory.setSlot(0, tracked(OTHER, Y));
    world.world.chests.set(`${x},${y},${z}`, { slots: [tracked(OTHER, Y)] });
    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    expect(world.trade.ready(ada.id).ok).toBe(true);
    expect(world.trade.ready(bob.id).ok).toBe(true);
    world.handleTradeAction(ada, { type: 'trade_action', action: 'accept' });
    expect(world.trade.sessionFor(ada.id)?.offers[ada.id]?.slots[0]?.count).toBe(1);
    expect(bob.inventory.count(OTHER)).toBe(0);
    expect(world.world.chests.get(`${x},${y},${z}`)?.slots[0]?.count).toBe(1);
    expect(money(world).getBalance(bob.id)).toBe(500);
    expect(money(world).getBalance(ada.id)).toBe(balance);

    world.world.chests.delete(`${x},${y},${z}`);
    world.trade.cancel(ada.id);
    ada.inventory.setSlot(0, tracked(OTHER, Y));
    expect(world.inspectUniqueItems().findings.find((finding) => finding.itemInstanceId === Y)?.status).not.toBe('confirmed-duplicate');
    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    expect(world.trade.ready(ada.id).ok).toBe(true);
    expect(world.trade.ready(bob.id).ok).toBe(true);
    expect(world.trade.accept(ada.id).ok).toBe(true);
    expect(world.trade.accept(bob.id).ok).toBe(true);
    expect(bob.inventory.count(OTHER)).toBe(1);
    expect(readItemInstanceId(bob.inventory.slots.find((stack) => stack?.itemId === OTHER) ?? null)).toBe(Y);
    expect(of(world, Y).finding).toBeUndefined();
  });
});
