import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { applyFurnaceSync } from '../../src/net/onlineContainerSync';
import { furnaceBurnRatio, furnaceCookRatio } from '../../src/crafting';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { VoxelWorld } from '../../src/world/World';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import type { ServerFurnaceSyncMessage, ServerInventoryMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-furnace-sync-'));
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
  };
}

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function isFurnaceSync(payload: unknown): payload is ServerFurnaceSyncMessage {
  return Boolean(payload && typeof payload === 'object' && (payload as { type?: string }).type === 'furnace_sync');
}

function isInventory(payload: unknown): payload is ServerInventoryMessage {
  return Boolean(payload && typeof payload === 'object' && (payload as { type?: string }).type === 'inventory');
}

describe('authoritative furnace GUI sync', () => {
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
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function openFurnace(world: WorldInstance, player: ServerPlayer, x: number, y: number, z: number): void {
    world.applyInventoryAction(player, {
      type: 'inventory_action',
      action: 'open',
      kind: 'furnace',
      x, y, z,
    });
  }

  it('pushes burn, cook and slot changes to every open furnace viewer', async () => {
    const world = await boot();
    const a = join(world, 'FurnaceA');
    const b = join(world, 'FurnaceB');
    const x = 4;
    const y = 40;
    const z = 4;
    world.world.setBlock(x, y, z, BlockId.Furnace);
    const furnace = world.world.getFurnace(x, y, z);
    furnace.slots[0] = createItemStack('cobblestone', 4);
    furnace.slots[1] = createItemStack(ItemId.LavaBucket);
    openFurnace(world, a.player, x, y, z);
    openFurnace(world, b.player, x, y, z);
    const openA = a.sink.payloads.filter(isInventory).at(-1);
    expect(openA?.window).toMatchObject({ kind: 'furnace', burnTime: 0, cookTime: 0 });

    a.sink.payloads.length = 0;
    b.sink.payloads.length = 0;
    world.tick();
    const syncA = a.sink.payloads.filter(isFurnaceSync);
    const syncB = b.sink.payloads.filter(isFurnaceSync);
    expect(syncA).toHaveLength(1);
    expect(syncB).toHaveLength(1);
    expect(syncA[0]).toMatchObject({
      x, y, z,
      burnTotal: 16_000,
      burnTime: 15_999,
      cookTime: 1,
    });
    expect(syncA[0]?.slots[1]).toMatchObject({ itemId: ItemId.Bucket, count: 1 });
    expect(syncB[0]?.cookTime).toBe(1);

    const client = new VoxelWorld('viewer');
    const viewed = client.getFurnace(x, y, z);
    expect(applyFurnaceSync(client, syncA[0]!)).toBe(true);
    expect(viewed.slots[1]?.itemId).toBe(ItemId.Bucket);
    expect(furnaceCookRatio(viewed)).toBeCloseTo(1 / 200);
    expect(furnaceBurnRatio(viewed)).toBeCloseTo(15_999 / 16_000);

    const cookBeforeClose = furnace.cookTime;
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'close' });
    world.applyInventoryAction(b.player, { type: 'inventory_action', action: 'close' });
    a.sink.payloads.length = 0;
    world.tick();
    expect(furnace.cookTime).toBe(cookBeforeClose + 1);
    expect(a.sink.payloads.filter(isFurnaceSync)).toHaveLength(0);
    expect(furnace.slots[1]?.itemId).toBe(ItemId.Bucket);

    openFurnace(world, a.player, x, y, z);
    const reopened = a.sink.payloads.filter(isInventory).at(-1);
    expect(reopened?.window?.cookTime).toBe(furnace.cookTime);
    expect(reopened?.window?.burnTotal).toBe(16_000);
    expect(furnace.cookTime).toBeGreaterThan(0);
  });

  it('does not send furnace progress to a chest viewer', async () => {
    const world = await boot();
    const player = join(world, 'ChestOnly');
    world.world.setBlock(2, 40, 2, BlockId.Furnace);
    world.world.setBlock(3, 40, 2, BlockId.Chest);
    const furnace = world.world.getFurnace(2, 40, 2);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack(ItemId.Coal);
    world.applyInventoryAction(player.player, {
      type: 'inventory_action',
      action: 'open',
      kind: 'chest',
      x: 3, y: 40, z: 2,
    });
    player.sink.payloads.length = 0;
    world.tick();
    expect(player.sink.payloads.filter(isFurnaceSync)).toHaveLength(0);
    expect(furnace.cookTime).toBe(1);
  });

  it('crafts fire arrows and a golden apple only from the canonical recipe id', async () => {
    const world = await boot();
    const joined = join(world, 'Crafter');
    joined.player.inventory.clear();
    joined.player.inventory.addItem(ItemId.Arrow, 8);
    joined.player.inventory.addItem(ItemId.LavaBucket, 1);
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'fire_arrow',
      count: 64,
    });
    expect(joined.player.inventory.count(ItemId.FireArrow)).toBe(8);
    expect(joined.player.inventory.count(ItemId.Bucket)).toBe(1);
    expect(joined.player.inventory.count(ItemId.LavaBucket)).toBe(0);
    expect(joined.player.inventory.count(ItemId.Arrow)).toBe(0);

    joined.player.inventory.addItem(ItemId.GoldIngot, 8);
    joined.player.inventory.addItem(ItemId.Apple, 1);
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'golden_apple',
      count: 9,
    });
    expect(joined.player.inventory.count(ItemId.GoldenApple)).toBe(1);
    expect(joined.player.inventory.count(ItemId.GoldIngot)).toBe(0);
    expect(joined.player.inventory.count(ItemId.Apple)).toBe(0);
  });
});
