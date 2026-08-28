import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { MENU_SERVER_ENTRIES } from '../src/ui/menuModel';
import { SaveService } from '../src/save/SaveService';
import type { SerializedWorldState } from '../src/save/types';
import { VoxelWorld } from '../src/world/World';
import {
  ANARCHY_SERVER_ID,
  ANARCHY_WORLD_ID,
  ANARCHY_WORLD_SEED,
  anarchyAlreadyImported,
  createAnarchySummary,
  encodeSpongeSchematicGzip,
  importAnarchySpawn,
  isAnarchyServerId,
  isAnarchyWorldId,
  isServerWorldSummary,
  schematicIndex,
} from '../src/world/import';

function emptyWorldSave(id: string, name: string, kind?: 'singleplayer' | 'server'): SerializedWorldState {
  return {
    schemaVersion: 1,
    summary: {
      id,
      name,
      seed: 'sp-seed',
      mode: 'survival',
      createdAt: 1,
      updatedAt: 1,
      playTimeSeconds: 0,
      ...(kind ? { kind } : {}),
    },
    timeOfDay: 0,
    weather: 'clear',
    player: {
      position: [0.5, 70, 0.5],
      velocity: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      health: 20,
      hunger: 20,
      saturation: 5,
      selectedSlot: 0,
      inventory: { slots: [], offhand: null },
    },
    modifications: {},
    chests: {},
    furnaces: {},
    droppedItems: [],
  };
}

async function fixtureBytes() {
  const width = 3;
  const height = 2;
  const length = 3;
  const palette = ['minecraft:air', 'minecraft:stone', 'minecraft:glowstone'];
  const blocks = new Uint16Array(width * height * length);
  blocks[schematicIndex(1, 0, 1, width, length)] = 1;
  blocks[schematicIndex(1, 1, 1, width, length)] = 2;
  return encodeSpongeSchematicGzip({ width, height, length, palette, blocks });
}

describe('anarchy local server world', () => {
  it('lists Anarchy as a connectable server entry and Survival PvP as a mock', () => {
    expect(MENU_SERVER_ENTRIES.map((server) => server.id)).toEqual(['anarchy-pvp', 'survival-pvp']);
    expect(isAnarchyServerId(ANARCHY_SERVER_ID)).toBe(true);
    expect(MENU_SERVER_ENTRIES.find((server) => server.id === 'anarchy-pvp')?.connectable).toBe(true);
    expect(MENU_SERVER_ENTRIES.find((server) => server.id === 'survival-pvp')?.connectable).toBe(false);
  });

  it('resolves a dedicated anarchy world identity', () => {
    const summary = createAnarchySummary();
    expect(isAnarchyWorldId(summary.id)).toBe(true);
    expect(summary.id).toBe(ANARCHY_WORLD_ID);
    expect(summary.seed).toBe(ANARCHY_WORLD_SEED);
    expect(summary.kind).toBe('server');
    expect(isServerWorldSummary(summary)).toBe(true);
    expect(isServerWorldSummary({ id: 'uuid-here', kind: 'singleplayer' })).toBe(false);
  });

  it('imports spawn once and keeps player edits on the second load', async () => {
    const world = new VoxelWorld(ANARCHY_WORLD_SEED);
    const imported = await importAnarchySpawn(world, await fixtureBytes());
    expect(imported.serverWorld.spawnImported).toBe(true);
    expect(anarchyAlreadyImported({ serverWorld: imported.serverWorld })).toBe(true);
    expect(imported.spawn[1]).toBeGreaterThan(1);
    const glowY = imported.report.lowestImportedY + 1;
    expect(world.getBlock(1, imported.report.lowestImportedY, 1)).toBe(BlockId.Stone);
    expect(world.getBlock(1, glowY, 1)).toBe(BlockId.Glowstone);
    expect(world.setBlock(1, imported.report.lowestImportedY, 1, BlockId.Dirt)).toBe(true);

    const snapshot: SerializedWorldState = {
      schemaVersion: 1,
      summary: createAnarchySummary(),
      timeOfDay: 0,
      weather: 'clear',
      player: {
        position: imported.spawn,
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        health: 20,
        hunger: 20,
        saturation: 5,
        selectedSlot: 0,
        spawnPoint: imported.spawn,
        inventory: { slots: [], offhand: null },
      },
      modifications: world.serializeModifications(),
      chests: {},
      furnaces: {},
      droppedItems: [],
      blockStates: world.serializeBlockStates(),
      serverWorld: imported.serverWorld,
    };

    expect(anarchyAlreadyImported(snapshot)).toBe(true);
    const restored = new VoxelWorld(ANARCHY_WORLD_SEED);
    restored.restore(snapshot);
    expect(restored.getBlock(1, imported.report.lowestImportedY, 1)).toBe(BlockId.Dirt);
    expect(restored.getBlock(1, glowY, 1)).toBe(BlockId.Glowstone);
  });

  it('hides the Anarchy world from the singleplayer list', async () => {
    const saves = new SaveService();
    await saves.saveWorld(emptyWorldSave('sp-1', 'Одиночный'));
    await saves.saveWorld({
      ...emptyWorldSave(ANARCHY_WORLD_ID, 'Анархия', 'server'),
      summary: createAnarchySummary(),
    });
    const list = await saves.listWorlds();
    expect(list.some((world) => world.id === ANARCHY_WORLD_ID)).toBe(false);
    expect(list.some((world) => world.id === 'sp-1')).toBe(true);
  });
});
