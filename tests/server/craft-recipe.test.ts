import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseClientMessage } from '../../shared/protocol';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { createItemStack, Inventory } from '../../src/inventory';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-craft-'));
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

describe('craft_recipe protocol and authority', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('accepts recipeId-only craft_recipe and drops forged extra fields', () => {
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
      count: 64,
      slot: 3,
      inventory: { slots: [] },
      result: { itemId: 'diamond', count: 64 },
    })).toEqual({
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
    });
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'craft_recipe',
    })).toEqual({ error: 'inventory_action.recipeId invalid' });
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'recipe',
      recipeId: 'crafting_table',
    })).toMatchObject({ type: 'inventory_action', action: 'recipe', recipeId: 'crafting_table' });
  });

  it('crafts one recipe on the server and updates availability after each craft', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Crafter' });
    if ('error' in joined) throw new Error(joined.error);
    joined.player.inventory.clear();
    joined.player.inventory.addItem('oak_log', 2);
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
    });
    expect(joined.player.inventory.count('oak_planks')).toBe(4);
    expect(joined.player.inventory.count('oak_log')).toBe(1);
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
    });
    expect(joined.player.inventory.count('oak_planks')).toBe(8);
    expect(joined.player.inventory.count('oak_log')).toBe(0);
    const before = joined.player.inventory.serialize();
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
    });
    expect(joined.player.inventory.serialize()).toEqual(before);
  });

  it('does not consume ingredients when the result cannot fully fit', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Full' });
    if ('error' in joined) throw new Error(joined.error);
    joined.player.inventory.clear();
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      joined.player.inventory.setSlot(slot, createItemStack('dirt', 64));
    }
    joined.player.inventory.setSlot({ section: 'offhand' }, createItemStack('oak_log', 1));
    const before = joined.player.inventory.serialize();
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
    });
    expect(joined.player.inventory.serialize()).toEqual(before);
  });
});
