import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { consumeOffhandTotem } from '../../src/gameplay/totemDeathProtection';
import { createItemStack } from '../../src/inventory';
import { parseClientMessage, type ClientInventoryActionMessage } from '../../shared/protocol';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';
import { inventoryTotal, totalCount } from './helpers/itemTotals';

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'rev-world',
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
  };
}

function action(player: ServerPlayer, fields: Omit<ClientInventoryActionMessage, 'type' | 'requestId' | 'expectedInventoryRevision' | 'expectedContainerRevision'> & {
  requestId?: string;
  expectedInventoryRevision?: number;
  expectedContainerRevision?: number;
}): ClientInventoryActionMessage {
  return {
    type: 'inventory_action',
    requestId: fields.requestId ?? randomUUID(),
    expectedInventoryRevision: fields.expectedInventoryRevision ?? player.inventoryRevision,
    ...fields,
  };
}

describe('inventory revision and replay', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(): Promise<WorldInstance> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-rev-'));
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

  it('splits, quick-moves, drops, and equips once when the same request is repeated', async () => {
    const world = await start();
    const player = addPlayer(world, 'Ada');
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack('diamond', 8));
    player.inventory.setSlot(9, createItemStack('cobblestone', 8));
    player.inventory.setSlot(10, createItemStack('iron_chestplate', 1));
    player.inventory.setSlot(11, createItemStack('stick', 4));
    const before = inventoryTotal(player.inventory, 'diamond');

    const split = action(player, { action: 'split_stack', key: 'inventory-0', count: 3 });
    world.applyInventoryAction(player, split);
    world.applyInventoryAction(player, split);
    expect(player.inventory.getSlot(0)?.count).toBe(5);
    expect(inventoryTotal(player.inventory, 'diamond')).toBe(before);

    const moved = action(player, { action: 'click', key: 'inventory-9', button: 'left', shift: true });
    world.applyInventoryAction(player, moved);
    world.applyInventoryAction(player, moved);
    expect(player.inventory.getSlot(9)).toBeNull();
    expect(inventoryTotal(player.inventory, 'cobblestone')).toBe(8);

    const dropped = action(player, { action: 'drop_selected', slot: 11, count: 1 });
    const dropsBefore = world.gameplay.drops.count;
    world.applyInventoryAction(player, dropped);
    world.applyInventoryAction(player, dropped);
    expect(player.inventory.count('stick')).toBe(3);
    expect(world.gameplay.drops.count).toBe(dropsBefore + 1);

    player.cursor = createItemStack('oak_planks', 4);
    const drag = action(player, {
      action: 'drag_distribute',
      button: 'left',
      keys: ['inventory-20', 'inventory-21'],
    });
    world.applyInventoryAction(player, drag);
    world.applyInventoryAction(player, drag);
    expect(totalCount([
      player.inventory.getSlot(20),
      player.inventory.getSlot(21),
      player.cursor,
    ], 'oak_planks')).toBe(4);

    const equip = action(player, { action: 'click', key: 'inventory-10', button: 'left', shift: true });
    world.applyInventoryAction(player, equip);
    world.applyInventoryAction(player, equip);
    expect(player.inventory.getSlot({ section: 'armor', slot: 'chest' })?.itemId).toBe('iron_chestplate');
    expect(player.inventory.count('iron_chestplate')).toBe(1);
  }, 60_000);

  it('rejects a stale inventory revision and a reused request id without disconnecting', async () => {
    const world = await start();
    const player = addPlayer(world, 'Ada');
    player.inventory.setSlot(0, createItemStack('diamond', 4));
    const seen = player.inventoryRevision;
    player.inventory.addItem('stick', 1);
    expect(player.inventory.revision).toBeGreaterThan(seen);
    const stale = action(player, {
      action: 'split_stack',
      key: 'inventory-0',
      count: 1,
      expectedInventoryRevision: seen,
    });
    const before = player.inventory.serialize();
    world.applyInventoryAction(player, stale);
    expect(player.inventory.serialize()).toEqual(before);
    expect(player.connected).toBe(true);

    const current = action(player, { action: 'split_stack', key: 'inventory-0', count: 1 });
    world.applyInventoryAction(player, current);
    expect(player.inventory.getSlot(0)?.count).toBe(3);
    world.applyInventoryAction(player, { ...current, action: 'drop_selected', slot: 0, count: 1 });
    expect(player.inventory.getSlot(0)?.count).toBe(3);
    expect(world.gameplay.drops.count).toBe(0);
    expect(player.connected).toBe(true);
  }, 60_000);

  it('rejects a second player chest click that still names the old container revision', async () => {
    const world = await start();
    const ada = addPlayer(world, 'Ada');
    const bea = addPlayer(world, 'Bea');
    const x = Math.floor(ada.controller.position.x);
    const y = Math.floor(ada.controller.position.y);
    const z = Math.floor(ada.controller.position.z) + 1;
    world.world.setBlock(x, y, z, BlockId.Chest);
    const chest = world.world.getChest(x, y, z);
    chest.slots[0] = createItemStack('diamond', 4);
    ada.inventory.setSlot(0, createItemStack('diamond', 2));
    bea.inventory.setSlot(0, createItemStack('diamond', 2));
    world.applyInventoryAction(ada, { type: 'inventory_action', action: 'open', kind: 'chest', x, y, z });
    world.applyInventoryAction(bea, { type: 'inventory_action', action: 'open', kind: 'chest', x, y, z });
    const shared = world.world.containerRevision('chest', x, y, z);
    const totalBefore = inventoryTotal(ada.inventory, 'diamond')
      + inventoryTotal(bea.inventory, 'diamond')
      + totalCount(chest.slots, 'diamond');
    world.applyInventoryAction(ada, action(ada, {
      action: 'click',
      key: 'container-0',
      button: 'left',
      expectedContainerRevision: shared,
    }));
    expect(world.world.containerRevision('chest', x, y, z)).toBeGreaterThan(shared);
    const beaBefore = bea.inventory.serialize();
    const chestBefore = chest.slots.map((slot) => slot ? { ...slot } : null);
    world.applyInventoryAction(bea, action(bea, {
      action: 'click',
      key: 'container-0',
      button: 'right',
      expectedContainerRevision: shared,
    }));
    expect(bea.inventory.serialize()).toEqual(beaBefore);
    expect(chest.slots.map((slot) => slot ? { itemId: slot.itemId, count: slot.count } : null))
      .toEqual(chestBefore.map((slot) => slot ? { itemId: slot.itemId, count: slot.count } : null));
    expect(bea.connected).toBe(true);
    const totalAfter = inventoryTotal(ada.inventory, 'diamond', ada.cursor)
      + inventoryTotal(bea.inventory, 'diamond', bea.cursor)
      + totalCount(chest.slots, 'diamond');
    expect(totalAfter).toBe(totalBefore);
  }, 60_000);

  it('rejects a furnace click after the furnace itself changes the slots', async () => {
    const world = await start();
    const player = addPlayer(world, 'Ada');
    const x = Math.floor(player.controller.position.x);
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z) + 1;
    world.world.setBlock(x, y, z, BlockId.Furnace);
    const furnace = world.world.getFurnace(x, y, z);
    furnace.slots[0] = createItemStack('cobblestone', 8);
    furnace.slots[1] = createItemStack('coal', 4);
    world.applyInventoryAction(player, { type: 'inventory_action', action: 'open', kind: 'furnace', x, y, z });
    const seen = world.world.containerRevision('furnace', x, y, z);
    world.world.tick();
    expect(world.world.containerRevision('furnace', x, y, z)).toBeGreaterThan(seen);
    const before = furnace.slots.map((slot) => slot?.count ?? 0);
    world.applyInventoryAction(player, action(player, {
      action: 'click',
      key: 'furnace-0',
      button: 'left',
      expectedContainerRevision: seen,
    }));
    expect(furnace.slots.map((slot) => slot?.count ?? 0)).toEqual(before);
  }, 60_000);

  it('advances revision for pickup, totem use, auction listing, and trade escrow', async () => {
    const world = await start();
    const ada = addPlayer(world, 'Ada');
    const bea = addPlayer(world, 'Bea');
    const beforePickup = ada.inventory.revision;
    world.gameplay.drops.spawn(
      createItemStack('stick', 2),
      ada.controller.position,
      { pickupDelaySeconds: 0 },
    );
    world.gameplay.collectFor(ada);
    expect(ada.inventory.count('stick')).toBe(2);
    expect(ada.inventory.revision).toBeGreaterThan(beforePickup);

    ada.inventory.setSlot({ section: 'offhand' }, createItemStack('totem_of_undying', 1));
    const beforeTotem = ada.inventory.revision;
    expect(consumeOffhandTotem(ada.inventory)).toBe(true);
    expect(ada.inventory.getSlot({ section: 'offhand' })).toBeNull();
    expect(ada.inventory.revision).toBeGreaterThan(beforeTotem);

    ada.inventory.setSlot(1, createItemStack('diamond', 3));
    const beforeAuction = ada.inventory.revision;
    const listed = world.auction.createListing(ada.id, ada.name, ada.inventory, 1, 1, 10);
    expect(listed.ok).toBe(true);
    expect(ada.inventory.getSlot(1)?.count).toBe(2);
    expect(ada.inventory.revision).toBeGreaterThan(beforeAuction);

    expect(world.trade.request(ada.id, 'Bea').ok).toBe(true);
    const incoming = world.trade.incomingRequests(bea.id)[0];
    expect(incoming).toBeDefined();
    expect(world.trade.acceptRequest(bea.id, incoming!.requestId).ok).toBe(true);
    bea.inventory.setSlot(2, createItemStack('iron_ingot', 5));
    const beforeTrade = bea.inventory.revision;
    expect(world.trade.putItem(bea.id, 2).ok).toBe(true);
    expect(bea.inventory.revision).toBeGreaterThan(beforeTrade);
    expect(world.trade.returnItem(bea.id, 0).ok).toBe(true);
    expect(bea.inventory.count('iron_ingot')).toBe(5);
  }, 60_000);

  it('rejects a malformed inventory mutation before it can change items', () => {
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'split_stack',
      key: 'inventory-0',
      count: 1,
    })).toEqual({ error: 'inventory_action.requestId invalid' });
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'click',
      key: 'inventory-0',
      button: 'left',
      requestId: randomUUID(),
      expectedInventoryRevision: Number.NaN,
    })).toEqual({ error: 'inventory_action.expectedInventoryRevision invalid' });
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
      requestId: randomUUID(),
      expectedInventoryRevision: 0,
    })).toEqual({ error: 'inventory_action.expectedContainerRevision invalid' });
    const parsed = parseClientMessage({
      type: 'inventory_action',
      action: 'open',
      kind: 'inventory',
    });
    expect(parsed).toMatchObject({ type: 'inventory_action', action: 'open' });
  });
});
