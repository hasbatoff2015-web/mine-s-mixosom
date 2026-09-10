import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import type { ServerAuctionMessage } from '../../shared/protocol';
import { ECONOMY_INITIAL_BALANCE } from '../../server/services/economy';
import {
  AUCTION_PAGE_SIZE,
  AUCTION_PRICE_EMPTY_ERROR,
  AUCTION_PRICE_RANGE_ERROR,
} from '../../server/services/auction';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-ah-plugin-'));
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Op'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function resultLines(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text) lines.push(record.text);
  }
  return lines;
}

function lastAuction(sink: MemorySink): ServerAuctionMessage | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as { type?: string };
    if (payload.type === 'auction') return payload as ServerAuctionMessage;
  }
  return undefined;
}

describe('Auction plugin', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dataDir?: string): Promise<WorldInstance> {
    const dir = dataDir ?? await tempDir();
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function chat(world: WorldInstance, player: ReturnType<typeof join>, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return resultLines(player.sink);
  }

  it('opens inventory-style screens for /ah, /ah sell and /ah list', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/ah').some((line) => line.includes('аукцион'))).toBe(true);
    const browse = lastAuction(ada.sink);
    expect(browse?.screen).toBe('browse');
    expect(browse?.title).toBe('Аукцион');
    expect(browse?.totalCount).toBe(0);
    expect(chat(world, ada, '/ah sell')[0]).toMatch(/продаж/);
    expect(lastAuction(ada.sink)?.screen).toBe('sell-pick');
    expect(chat(world, ada, '/ah list')[0]).toMatch(/лотов/);
    expect(lastAuction(ada.sink)?.screen).toBe('mine');
    expect(chat(world, ada, '/auction help').some((line) => line.includes('/ah sell'))).toBe(true);
  });

  it('lists, sells a partial stack, and lets another player buy it', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.economy.deposit(bob.player.id, 400, 'ADMIN_GIVE');
    ada.player.inventory.setSlot(5, createItemStack('stone', 64));
    chat(world, ada, '/ah sell');
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'select_slot', slot: 5 });
    expect(lastAuction(ada.sink)?.screen).toBe('sell-confirm');
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'set_amount', amount: 20 });
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'create',
      slot: 5,
      amount: 20,
      price: '250',
    });
    expect(ada.player.inventory.getSlot(5)?.count).toBe(44);
    expect(lastAuction(ada.sink)?.message).toMatch(/выставлен/);
    const listingId = world.auction.queryMine(ada.player.id).listings[0]!.listingId;

    chat(world, bob, '/ah');
    const browse = lastAuction(bob.sink)!;
    expect(browse.listings).toHaveLength(1);
    expect(browse.listings[0]?.listingId).toBe(listingId);
    world.handleAuctionAction(bob.player, { type: 'auction_action', action: 'select', listingId });
    expect(lastAuction(bob.sink)?.screen).toBe('buy');
    const stoneBefore = bob.player.inventory.slots.reduce(
      (sum, stack) => sum + (stack?.itemId === 'stone' ? stack.count : 0),
      0,
    );
    world.handleAuctionAction(bob.player, { type: 'auction_action', action: 'buy', listingId });
    const stoneAfter = bob.player.inventory.slots.reduce(
      (sum, stack) => sum + (stack?.itemId === 'stone' ? stack.count : 0),
      0,
    );
    expect(stoneAfter - stoneBefore).toBe(20);
    expect(world.economy.getBalance(bob.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 400 - 250);
    expect(world.economy.getBalance(ada.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 250);
    expect(world.auction.getListing(listingId)?.status).toBe('SOLD');
    const afterBuy = lastAuction(bob.sink)!;
    expect(afterBuy.screen).toBe('browse');
    expect(afterBuy.message).toBeUndefined();
    expect(afterBuy.message ?? '').not.toMatch(/купили/i);
    expect(afterBuy.listings.some((listing) => listing.listingId === listingId)).toBe(false);
  });

  it('pays an offline seller and keeps the listing after restart', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = await boot(dir);
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    ada.player.inventory.setSlot(0, createItemStack('diamond', 2, { metadata: { mark: 'keep' } }));
    const created = world.auction.createListing(
      ada.player.id,
      ada.player.name,
      ada.player.inventory,
      0,
      2,
      80,
    );
    expect(created.ok).toBe(true);
    const listingId = created.listing!.listingId;
    const adaToken = ada.player.sessionToken;
    world.disconnect(ada.player.id);
    world.economy.deposit(bob.player.id, 50, 'ADMIN_GIVE');
    expect(world.auction.buyListing(bob.player.id, bob.player.name, bob.player.inventory, listingId).ok).toBe(true);
    expect(world.economy.getBalance(ada.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 80);

    await world.save();
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = await boot(dir);
    expect(again.auction.getListing(listingId)?.status).toBe('SOLD');
    expect(again.economy.getBalance(ada.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 80);
    const adaAgain = join(again, 'Ada', adaToken);
    expect(adaAgain.player.inventory.getSlot(0)).toBeNull();
    expect(again.economy.getBalance(adaAgain.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 80);
  });

  it('returns cancelled items only when inventory has room', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    ada.player.inventory.setSlot(0, createItemStack('gold_ingot', 8));
    const created = world.auction.createListing(ada.player.id, 'Ada', ada.player.inventory, 0, 8, 10);
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'cancel',
      listingId: created.listing!.listingId,
    });
    expect(world.auction.getListing(created.listing!.listingId)?.status).toBe('CANCELLED');
    for (let i = 0; i < 36; i += 1) ada.player.inventory.setSlot(i, createItemStack('dirt', 64));
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'claim',
      listingId: created.listing!.listingId,
    });
    expect(lastAuction(ada.sink)?.message).toBe('Недостаточно места в инвентаре.');
    expect(world.auction.getListing(created.listing!.listingId)?.status).toBe('CANCELLED');
    ada.player.inventory.setSlot(1, null);
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'claim',
      listingId: created.listing!.listingId,
    });
    expect(ada.player.inventory.getSlot(1)).toEqual(createItemStack('gold_ingot', 8));
    expect(world.auction.getListing(created.listing!.listingId)?.status).toBe('CLAIMED');
  });

  it('relists from /ah list without returning the item to inventory', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    ada.player.inventory.setSlot(0, createItemStack('iron_ingot', 4));
    const created = world.auction.createListing(ada.player.id, 'Ada', ada.player.inventory, 0, 4, 20);
    chat(world, ada, '/ah list');
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'select',
      listingId: created.listing!.listingId,
    });
    expect(lastAuction(ada.sink)?.screen).toBe('manage');
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'relist',
      listingId: created.listing!.listingId,
    });
    expect(lastAuction(ada.sink)?.screen).toBe('relist');
    expect(world.auction.getListing(created.listing!.listingId)?.status).toBe('ACTIVE');
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'back' });
    expect(world.auction.getListing(created.listing!.listingId)?.status).toBe('ACTIVE');
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'relist',
      listingId: created.listing!.listingId,
    });
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'relist',
      listingId: created.listing!.listingId,
      price: '60',
    });
    expect(world.auction.getListing(created.listing!.listingId)?.status).toBe('RELISTED');
    expect(ada.player.inventory.getSlot(0)).toBeNull();
    const mine = world.auction.queryMine(ada.player.id);
    expect(mine.listings).toHaveLength(1);
    expect(mine.listings[0]?.price).toBe(60);
    expect(mine.listings[0]?.status).toBe('ACTIVE');
  });

  it('reports empty price separately from an out-of-range price', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    ada.player.inventory.setSlot(0, createItemStack('stone', 16));
    chat(world, ada, '/ah sell');
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'select_slot', slot: 0 });
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'create', slot: 0, amount: 8, price: '' });
    expect(lastAuction(ada.sink)?.message).toBe(AUCTION_PRICE_EMPTY_ERROR);
    expect(ada.player.inventory.getSlot(0)?.count).toBe(16);
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'create', slot: 0, amount: 8, price: '5' });
    expect(lastAuction(ada.sink)?.message).toBe(AUCTION_PRICE_RANGE_ERROR);
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'create', slot: 0, amount: 8, price: '9' });
    expect(lastAuction(ada.sink)?.message).toBe(AUCTION_PRICE_RANGE_ERROR);
    world.handleAuctionAction(ada.player, {
      type: 'auction_action',
      action: 'create',
      slot: 0,
      amount: 8,
      price: '100000001',
    });
    expect(lastAuction(ada.sink)?.message).toBe(AUCTION_PRICE_RANGE_ERROR);
    expect(ada.player.inventory.getSlot(0)?.count).toBe(16);
  });

  it('keeps search text and clamps the page on refresh', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.economy.deposit(bob.player.id, 500, 'ADMIN_GIVE');
    for (let i = 0; i < AUCTION_PAGE_SIZE + 1; i += 1) {
      ada.player.inventory.setSlot(0, createItemStack('stone', 1));
      expect(world.auction.createListing(ada.player.id, 'Ada', ada.player.inventory, 0, 1, 10).ok).toBe(true);
    }
    chat(world, bob, '/ah');
    world.handleAuctionAction(bob.player, { type: 'auction_action', action: 'search', search: 'stone' });
    expect(lastAuction(bob.sink)?.search).toBe('stone');
    world.handleAuctionAction(bob.player, { type: 'auction_action', action: 'page', page: 2 });
    const page2 = lastAuction(bob.sink)!;
    expect(page2.page).toBe(2);
    expect(page2.search).toBe('stone');
    const loneId = page2.listings[0]!.listingId;
    world.handleAuctionAction(bob.player, { type: 'auction_action', action: 'refresh' });
    const refreshed = lastAuction(bob.sink)!;
    expect(refreshed.screen).toBe('browse');
    expect(refreshed.search).toBe('stone');
    expect(refreshed.page).toBe(2);
    world.handleAuctionAction(bob.player, { type: 'auction_action', action: 'buy', listingId: loneId });
    expect(lastAuction(bob.sink)?.message).toBeUndefined();
    world.handleAuctionAction(bob.player, { type: 'auction_action', action: 'refresh' });
    const clamped = lastAuction(bob.sink)!;
    expect(clamped.search).toBe('stone');
    expect(clamped.page).toBe(1);
    expect(clamped.totalPages).toBe(1);
    expect(clamped.listings.some((listing) => listing.listingId === loneId)).toBe(false);
  });

  it('mirrors the chosen amount onto the sell snapshot item', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    ada.player.inventory.setSlot(3, createItemStack('stone', 64));
    chat(world, ada, '/ah sell');
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'select_slot', slot: 3 });
    expect(lastAuction(ada.sink)?.selected).toMatchObject({ amount: 64, item: { count: 64 } });
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'set_amount', amount: 59 });
    expect(lastAuction(ada.sink)?.selected).toMatchObject({ amount: 59, item: { count: 59 } });
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'set_amount', amount: 1 });
    expect(lastAuction(ada.sink)?.selected).toMatchObject({ amount: 1, item: { count: 1 } });
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'set_amount', amount: 64 });
    expect(lastAuction(ada.sink)?.selected).toMatchObject({ amount: 64, item: { count: 64 } });
    expect(ada.player.inventory.getSlot(3)?.count).toBe(64);
  });
});
