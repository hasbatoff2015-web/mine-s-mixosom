import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../src/core/constants';
import { createItemStack } from '../../src/inventory';
import { creativeCatalogItems, ItemId } from '../../src/items';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import type { Plugin } from '../../server/PluginManager';
import { syncAuction, AUCTION_MIN_PRICE } from '../../server/services/auction';
import { EconomyService } from '../../server/services/economy';
import type { ItemDurability } from '../../server/settlements/durability';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';

const FAR = { x: -480, y: 70, z: -496 };
const UNKNOWN = { x: 9100, y: 70, z: 9104 };

describe('stage 3C valuable resources', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(worldId: string, seed?: string): Promise<{ world: WorldInstance; dataDir: string }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-3c-'));
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
        ...(seed ? { WORLD_SEED: seed } : {}),
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

  function addPlayer(world: WorldInstance, name: string, sessionToken?: string, clear = true): ServerPlayer {
    const joined = world.join({ sink: { send() {} }, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in joined) throw new Error(joined.error);
    world.permissions.op(joined.player.id);
    if (clear) joined.player.inventory.clear();
    return joined.player;
  }

  function money(world: WorldInstance): EconomyService {
    return world.money as EconomyService;
  }

  function row(world: WorldInstance, itemId: string) {
    return world.inspectValuableResources().resources.find((resource) => resource.itemId === itemId)!;
  }

  it('credits a real diamond break and ignores rejected breaks', async () => {
    const { world } = await start('mine');
    const player = addPlayer(world, 'Ada');
    const x = Math.floor(player.controller.position.x);
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z) + 1;
    world.world.setBlock(x, y, z, BlockId.DiamondOre);
    player.selectedSlot = 0;
    player.inventory.setSlot(0, createItemStack(ItemId.IronPickaxe));
    player.miningTarget = { x, y, z };
    player.miningProgress = 1;
    expect(world.gameplay.breakBlock(player, x, y, z)).toEqual({ ok: true });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    const dropped = world.gameplay.drops.entities.reduce((sum, entity) => (
      entity.stack.itemId === ItemId.Diamond ? sum + entity.stack.count : sum
    ), 0);
    expect(dropped).toBe(1);
    const report = world.inspectValuableResources();
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 1, unexplained: 0, status: 'explained-change' });
    expect(report.recentSources.filter((source) => source.kind === 'mine' && source.itemId === ItemId.Diamond)).toEqual([
      expect.objectContaining({ quantity: 1 }),
    ]);
    const mined = report.recentSources.filter((source) => source.kind === 'mine').length;
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'mine').length).toBe(mined);
    expect(world.gameplay.drops.entities.some((entity) => entity.stack.metadata?.itemInstanceId)).toBe(false);

    player.gamemode = 'creative';
    world.world.setBlock(x, y + 1, z, BlockId.DiamondOre);
    player.miningTarget = { x, y: y + 1, z };
    expect(world.gameplay.breakBlock(player, x, y + 1, z).ok).toBe(true);
    expect(row(world, ItemId.Diamond).current).toBe(1);

    player.gamemode = 'survival';
    player.inventory.setSlot(0, createItemStack(ItemId.WoodenPickaxe));
    world.world.setBlock(x, y, z, BlockId.DiamondOre);
    player.miningTarget = { x, y, z };
    player.miningProgress = 1;
    expect(world.gameplay.breakBlock(player, x, y, z).ok).toBe(true);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(row(world, ItemId.Diamond).current).toBe(1);
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'mine')).toHaveLength(1);

    player.inventory.setSlot(0, createItemStack(ItemId.IronPickaxe));
    world.events.on('blockBreak', (event) => { event.cancelled = true; });
    world.world.setBlock(x, y, z, BlockId.DiamondOre);
    player.miningTarget = { x, y, z };
    expect(world.gameplay.breakBlock(player, x, y, z).ok).toBe(false);
    expect(row(world, ItemId.Diamond).current).toBe(1);
    expect(money(world).getBalance(player.id)).toBeGreaterThanOrEqual(0);
  });

  it('records smelting and ruby crafting as transformations', async () => {
    const { world } = await start('craft');
    const player = addPlayer(world, 'Ada');
    const x = Math.floor(player.controller.position.x) + 2;
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z);
    world.world.setBlock(x, y, z, BlockId.Furnace);
    world.world.furnaces.set(`${x},${y},${z}`, {
      slots: [createItemStack('gold_ore', 1), null, null],
      burnTime: 400,
      burnTotal: 400,
      cookTime: 199,
      cookInputId: 'gold_ore',
    });
    world.world.setBlock(x, y + 1, z, BlockId.Furnace);
    world.world.furnaces.set(`${x},${y + 1},${z}`, {
      slots: [createItemStack('titanium_ore', 1), null, null],
      burnTime: 400,
      burnTotal: 400,
      cookTime: 199,
      cookInputId: 'titanium_ore',
    });
    world.world.tick();
    expect(world.world.furnaces.get(`${x},${y},${z}`)?.slots[2]).toMatchObject({ itemId: ItemId.GoldIngot, count: 1 });
    expect(world.world.furnaces.get(`${x},${y},${z}`)?.slots[0]).toBeNull();
    expect(world.world.furnaces.get(`${x},${y + 1},${z}`)?.slots[2]).toMatchObject({ itemId: ItemId.TitaniumIngot, count: 1 });
    expect(row(world, ItemId.GoldIngot)).toMatchObject({ current: 1, unexplained: 0, status: 'explained-change' });
    expect(row(world, ItemId.TitaniumIngot)).toMatchObject({ current: 1, unexplained: 0, status: 'explained-change' });

    world.handleChat(player, '/give diamond 1');
    world.handleChat(player, '/give gold_ingot 3');
    world.handleChat(player, '/give iron_ingot 3');
    expect(world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'craft_recipe', recipeId: 'ruby_ingot',
    }).ok).toBe(true);
    expect(player.inventory.count(ItemId.RubyIngot)).toBe(1);
    expect(player.inventory.count(ItemId.Diamond)).toBe(0);
    expect(player.inventory.count(ItemId.IronIngot)).toBe(0);
    expect(row(world, ItemId.RubyIngot)).toMatchObject({ current: 1, unexplained: 0 });
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 0, unexplained: 0 });
    expect(row(world, ItemId.GoldIngot)).toMatchObject({ current: 1, unexplained: 0 });
    expect(row(world, ItemId.IronIngot).unexplained).toBe(0);

    world.handleChat(player, '/give diamond 9');
    expect(world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'craft_recipe', recipeId: 'diamond_block',
    }).ok).toBe(true);
    expect(player.inventory.count(ItemId.Diamond)).toBe(0);
    expect(player.inventory.count('diamond_block')).toBe(1);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 0, unexplained: 0 });
    expect(player.inventory.getSlot(0)?.metadata?.itemInstanceId).toBeUndefined();
  });

  it('does not account a craft the cursor or a full inventory refused', async () => {
    const { world } = await start('craft-fail');
    const player = addPlayer(world, 'Ada');
    world.handleChat(player, '/give diamond 1');
    world.handleChat(player, '/give gold_ingot 3');
    world.handleChat(player, '/give iron_ingot 3');
    player.window = { kind: 'crafting-table' };
    player.craftSlots = Array.from({ length: 9 }, () => null);
    player.craftSlots[0] = player.inventory.getSlot(0) ?? null;
    player.craftSlots[1] = player.inventory.getSlot(1) ?? null;
    player.craftSlots[2] = player.inventory.getSlot(2) ?? null;
    player.inventory.setSlot(0, null);
    player.inventory.setSlot(1, null);
    player.inventory.setSlot(2, null);
    player.cursor = createItemStack('cobblestone', 1);
    const before = world.inspectValuableResources().recentSources.filter((source) => source.kind === 'craft').length;
    const refused = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'result', button: 'left',
    });
    expect(refused.committedCrafts ?? []).toEqual([]);
    expect(player.inventory.count(ItemId.RubyIngot)).toBe(0);
    expect(player.craftSlots[0]?.count).toBe(1);
    expect(player.craftSlots[1]?.count).toBe(3);
    expect(player.craftSlots[2]?.count).toBe(3);
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'craft')).toHaveLength(before);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 1, unexplained: 0 });
    expect(row(world, ItemId.RubyIngot)).toMatchObject({ current: 0, unexplained: 0 });

    player.cursor = createItemStack(ItemId.RubyIngot, 64);
    const stacked = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'result', button: 'left',
    });
    expect(stacked.committedCrafts ?? []).toEqual([]);
    expect(player.craftSlots[0]?.count).toBe(1);
    expect(player.inventory.count(ItemId.RubyIngot)).toBe(0);

    player.cursor = null;
    player.craftSlots = Array.from({ length: 9 }, () => null);
    for (let slot = 0; slot < 36; slot += 1) player.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    const missing = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'craft_recipe', recipeId: 'ruby_ingot',
    });
    expect(missing.ok).toBe(false);
    expect(missing.committedCrafts ?? []).toEqual([]);
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'craft')).toHaveLength(before);
  });

  it('accounts every successful shift craft and the items actually consumed', async () => {
    const { world } = await start('shift-craft');
    const player = addPlayer(world, 'Ada');
    world.handleChat(player, '/give diamond 5');
    world.handleChat(player, '/give gold_ingot 15');
    world.handleChat(player, '/give iron_ingot 15');
    world.handleChat(player, '/give ruby_ingot 62');
    player.window = { kind: 'crafting-table' };
    player.craftSlots = Array.from({ length: 9 }, () => null);
    player.craftSlots[0] = player.inventory.getSlot(0) ?? null;
    player.craftSlots[1] = player.inventory.getSlot(1) ?? null;
    player.craftSlots[2] = player.inventory.getSlot(2) ?? null;
    player.inventory.setSlot(0, null);
    player.inventory.setSlot(1, null);
    player.inventory.setSlot(2, null);
    for (let slot = 0; slot < 36; slot += 1) {
      if (!player.inventory.getSlot(slot)) player.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    }
    const shifted = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'result', button: 'left', shift: true,
    });
    expect(shifted.committedCrafts).toEqual([
      expect.objectContaining({
        recipeId: 'ruby_ingot',
        completed: 2,
        producedItemId: ItemId.RubyIngot,
        producedCount: 2,
      }),
    ]);
    expect(shifted.committedCrafts?.[0]?.consumed).toEqual(expect.arrayContaining([
      { itemId: ItemId.Diamond, count: 2 },
      { itemId: ItemId.GoldIngot, count: 6 },
      { itemId: ItemId.IronIngot, count: 6 },
    ]));
    expect(player.inventory.count(ItemId.RubyIngot)).toBe(64);
    expect(player.craftSlots[0]?.count).toBe(3);
    expect(player.craftSlots[1]?.count).toBe(9);
    expect(player.craftSlots[2]?.count).toBe(9);
    expect(row(world, ItemId.RubyIngot)).toMatchObject({ current: 64, unexplained: 0 });
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 3, unexplained: 0 });
    expect(row(world, ItemId.GoldIngot)).toMatchObject({ current: 9, unexplained: 0 });
    expect(row(world, ItemId.IronIngot)).toMatchObject({ current: 9, unexplained: 0 });

    player.inventory.clear();
    player.cursor = null;
    player.craftSlots = Array.from({ length: 9 }, () => null);
    world.handleChat(player, '/give diamond 3');
    world.handleChat(player, '/give gold_ingot 9');
    world.handleChat(player, '/give iron_ingot 9');
    player.craftSlots[0] = player.inventory.getSlot(0) ?? null;
    player.craftSlots[1] = player.inventory.getSlot(1) ?? null;
    player.craftSlots[2] = player.inventory.getSlot(2) ?? null;
    player.inventory.setSlot(0, null);
    player.inventory.setSlot(1, null);
    player.inventory.setSlot(2, null);
    const three = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'result', button: 'left', shift: true,
    });
    expect(three.committedCrafts?.[0]).toMatchObject({ completed: 3, producedCount: 3 });
    expect(player.inventory.count(ItemId.RubyIngot)).toBe(3);
    expect(row(world, ItemId.RubyIngot)).toMatchObject({ current: 3, unexplained: 0 });
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 0, unexplained: 0 });

    player.cursor = createItemStack('cobblestone', 1);
    for (let slot = 0; slot < 36; slot += 1) player.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    player.craftSlots[0] = createItemStack(ItemId.Diamond, 1);
    player.craftSlots[1] = createItemStack(ItemId.GoldIngot, 3);
    player.craftSlots[2] = createItemStack(ItemId.IronIngot, 3);
    const blocked = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'result', button: 'left', shift: true,
    });
    expect(blocked.committedCrafts ?? []).toEqual([]);
    expect(player.craftSlots[0]?.count).toBe(1);

    player.inventory.clear();
    player.cursor = null;
    player.window = { kind: 'inventory' };
    player.craftSlots = [null, null, null, null];
    for (let slot = 0; slot < 36; slot += 1) player.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    player.inventory.setSlot(0, createItemStack('oak_planks', 63));
    player.craftSlots[0] = createItemStack('oak_log', 1);
    const partial = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'result', button: 'left', shift: true,
    });
    expect(partial.committedCrafts).toEqual([
      expect.objectContaining({ recipeId: 'oak_planks_from_log', completed: 1, producedItemId: 'oak_planks', producedCount: 4 }),
    ]);
    expect(player.cursor).toMatchObject({ itemId: 'oak_planks', count: 3 });
    expect(player.inventory.count('oak_planks')).toBe(64);

    player.inventory.clear();
    player.cursor = null;
    player.craftSlots = [null, null, null, null];
    world.handleChat(player, '/give charcoal 1');
    world.handleChat(player, '/give stick 1');
    const torch = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'craft_recipe', recipeId: 'torch',
    });
    expect(torch.committedCrafts?.[0]?.consumed).toEqual(expect.arrayContaining([
      { itemId: ItemId.Charcoal, count: 1 },
      { itemId: ItemId.Stick, count: 1 },
    ]));
    expect(torch.committedCrafts?.[0]?.consumed.some((row) => row.itemId === ItemId.Coal)).toBe(false);
    expect(player.inventory.count('torch')).toBe(4);
    expect(player.inventory.count(ItemId.Charcoal)).toBe(0);

    player.inventory.clear();
    player.window = { kind: 'crafting-table' };
    player.craftSlots = Array.from({ length: 9 }, () => null);
    world.handleChat(player, '/give diamond 18');
    player.inventory.setSlot(0, null);
    for (let index = 0; index < 9; index += 1) player.craftSlots[index] = createItemStack(ItemId.Diamond, 2);
    const blocks = world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'result', button: 'left', shift: true,
    });
    expect(blocks.committedCrafts?.[0]).toMatchObject({
      recipeId: 'diamond_block', completed: 2, producedItemId: 'diamond_block', producedCount: 2,
    });
    expect(blocks.committedCrafts?.[0]?.consumed).toEqual([{ itemId: ItemId.Diamond, count: 18 }]);
    expect(player.inventory.count('diamond_block')).toBe(2);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 0, unexplained: 0 });
    expect(row(world, ItemId.RubyIngot).unexplained).toBe(0);
  });

  it('credits a mining drop only after the item entity spawns', async () => {
    const { world } = await start('drop-cancel');
    const player = addPlayer(world, 'Ada');
    const x = Math.floor(player.controller.position.x);
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z) + 1;
    player.selectedSlot = 0;
    player.inventory.setSlot(0, createItemStack(ItemId.IronPickaxe));
    let cancelDiamond = true;
    world.events.on('itemDrop', (event) => {
      if (cancelDiamond && event.itemId === ItemId.Diamond) event.cancelled = true;
    });
    world.world.setBlock(x, y, z, BlockId.DiamondOre);
    player.miningTarget = { x, y, z };
    player.miningProgress = 1;
    expect(world.gameplay.breakBlock(player, x, y, z).ok).toBe(true);
    expect(world.gameplay.drops.entities.some((entity) => entity.stack.itemId === ItemId.Diamond)).toBe(false);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 0, unexplained: 0 });
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'mine')).toEqual([]);

    const cancelBreak = world.events.on('blockBreak', (event) => { event.cancelled = true; });
    world.world.setBlock(x, y, z, BlockId.DiamondOre);
    player.miningTarget = { x, y, z };
    player.miningProgress = 1;
    expect(world.gameplay.breakBlock(player, x, y, z).ok).toBe(false);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.DiamondOre);
    expect(row(world, ItemId.Diamond).current).toBe(0);
    cancelBreak();

    (world.gameplay as { random: () => number }).random = () => 0;
    const seen: string[] = [];
    world.events.on('itemDrop', (event) => {
      seen.push(event.itemId);
      if (event.itemId === 'oak_sapling') event.cancelled = true;
    });
    world.world.setBlock(x, y + 1, z, BlockId.OakLeaves);
    player.miningTarget = { x, y: y + 1, z };
    player.miningProgress = 1;
    expect(world.gameplay.breakBlock(player, x, y + 1, z).ok).toBe(true);
    expect(seen).toEqual(expect.arrayContaining(['oak_leaves', 'oak_sapling']));
    expect(world.gameplay.drops.entities.map((entity) => entity.stack.itemId)).toEqual(['oak_leaves']);
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'mine')).toEqual([]);

    cancelDiamond = false;
    world.world.setBlock(x, y, z, BlockId.DiamondOre);
    player.miningTarget = { x, y, z };
    player.miningProgress = 1;
    expect(world.gameplay.breakBlock(player, x, y, z).ok).toBe(true);
    const dropped = world.gameplay.drops.entities.reduce((sum, entity) => (
      entity.stack.itemId === ItemId.Diamond ? sum + entity.stack.count : sum
    ), 0);
    expect(dropped).toBe(1);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 1, unexplained: 0 });
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'mine')).toEqual([
      expect.objectContaining({ itemId: ItemId.Diamond, quantity: 1 }),
    ]);
  });

  it('attributes give, plugin give, and Creative without resource uuids', async () => {
    const { world } = await start('grant');
    const player = addPlayer(world, 'Ada');
    const balance = money(world).getBalance(player.id);
    world.handleChat(player, '/give diamond 64');
    expect(player.inventory.count(ItemId.Diamond)).toBe(64);
    expect(player.inventory.getSlot(0)?.metadata?.itemInstanceId).toBeUndefined();
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 64, expected: 64, unexplained: 0 });

    world.plugins.register({
      name: 'grant-diamonds',
      onEnable(api) {
        api.getPlayer('Ada')?.give(ItemId.Diamond, 4);
      },
    } satisfies Plugin);
    await world.plugins.enableAll();
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 68, expected: 68, unexplained: 0 });
    world.inspectValuableResources();
    expect(row(world, ItemId.Diamond).expected).toBe(68);

    player.gamemode = 'creative';
    const index = creativeCatalogItems().findIndex((item) => item.id === ItemId.Diamond);
    world.gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: `creative-${index}`, button: 'left',
    });
    expect(player.cursor).toMatchObject({ itemId: ItemId.Diamond, count: 64 });
    expect(player.cursor?.metadata?.itemInstanceId).toBeUndefined();
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 132, unexplained: 0 });
    expect(money(world).getBalance(player.id)).toBe(balance);
  });

  it('keeps slot, chest, drop, trade, and auction totals unchanged', async () => {
    const { world } = await start('moves');
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    world.handleChat(ada, '/give diamond 64');
    ada.inventory.setSlot(2, ada.inventory.getSlot(0));
    ada.inventory.setSlot(0, null);
    ada.cursor = ada.inventory.getSlot(2);
    ada.inventory.setSlot(2, null);
    ada.inventory.setSlot(0, ada.cursor);
    ada.cursor = null;
    const x = Math.floor(ada.controller.position.x) + 1;
    const y = Math.floor(ada.controller.position.y);
    const z = Math.floor(ada.controller.position.z);
    world.world.setBlock(x, y, z, BlockId.Chest);
    world.world.chests.set(`${x},${y},${z}`, { slots: [ada.inventory.getSlot(0) ?? null] });
    ada.inventory.setSlot(0, null);
    expect(row(world, ItemId.Diamond).current).toBe(64);
    ada.portalChest.slots[0] = world.world.chests.get(`${x},${y},${z}`)!.slots[0] ?? null;
    world.world.chests.get(`${x},${y},${z}`)!.slots[0] = null;
    expect(row(world, ItemId.Diamond).current).toBe(64);
    expect(row(world, ItemId.Diamond).unexplained).toBe(0);

    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    ada.inventory.setSlot(0, ada.portalChest.slots[0] ?? null);
    ada.portalChest.slots[0] = null;
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    expect(world.trade.ready(ada.id).ok).toBe(true);
    expect(world.trade.ready(bob.id).ok).toBe(true);
    expect(world.trade.accept(ada.id).ok).toBe(true);
    expect(world.trade.accept(bob.id).ok).toBe(true);
    expect(bob.inventory.count(ItemId.Diamond)).toBe(64);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 64, unexplained: 0 });

    money(world).setBalance(ada.id, 1_000, 'ADMIN_SET');
    const listed = syncAuction(world.auction.createListing(bob.id, bob.name, bob.inventory, 0, 64, AUCTION_MIN_PRICE));
    expect(listed.ok).toBe(true);
    expect(row(world, ItemId.Diamond).current).toBe(64);
    expect(world.auction.buyListing(ada.id, ada.name, ada.inventory, listed.listing!.listingId).ok).toBe(true);
    expect(ada.inventory.count(ItemId.Diamond)).toBe(64);
    expect(world.auction.getListing(listed.listing!.listingId)?.status).toBe('SOLD');
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 64, unexplained: 0 });
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'mine')).toHaveLength(0);
  });

  it('treats drops, death, buyer sales, and held returns as supply changes without minting', async () => {
    const { world } = await start('sinks');
    const ada = addPlayer(world, 'Ada');
    const balance = money(world).getBalance(ada.id);
    world.handleChat(ada, '/give diamond 16');
    world.gameplay.dropFromPlayer(ada, ada.inventory.getSlot(0)!);
    ada.inventory.setSlot(0, null);
    expect(ada.inventory.count(ItemId.Diamond)).toBe(0);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 16, unexplained: 0 });
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'mine')).toHaveLength(0);
    const drop = world.gameplay.drops.entities.at(-1)!;
    drop.pickupDelaySeconds = 0;
    drop.position.copy(ada.controller.position);
    world.gameplay.collectFor(ada);
    expect(ada.inventory.count(ItemId.Diamond)).toBe(16);
    expect(ada.inventory.getSlot(0)?.metadata?.itemInstanceId).toBeUndefined();
    world.gameplay.dropAllPlayerResources(ada);
    expect(ada.inventory.count(ItemId.Diamond)).toBe(0);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 16, unexplained: 0 });
    for (const entity of world.gameplay.drops.entities) {
      entity.pickupDelaySeconds = 0;
      entity.position.copy(ada.controller.position);
    }
    world.gameplay.collectFor(ada);
    expect(ada.inventory.count(ItemId.Diamond)).toBe(16);

    const held = ada.inventory.getSlot(0)!;
    ada.inventory.setSlot(0, null);
    for (let slot = 0; slot < 36; slot += 1) ada.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    ada.heldReturns = [held];
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 16, unexplained: 0 });

    ada.inventory.setSlot(0, null);
    world.handleChat(ada, '/give diamond 4');
    expect(ada.inventory.count(ItemId.Diamond)).toBe(4);
    const grants = world.inspectValuableResources().recentSources.filter((source) => source.kind === 'server-grant').length;
    const created = world.buyer.create({
      name: 'Ювелир', worldId: world.worldId, x: 2, y: 64, z: 2, yaw: 0, pitch: 0,
    });
    expect(created.ok).toBe(true);
    expect(world.buyer.configure(created.buyer!.id, { itemId: ItemId.Diamond, pricePerItem: AUCTION_MIN_PRICE }).ok).toBe(true);
    expect(world.buyer.openTrade(ada.id, created.buyer!.id, ada.inventory).ok).toBe(true);
    expect(world.buyer.handleAction(ada.id, ada.inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 0,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    world.handleBuyerAction(ada, { type: 'buyer_action', action: 'sell' });
    expect(ada.inventory.count(ItemId.Diamond)).toBe(0);
    expect(ada.heldReturns.reduce((sum, stack) => sum + stack.count, 0)).toBe(16);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 16, expected: 16, unexplained: 0 });
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'server-grant')).toHaveLength(grants);
    expect(world.inspectValuableResources().recentSources.some((source) => source.kind === 'sink' && source.quantity === 4)).toBe(true);
    expect(money(world).getBalance(ada.id)).toBeGreaterThan(balance);
    expect(ada.heldReturns[0]?.metadata?.itemInstanceId).toBeUndefined();
  });

  it('baselines an existing stack and counts a distant chest without generating it', async () => {
    const worldId = 'baseline';
    const first = await start(worldId);
    const ada = addPlayer(first.world, 'Ada');
    ada.inventory.setSlot(0, createItemStack(ItemId.Diamond, 10));
    await first.world.save();
    const { rmSync } = await import('node:fs');
    rmSync(first.world.pluginStore.pathFor('resource-accounting'), { force: true });
    const token = ada.sessionToken;
    await first.world.stop();
    worlds.pop();
    const reopened = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: worldId, MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1', FC_ADMIN_IDS: '',
      }),
      dataDir: first.dataDir, port: 0, chunkViewRadius: 1, loadBuiltinPlugins: false,
      pluginDir: join(first.dataDir, 'plugins'),
    });
    worlds.push(reopened);
    await reopened.initialize();
    const returned = addPlayer(reopened, 'Ada', token, false);
    expect(returned.inventory.count(ItemId.Diamond)).toBe(10);
    expect(row(reopened, ItemId.Diamond)).toMatchObject({ baseline: 10, current: 10, unexplained: 0, status: 'balanced' });

    reopened.handleChat(returned, '/give diamond 5');
    expect(row(reopened, ItemId.Diamond)).toMatchObject({ current: 15, unexplained: 0 });
    reopened.world.setBlock(FAR.x, FAR.y, FAR.z, BlockId.Chest);
    reopened.world.chests.set(`${FAR.x},${FAR.y},${FAR.z}`, { slots: [createItemStack(ItemId.Diamond, 7)] });
    returned.inventory.setSlot(1, null);
    await reopened.save();
    await reopened.stop();
    worlds.pop();
    const far = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: worldId, MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1', FC_ADMIN_IDS: '',
      }),
      dataDir: first.dataDir, port: 0, chunkViewRadius: 1, loadBuiltinPlugins: false,
      pluginDir: join(first.dataDir, 'plugins'),
    });
    worlds.push(far);
    await far.initialize();
    const farKey = chunkKey(floorDiv(FAR.x, CHUNK_SIZE), floorDiv(FAR.z, CHUNK_SIZE));
    expect(far.world.chunks.has(farKey)).toBe(false);
    const withChest = row(far, ItemId.Diamond).current;
    expect(withChest).toBe(22);
    expect(far.world.chunks.has(farKey)).toBe(false);
    far.world.setBlock(FAR.x, FAR.y, FAR.z, BlockId.Stone);
    far.world.chunks.delete(farKey);
    expect(row(far, ItemId.Diamond).current).toBe(15);
    far.world.chests.set(`${UNKNOWN.x},${UNKNOWN.y},${UNKNOWN.z}`, { slots: [createItemStack(ItemId.Diamond, 9)] });
    const holder = addPlayer(far, 'Ada', token, false);
    holder.inventory.setSlot(3, createItemStack(ItemId.Diamond, 3));
    const unknownKey = chunkKey(floorDiv(UNKNOWN.x, CHUNK_SIZE), floorDiv(UNKNOWN.z, CHUNK_SIZE));
    const incomplete = far.inspectValuableResources();
    expect(far.world.chunks.has(unknownKey)).toBe(false);
    expect(incomplete.holderCoverage).toBe('incomplete');
    expect(incomplete.unresolvedSources).toBeGreaterThan(0);
    expect(incomplete.resources.find((resource) => resource.itemId === ItemId.Diamond)?.status).toBe('incomplete-coverage');
    expect(incomplete.resources.find((resource) => resource.itemId === ItemId.Diamond)?.unexplained).toBe(3);
    expect(holder.inventory.count(ItemId.Diamond)).toBe(18);
    expect(incomplete.knownGaps).toContain('explosion-ore-drops');
  });

  it('flags an injected stack and retries a failed accounting write', async () => {
    const { world } = await start('anomaly');
    const ada = addPlayer(world, 'Ada');
    ada.inventory.setSlot(0, createItemStack(ItemId.Diamond, 64));
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 64, unexplained: 64, status: 'unexplained-increase' });
    expect(ada.inventory.count(ItemId.Diamond)).toBe(64);
    world.inspectValuableResources();
    expect(world.inspectValuableResources().anomalies.filter((anomaly) => anomaly.itemId === ItemId.Diamond)).toHaveLength(1);

    ada.inventory.setSlot(0, null);
    world.handleChat(ada, '/give diamond 64');
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 64, unexplained: 0, status: 'explained-change' });

    ada.inventory.setSlot(4, createItemStack(ItemId.Diamond, 1));
    const store = world.pluginStore;
    const original = store.save.bind(store);
    const { rmSync } = await import('node:fs');
    rmSync(store.pathFor('resource-accounting'), { force: true });
    let fail = true;
    store.save = (name, value) => {
      if (fail && name === 'resource-accounting') throw new Error('resource disk full');
      original(name, value);
    };
    expect(() => world.inspectValuableResources()).not.toThrow();
    await expect(readFile(store.pathFor('resource-accounting'), 'utf8')).rejects.toThrow();
    expect(ada.inventory.count(ItemId.Diamond)).toBe(65);
    fail = false;
    world.inspectValuableResources();
    const saved = JSON.parse(await readFile(store.pathFor('resource-accounting'), 'utf8')) as { minted: { diamond: number } };
    expect(saved.minted.diamond).toBe(64);
    let writes = 0;
    store.save = (name, value) => {
      if (name === 'resource-accounting') writes += 1;
      original(name, value);
    };
    world.inspectValuableResources();
    expect(writes).toBe(0);
    expect(ada.inventory.getSlot(4)?.count).toBe(1);
    const before = (await readFile(store.pathFor('resource-accounting'), 'utf8')).length;
    await world.save();
    await world.save();
    await world.save();
    expect((await readFile(store.pathFor('resource-accounting'), 'utf8')).length).toBe(before);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 65, unexplained: 1 });
  });

  it('counts an offline player once and keeps a grant across restart', async () => {
    const worldId = 'offline';
    const first = await start(worldId);
    const ada = addPlayer(first.world, 'Ada');
    first.world.handleChat(ada, '/give diamond 8');
    expect(row(first.world, ItemId.Diamond)).toMatchObject({ current: 8, unexplained: 0 });
    const token = ada.sessionToken;
    first.world.disconnect(ada.id);
    expect(row(first.world, ItemId.Diamond).current).toBe(8);
    const held = first.world.players.get(ada.id)!;
    held.disconnectedAt = Date.now() - 5 * 60_000 - 1;
    first.world.tick();
    expect(first.world.players.has(ada.id)).toBe(false);
    expect(row(first.world, ItemId.Diamond)).toMatchObject({ current: 8, unexplained: 0 });
    await first.world.save();
    await first.world.stop();
    worlds.pop();
    const reopened = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: worldId, MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1', FC_ADMIN_IDS: '',
      }),
      dataDir: first.dataDir, port: 0, chunkViewRadius: 1, loadBuiltinPlugins: false,
      pluginDir: join(first.dataDir, 'plugins'),
    });
    worlds.push(reopened);
    await reopened.initialize();
    expect(row(reopened, ItemId.Diamond)).toMatchObject({ current: 8, expected: 8, unexplained: 0 });
    const saved = JSON.parse(await readFile(reopened.pluginStore.pathFor('resource-accounting'), 'utf8')) as {
      minted: { diamond: number };
    };
    expect(saved.minted.diamond).toBe(8);
    const returned = addPlayer(reopened, 'Ada', token, false);
    expect(returned.inventory.count(ItemId.Diamond)).toBe(8);
    expect(row(reopened, ItemId.Diamond).current).toBe(8);
  });

  it('credits boss loot and an event chest, then removes the chest without a second mint', async () => {
    const { world } = await start('rewards', ANARCHY_WORLD_SEED);
    const ada = addPlayer(world, 'Ada');
    world.gameplay.scatterBossLoot([createItemStack(ItemId.Diamond, 7), createItemStack(ItemId.GoldIngot, 9)], ada.controller.position);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 7, unexplained: 0 });
    expect(row(world, ItemId.GoldIngot)).toMatchObject({ current: 9, unexplained: 0 });
    const rewards = world.inspectValuableResources().recentSources.filter((source) => source.kind === 'reward').length;
    world.inspectValuableResources();
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'reward')).toHaveLength(rewards);

    world.worldEvents.load();
    const x = 24;
    const z = 24;
    const y = world.world.surfaceY(x, z) + 1;
    const spawned = world.worldEvents.forceSpawn({ at: { x, y, z }, yaw: 0 });
    expect(spawned.ok).toBe(true);
    if (!spawned.ok || !('event' in spawned)) return;
    const chestDiamonds = world.world.getChest(x, y, z).slots.reduce((sum, stack) => (
      stack?.itemId === ItemId.Diamond ? sum + stack.count : sum
    ), 0);
    expect(chestDiamonds).toBeGreaterThan(0);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 7 + chestDiamonds, unexplained: 0 });
    const credited = world.inspectValuableResources().recentSources.filter((source) => source.kind === 'reward' && source.itemId === ItemId.Diamond).length;
    world.worldEvents.forceSpawn({ at: { x, y, z }, yaw: 0 });
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'reward' && source.itemId === ItemId.Diamond)).toHaveLength(credited);
    expect(world.worldEvents.forceCleanup().ok).toBe(true);
    expect(world.world.getBlock(x, y, z)).not.toBe(BlockId.EventChest);
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 7, unexplained: 0 });
    expect(ada.inventory.count(ItemId.Diamond)).toBe(0);
  });

  it('returns auction diamonds after a failed escrow save without minting them again', async () => {
    const { world } = await start('recover');
    const ada = addPlayer(world, 'Ada');
    const balance = money(world).getBalance(ada.id);
    world.handleChat(ada, '/give diamond 64');
    const durability = (world as unknown as { itemDurability(): ItemDurability }).itemDurability();
    world.auction.setStage2C({ durability });
    const store = (world as unknown as { worldStore: { savePlayers: (worldId: string, players: unknown) => Promise<void> } }).worldStore;
    let rejectSave: (error: Error) => void = () => {};
    let startedSave = false;
    store.savePlayers = () => new Promise<void>((_resolve, reject) => {
      startedSave = true;
      rejectSave = reject;
    });
    const pending = world.auction.createListing(ada.id, ada.name, ada.inventory, 0, 64, AUCTION_MIN_PRICE);
    for (let attempt = 0; attempt < 20 && !startedSave; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(startedSave).toBe(true);
    ada.inventory.setSlot(0, createItemStack('cobblestone', 64));
    for (let slot = 1; slot < 36; slot += 1) ada.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    rejectSave(new Error('disk full'));
    await expect(pending).rejects.toThrow('disk full');
    expect(ada.heldReturns).toEqual([expect.objectContaining({ itemId: ItemId.Diamond, count: 64 })]);
    expect(ada.heldReturns[0]?.metadata?.itemInstanceId).toBeUndefined();
    expect(row(world, ItemId.Diamond)).toMatchObject({ current: 64, unexplained: 0 });
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'server-grant')).toHaveLength(1);
    expect(money(world).getBalance(ada.id)).toBe(balance);
    expect(world.auction.queryBrowse().totalCount).toBe(0);
  });

  it('keeps saved evidence inside the retention caps', async () => {
    const { world, dataDir } = await start('bound');
    const path = world.pluginStore.pathFor('resource-accounting');
    await world.stop();
    worlds.pop();
    const anomalies = Array.from({ length: 250 }, (_, index) => ({
      id: `resource:bound:extra-${index}`,
      worldId: 'bound',
      itemId: ItemId.Diamond,
      observed: 1,
      expected: 0,
      unexplained: 1,
      status: 'unexplained-increase',
      firstSeenAt: 1,
      lastSeenAt: 1,
      seenCount: 1,
    }));
    const recent = Array.from({ length: 150 }, (_, index) => ({
      kind: 'server-grant', itemId: ItemId.Diamond, quantity: 1, at: index,
    }));
    await writeFile(path, JSON.stringify({
      version: 1,
      baseline: { diamond: 0, gold_ingot: 0, ruby_ingot: 0, titanium_ingot: 0, iron_ingot: 0 },
      baselineAt: 1,
      minted: { diamond: 0, gold_ingot: 0, ruby_ingot: 0, titanium_ingot: 0, iron_ingot: 0 },
      transformedIn: { diamond: 0, gold_ingot: 0, ruby_ingot: 0, titanium_ingot: 0, iron_ingot: 0 },
      transformedOut: { diamond: 0, gold_ingot: 0, ruby_ingot: 0, titanium_ingot: 0, iron_ingot: 0 },
      sunk: { diamond: 0, gold_ingot: 0, ruby_ingot: 0, titanium_ingot: 0, iron_ingot: 0 },
      sourceKeys: Array.from({ length: 600 }, (_, index) => `old-${index}`),
      recent,
      anomalies,
    }));
    const reopened = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: 'bound', MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1', FC_ADMIN_IDS: '',
      }),
      dataDir, port: 0, chunkViewRadius: 1, loadBuiltinPlugins: false,
      pluginDir: join(dataDir, 'plugins'),
    });
    worlds.push(reopened);
    await reopened.initialize();
    const report = reopened.inspectValuableResources();
    expect(report.anomalies.length).toBeLessThanOrEqual(200);
    expect(report.anomalies.length).toBe(200);
    expect(report.recentSources.length).toBeLessThanOrEqual(100);
    const saved = JSON.parse(await readFile(reopened.pluginStore.pathFor('resource-accounting'), 'utf8')) as {
      sourceKeys: string[];
      recent: unknown[];
      anomalies: unknown[];
    };
    expect(saved.sourceKeys.length).toBeLessThanOrEqual(500);
    expect(saved.recent.length).toBeLessThanOrEqual(100);
    expect(saved.anomalies.length).toBeLessThanOrEqual(200);
  });
});

