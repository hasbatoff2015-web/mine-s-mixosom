import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { MENU_SERVER_ENTRIES } from '../src/ui/menuModel';
import { SaveService } from '../src/save/SaveService';
import type { SerializedWorldState } from '../src/save/types';
import { VoxelWorld } from '../src/world/World';
import {
  ANARCHY_SERVER_ID,
  ANARCHY_WORLD_ID,
  ANARCHY_WORLD_SEED,
  createAnarchySummary,
  createCanonicalAnarchyServerWorld,
  encodeSpongeSchematicGzip,
  hasPersistedAnarchyWorld,
  importAnarchySpawn,
  isAnarchyServerId,
  isAnarchyWorldId,
  isServerWorldSummary,
  resolveAnarchyStartup,
  resolveCanonicalAnarchySpawn,
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

function persistedAnarchy(overrides?: Partial<SerializedWorldState>): SerializedWorldState {
  const summary = createAnarchySummary();
  const spawn: [number, number, number] = [12.5, 41.01, 8.5];
  return {
    schemaVersion: 1,
    summary,
    timeOfDay: 0,
    weather: 'clear',
    player: {
      position: [13.5, 44.01, 9.5],
      velocity: [0, 0, 0],
      yaw: 1.2,
      pitch: 0.1,
      health: 20,
      hunger: 20,
      saturation: 5,
      selectedSlot: 0,
      spawnPoint: spawn,
      inventory: { slots: [], offhand: null },
    },
    modifications: { '0,0': { '20': BlockId.Dirt } },
    chests: {},
    furnaces: {},
    droppedItems: [],
    serverWorld: createCanonicalAnarchyServerWorld(spawn, {
      id: ANARCHY_WORLD_ID,
      initialized: true,
      spawnImported: true,
      importVersion: 1,
      spawn,
    }),
    ...overrides,
  };
}

async function fixtureBytes() {
  const width = 3;
  const height = 2;
  const length = 3;
  const palette = ['minecraft:air', 'minecraft:stone', 'minecraft:glowstone', 'minecraft:jungle_wood', 'minecraft:cocoa[age=2,facing=north]'];
  const blocks = new Uint16Array(width * height * length);
  blocks[schematicIndex(1, 0, 1, width, length)] = 1;
  blocks[schematicIndex(1, 1, 1, width, length)] = 2;
  blocks[schematicIndex(0, 0, 1, width, length)] = 3;
  blocks[schematicIndex(2, 0, 1, width, length)] = 4;
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

  it('restores any persisted Anarchy world without schematic import or version rebuild', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const stale = persistedAnarchy();
    expect(stale.serverWorld?.importVersion).toBe(1);
    const startup = resolveAnarchyStartup(stale);
    expect(startup.action).toBe('restore');
    if (startup.action !== 'restore') return;
    expect(startup.spawn).toEqual([12.5, 41.01, 8.5]);
    expect(hasPersistedAnarchyWorld(stale)).toBe(true);
    expect(resolveAnarchyStartup(undefined).action).toBe('create');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('reuses the saved canonical spawn and keeps modifications after restart', async () => {
    const saves = new SaveService();
    const first = persistedAnarchy();
    await saves.saveWorld(first);
    const loaded = await saves.loadWorld(ANARCHY_WORLD_ID);
    expect(loaded).toBeDefined();
    const startup = resolveAnarchyStartup(loaded);
    expect(startup.action).toBe('restore');
    if (startup.action !== 'restore') return;
    expect(resolveCanonicalAnarchySpawn(startup.state)).toEqual([12.5, 41.01, 8.5]);
    expect(startup.state.modifications['0,0']?.['20']).toBe(BlockId.Dirt);
    expect(startup.state.player.position).toEqual([13.5, 44.01, 9.5]);

    const world = new VoxelWorld(ANARCHY_WORLD_SEED);
    world.restore(startup.state);
    expect(world.setBlock(2, 40, 2, BlockId.Cobblestone)).toBe(true);
    const second: SerializedWorldState = {
      ...startup.state,
      modifications: world.serializeModifications(),
      player: { ...startup.state.player, position: [13.5, 44.01, 9.5] },
    };
    await saves.saveWorld(second);
    const reloaded = await saves.loadWorld(ANARCHY_WORLD_ID);
    expect(resolveAnarchyStartup(reloaded).action).toBe('restore');
    expect(reloaded?.modifications).toMatchObject(world.serializeModifications());
    expect(resolveCanonicalAnarchySpawn(reloaded!)).toEqual([12.5, 41.01, 8.5]);
  });

  it('opens Anarchy from persistence when the schematic file is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('schematic missing'));
    const startup = resolveAnarchyStartup(persistedAnarchy());
    expect(startup.action).toBe('restore');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('keeps the DEV schematic importer available without using it for startup', async () => {
    const world = new VoxelWorld(ANARCHY_WORLD_SEED);
    const imported = await importAnarchySpawn(world, await fixtureBytes());
    expect(imported.serverWorld.spawnImported).toBe(true);
    expect(imported.report.yShift).toBe(-28);
    expect(world.getBlock(0, imported.report.lowestImportedY, 1)).toBe(BlockId.OakLog);
    expect(world.getBlock(2, imported.report.lowestImportedY, 1)).toBe(BlockId.Air);
    const startup = resolveAnarchyStartup(persistedAnarchy({
      serverWorld: imported.serverWorld,
    }));
    expect(startup.action).toBe('restore');
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
    expect(isAnarchyWorldId((await saves.loadWorld('sp-1'))!.summary.id)).toBe(false);
  });
});
