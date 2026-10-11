import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { blockKey } from '../../src/core/constants';
import { createItemStack } from '../../src/inventory';
import { stampInventoryIntent } from '../../src/net/inventoryIntent';
import {
  CLIENT_MESSAGE_TYPES,
  parseClientMessage,
  type ClientInventoryActionMessage,
} from '../../shared/protocol';
import { clearCarryState, replaceCarryState } from '../../server/carryState';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';

function testConfig(dataDir: string, worldId = 'harden') {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: worldId,
      MAX_PLAYERS: '4',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
      FC_NO_BUILTIN_PLUGINS: '1',
      FC_ADMIN_IDS: 'admin-owner,admin-colleague',
    }),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    loadBuiltinPlugins: false,
    pluginDir: join(dataDir, 'plugins'),
  };
}

describe('inventory mutation hardening', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(): Promise<WorldInstance> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-harden-'));
    dirs.push(dataDir);
    const world = new WorldInstance(testConfig(dataDir));
    worlds.push(world);
    await world.initialize();
    return world;
  }

  function addPlayer(world: WorldInstance, name: string): ServerPlayer {
    const joined = world.join({ sink: { send() {} }, name });
    if ('error' in joined) throw new Error(joined.error);
    return joined.player;
  }

  it('rejects the removed craft packet and requires revisions only on real containers', () => {
    expect(CLIENT_MESSAGE_TYPES).not.toContain('craft');
    expect(parseClientMessage({ type: 'craft', shift: true })).toEqual({
      error: 'unknown message type craft',
    });
    const id = randomUUID();
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
      requestId: id,
      expectedInventoryRevision: 0,
    })).toMatchObject({
      type: 'inventory_action',
      action: 'craft_recipe',
      requestId: id,
      expectedInventoryRevision: 0,
    });
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'click',
      key: 'craft-0',
      button: 'left',
      requestId: id,
      expectedInventoryRevision: 1,
    })).not.toHaveProperty('expectedContainerRevision');
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
      requestId: id,
      expectedInventoryRevision: 1,
    })).toEqual({ error: 'inventory_action.expectedContainerRevision invalid' });
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'click',
      key: 'furnace-0',
      button: 'left',
      requestId: id,
      expectedInventoryRevision: 1,
      expectedContainerRevision: 0,
    })).toMatchObject({ expectedContainerRevision: 0 });
    const craftingStamp = stampInventoryIntent(
      { type: 'inventory_action', action: 'click', key: 'craft-0', button: 'left' },
      { inventory: 3 },
    );
    expect(craftingStamp.expectedContainerRevision).toBeUndefined();
    expect(craftingStamp.expectedInventoryRevision).toBe(3);
    const chestStamp = stampInventoryIntent(
      { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' },
      { inventory: 3, container: 0 },
    );
    expect(chestStamp.expectedContainerRevision).toBe(0);
  });

  it('crafts on a crafting table once without a container revision', async () => {
    const world = await start();
    const player = addPlayer(world, 'Ada');
    player.inventory.clear();
    player.inventory.addItem('oak_log', 2);
    const x = Math.floor(player.controller.position.x);
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z);
    world.applyInventoryAction(player, {
      type: 'inventory_action',
      action: 'open',
      kind: 'crafting-table',
      x,
      y,
      z,
    });
    expect(player.window.kind).toBe('crafting-table');
    const revision = player.inventoryRevision;
    const stamped = stampInventoryIntent({
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
    }, { inventory: revision });
    expect(stamped.expectedContainerRevision).toBeUndefined();
    const parsed = parseClientMessage(stamped);
    if (!parsed || !('type' in parsed) || parsed.type !== 'inventory_action') {
      throw new Error('crafting action did not parse');
    }
    world.applyInventoryAction(player, parsed);
    world.applyInventoryAction(player, parsed);
    expect(player.inventory.count('oak_planks')).toBe(4);
    expect(player.inventory.count('oak_log')).toBe(1);
  }, 60_000);

  it('moves carry revision for cursor, craft grid, death, and /clear without a no-op bump', async () => {
    const world = await start();
    const player = addPlayer(world, 'Ada');
    player.inventory.clear();
    const slotRevision = player.inventory.revision;
    replaceCarryState(player, createItemStack('diamond', 1), player.craftSlots);
    expect(player.inventory.revision).toBe(slotRevision);
    const afterCursor = player.inventoryRevision;
    expect(afterCursor).toBeGreaterThan(slotRevision);
    replaceCarryState(player, player.cursor, player.craftSlots);
    expect(player.inventoryRevision).toBe(afterCursor);

    const grid = player.craftSlots.map(() => null);
    grid[0] = createItemStack('stick', 2);
    replaceCarryState(player, null, grid);
    expect(player.inventory.revision).toBe(slotRevision);
    expect(player.inventoryRevision).toBeGreaterThan(afterCursor);
    expect(player.cursor).toBeNull();
    expect(player.craftSlots[0]?.itemId).toBe('stick');

    const beforeDeath = player.inventoryRevision;
    world.gameplay.dropAllPlayerResources(player);
    expect(player.cursor).toBeNull();
    expect(player.craftSlots.every((slot) => slot === null)).toBe(true);
    expect(player.inventoryRevision).toBeGreaterThan(beforeDeath);

    replaceCarryState(player, createItemStack('apple', 1), [createItemStack('apple', 1), null, null, null]);
    const beforeClear = player.inventoryRevision;
    world.handleChat(player, '/clear');
    expect(player.cursor).toBeNull();
    expect(player.craftSlots.every((slot) => slot === null)).toBe(true);
    expect(player.inventoryRevision).toBeGreaterThan(beforeClear);

    const picked = player.inventoryRevision;
    player.inventory.setSlot(0, createItemStack('cobblestone', 4));
    const click: ClientInventoryActionMessage = {
      type: 'inventory_action',
      action: 'click',
      key: 'inventory-0',
      button: 'left',
      requestId: randomUUID(),
      expectedInventoryRevision: player.inventoryRevision,
    };
    world.applyInventoryAction(player, click);
    expect(player.cursor?.itemId).toBe('cobblestone');
    expect(player.carryRevision).toBeGreaterThan(0);
    expect(player.inventoryRevision).toBeGreaterThan(picked);
    clearCarryState(player);
  }, 60_000);

  it('reports the composite revision and a zero container revision', async () => {
    const world = await start();
    const player = addPlayer(world, 'Ada');
    const x = Math.floor(player.controller.position.x);
    const y = Math.max(1, Math.floor(player.controller.position.y));
    const z = Math.floor(player.controller.position.z) + 1;
    world.world.setBlock(x, y, z, BlockId.Chest);
    world.world.getChest(x, y, z);
    world.applyInventoryAction(player, {
      type: 'inventory_action',
      action: 'open',
      kind: 'chest',
      x,
      y,
      z,
    });
    replaceCarryState(player, createItemStack('diamond', 1), player.craftSlots);
    expect(player.inventoryRevision).toBeGreaterThan(player.inventory.revision);
    const view = world.inspectPlayer('admin-owner', player.id);
    expect(view?.inventoryRevision).toBe(player.inventoryRevision);
    expect(view?.containerKind).toBe('chest');
    expect(view?.containerRevision).toBe(0);
    expect(world.inspectPlayer('admin-colleague', player.id)?.inventoryRevision).toBe(view?.inventoryRevision);
  }, 60_000);

  it('does not let a second viewer recreate a broken chest or use the old generation', async () => {
    const world = await start();
    const ada = addPlayer(world, 'Ada');
    const bea = addPlayer(world, 'Bea');
    ada.gamemode = 'creative';
    const x = Math.floor(ada.controller.position.x) + 1;
    const y = Math.floor(ada.controller.position.y);
    const z = Math.floor(ada.controller.position.z);
    world.world.setBlock(x, y, z, BlockId.Chest);
    const chest = world.world.getChest(x, y, z);
    chest.slots[0] = createItemStack('diamond', 5);
    world.applyInventoryAction(ada, { type: 'inventory_action', action: 'open', kind: 'chest', x, y, z });
    world.applyInventoryAction(bea, { type: 'inventory_action', action: 'open', kind: 'chest', x, y, z });
    const seen = world.world.containerRevision('chest', x, y, z);
    const broken = world.gameplay.breakBlock(ada, x, y, z);
    expect(broken.ok).toBe(true);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(world.world.chests.has(blockKey(x, y, z))).toBe(false);
    expect(bea.window.kind).toBe('inventory');
    expect(bea.connected).toBe(true);
    const beaBefore = bea.inventory.serialize();
    world.applyInventoryAction(bea, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
      requestId: randomUUID(),
      expectedInventoryRevision: bea.inventoryRevision,
      expectedContainerRevision: seen,
    });
    expect(bea.inventory.serialize()).toEqual(beaBefore);
    expect(world.world.chests.has(blockKey(x, y, z))).toBe(false);
    expect(world.gameplay.drops.count).toBeGreaterThan(0);

    world.world.setBlock(x, y, z, BlockId.Chest);
    const replacement = world.world.getChest(x, y, z);
    replacement.slots[0] = createItemStack('diamond', 1);
    world.applyInventoryAction(bea, { type: 'inventory_action', action: 'open', kind: 'chest', x, y, z });
    expect(world.world.containerRevision('chest', x, y, z)).toBeGreaterThan(seen);
    const before = replacement.slots[0]?.count;
    world.applyInventoryAction(bea, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
      requestId: randomUUID(),
      expectedInventoryRevision: bea.inventoryRevision,
      expectedContainerRevision: seen,
    });
    expect(replacement.slots[0]?.count).toBe(before);
    expect(bea.connected).toBe(true);
  }, 60_000);

  it('does not let a stale furnace viewer recreate a broken furnace', async () => {
    const world = await start();
    const ada = addPlayer(world, 'Ada');
    const bea = addPlayer(world, 'Bea');
    ada.gamemode = 'creative';
    const x = Math.floor(ada.controller.position.x) + 1;
    const y = Math.floor(ada.controller.position.y);
    const z = Math.floor(ada.controller.position.z);
    world.world.setBlock(x, y, z, BlockId.Furnace);
    const furnace = world.world.getFurnace(x, y, z);
    furnace.slots[0] = createItemStack('cobblestone', 3);
    furnace.slots[1] = createItemStack('coal', 2);
    world.applyInventoryAction(ada, { type: 'inventory_action', action: 'open', kind: 'furnace', x, y, z });
    world.applyInventoryAction(bea, { type: 'inventory_action', action: 'open', kind: 'furnace', x, y, z });
    const seen = world.world.containerRevision('furnace', x, y, z);
    expect(world.gameplay.breakBlock(ada, x, y, z).ok).toBe(true);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(world.world.furnaces.has(blockKey(x, y, z))).toBe(false);
    expect(bea.window.kind).toBe('inventory');
    world.applyInventoryAction(bea, {
      type: 'inventory_action',
      action: 'click',
      key: 'furnace-0',
      button: 'left',
      requestId: randomUUID(),
      expectedInventoryRevision: bea.inventoryRevision,
      expectedContainerRevision: seen,
    });
    expect(world.world.furnaces.has(blockKey(x, y, z))).toBe(false);
    expect(bea.connected).toBe(true);
    world.world.setBlock(x, y, z, BlockId.Furnace);
    const next = world.world.getFurnace(x, y, z);
    next.slots[1] = createItemStack('coal', 1);
    world.applyInventoryAction(bea, { type: 'inventory_action', action: 'open', kind: 'furnace', x, y, z });
    const fuel = next.slots[1]?.count;
    world.applyInventoryAction(bea, {
      type: 'inventory_action',
      action: 'click',
      key: 'furnace-1',
      button: 'left',
      requestId: randomUUID(),
      expectedInventoryRevision: bea.inventoryRevision,
      expectedContainerRevision: seen,
    });
    expect(next.slots[1]?.count).toBe(fuel);
  }, 60_000);
});
