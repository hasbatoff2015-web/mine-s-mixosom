import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import type { ServerMenuMessage, ServerTradeMessage } from '../../shared/protocol';
import { HOME_LIMIT_ERROR, HOME_MAX_DEFAULT, HOME_NAME_TAKEN_ERROR } from '../../shared/homes';
import { ECONOMY_INITIAL_BALANCE } from '../../server/services/economy';
import { GAME_MENU_BUTTONS } from '../../shared/gameMenu';
import { createItemStack } from '../../src/inventory';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-menu-'));
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

function lastOf<T extends { type?: string }>(sink: MemorySink, type: string): T | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as T;
    if (payload.type === type) return payload;
  }
  return undefined;
}

describe('game menu plugin', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  it('opens the root menu and nested pages, then closes with X', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'root' });
    const root = lastOf<ServerMenuMessage>(ada.sink, 'menu');
    expect(root?.screen).toBe('root');
    expect(root?.balance).toBe(ECONOMY_INITIAL_BALANCE);
    expect(root?.balanceLabel).toBe('100');
    expect(GAME_MENU_BUTTONS).toHaveLength(8);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'homes' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.screen).toBe('homes');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'back' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.screen).toBe('root');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'close' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.screen).toBe('closed');
  });

  it('creates unique homes up to 3, teleports, and deletes after confirm', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    world.handleChat(op.player, '/home config set cooldownSeconds 0');
    ada.player.controller.teleport([12, 70, -4]);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'homes' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.homeMax).toBe(HOME_MAX_DEFAULT);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_create', name: 'Дом' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_create', name: 'Дом' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.message).toBe(HOME_NAME_TAKEN_ERROR);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_create', name: 'Шахта' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_create', name: 'База' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_create', name: 'Ферма' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_create', name: 'Лишняя' });
    const full = lastOf<ServerMenuMessage>(ada.sink, 'menu');
    expect(full?.homeCount).toBe(HOME_MAX_DEFAULT);
    expect(full?.homeMax).toBe(HOME_MAX_DEFAULT);
    expect(full?.message).toBe(HOME_LIMIT_ERROR(HOME_MAX_DEFAULT));
    ada.player.controller.teleport([40, 70, 40]);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_teleport', name: 'Дом' });
    expect(ada.player.controller.position.x).toBeCloseTo(12, 1);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'homes' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_delete', name: 'Шахта' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.screen).toBe('home-delete-confirm');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_confirm_delete' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.homeCount).toBe(2);
  });

  it('sends a friend request, accepts it, and respects teleport permission', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'friends' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'friends_request', name: 'Ada' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.message).toContain('себя');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'friends_request', name: 'Bob' });
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'friends' });
    const bobFriends = lastOf<ServerMenuMessage>(bob.sink, 'menu');
    const requestId = bobFriends?.friendRequests?.[0]?.requestId;
    expect(requestId).toBeTruthy();
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_accept', requestId });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'friends_teleport', playerId: bob.player.id });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.message).toContain('запретил');
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_set_tp', enabled: true });
    bob.player.controller.teleport([30, 70, 30]);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'friends_teleport', playerId: bob.player.id });
    expect(ada.player.controller.position.x).toBeCloseTo(30, 1);
  });

  it('opens auction from the menu with a back-to-menu source', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'auction' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'auction_open' });
    const auction = lastOf<{ type: string; source?: string; screen?: string }>(ada.sink, 'auction');
    expect(auction?.screen).toBe('browse');
    expect(auction?.source).toBe('menu');
    world.handleAuctionAction(ada.player, { type: 'auction_action', action: 'back' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.screen).toBe('auction');
  });

  it('starts a trade session from the menu lobby', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    ada.player.inventory.setSlot(0, createItemStack('stone', 8));
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'trade' });
    const nearbyLobby = lastOf<ServerMenuMessage>(ada.sink, 'menu');
    expect(nearbyLobby?.tradeNearby?.some((row) => row.name === 'Bob')).toBe(true);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'trade_request', name: 'Bob' });
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'trade' });
    const incoming = lastOf<ServerMenuMessage>(bob.sink, 'menu')?.tradeIncoming?.[0]?.requestId;
    expect(incoming).toBeTruthy();
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'trade_accept', requestId: incoming });
    expect(lastOf<ServerTradeMessage>(ada.sink, 'trade')?.screen).toBe('session');
    expect(lastOf<ServerTradeMessage>(bob.sink, 'trade')?.screen).toBe('session');
    world.handleTradeAction(ada.player, { type: 'trade_action', action: 'put_item', slot: 0, tradeSlot: 0 });
    world.handleTradeAction(ada.player, { type: 'trade_action', action: 'ready' });
    world.handleTradeAction(bob.player, { type: 'trade_action', action: 'ready' });
    world.handleTradeAction(ada.player, { type: 'trade_action', action: 'accept' });
    world.handleTradeAction(bob.player, { type: 'trade_action', action: 'close' });
    expect(lastOf<ServerTradeMessage>(ada.sink, 'trade')?.screen).toBe('closed');
    expect(ada.player.inventory.getSlot(0)?.itemId).toBe('stone');
  });

  it('sends both players their own and partner coin offers from the server snapshot', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'trade' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'trade_request', name: 'Bob' });
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'trade' });
    const incoming = lastOf<ServerMenuMessage>(bob.sink, 'menu')?.tradeIncoming?.[0]?.requestId;
    expect(incoming).toBeTruthy();
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'trade_accept', requestId: incoming });
    world.handleTradeAction(ada.player, { type: 'trade_action', action: 'ready' });
    world.handleTradeAction(bob.player, { type: 'trade_action', action: 'ready' });
    expect(lastOf<ServerTradeMessage>(ada.sink, 'trade')?.bothReady).toBe(true);
    world.handleTradeAction(ada.player, { type: 'trade_action', action: 'set_money', money: 40 });
    world.handleTradeAction(bob.player, { type: 'trade_action', action: 'set_money', money: 70 });
    const adaTrade = lastOf<ServerTradeMessage>(ada.sink, 'trade');
    const bobTrade = lastOf<ServerTradeMessage>(bob.sink, 'trade');
    expect(adaTrade?.money).toBe(40);
    expect(adaTrade?.moneyText).toBe('40');
    expect(adaTrade?.partnerMoney).toBe(70);
    expect(adaTrade?.partnerMoneyText).toBe('70');
    expect(bobTrade?.money).toBe(70);
    expect(bobTrade?.moneyText).toBe('70');
    expect(bobTrade?.partnerMoney).toBe(40);
    expect(bobTrade?.partnerMoneyText).toBe('40');
    expect(adaTrade?.selfReady).toBe(false);
    expect(adaTrade?.partnerReady).toBe(false);
    expect(bobTrade?.selfReady).toBe(false);
    expect(bobTrade?.bothReady).toBe(false);
  });

  it('opens the rating tab with four independent modes and personal place', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'rating' });
    const first = lastOf<ServerMenuMessage>(ada.sink, 'menu');
    expect(first?.screen).toBe('rating');
    expect(first?.ratingKind).toBe('players-money');
    expect(first?.personalRank).toBe(1);
    expect(first?.personalText).toMatch(/#1/);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'rating_set', ratingKind: 'players-kills' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.ratingKind).toBe('players-kills');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'rating_set', ratingKind: 'clans-money' });
    const clans = lastOf<ServerMenuMessage>(ada.sink, 'menu');
    expect(clans?.ratingKind).toBe('clans-money');
    expect(clans?.personalText).toBe('Вы не состоите в клане');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'back' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.screen).toBe('root');
  });
});
