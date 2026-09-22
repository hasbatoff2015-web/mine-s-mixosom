import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { WORLDGEN_VERSION } from '../../src/core/constants';
import { ANARCHY_WORLD_ID, ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { VoxelWorld } from '../../src/world/World';
import { FsWorldStore } from '../../server/FsWorldStore';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import {
  WorldEventsManager,
  type WorldEventsHost,
} from '../../server/services/worldEvents';
import { emptyValidationContext } from '../../server/services/spawnValidation';
import { sampleSnapshot } from '../persistFixture';

function memoryHost(world: VoxelWorld, extra: Partial<WorldEventsHost> = {}): WorldEventsHost & {
  saved: unknown;
  nowMs: number;
  logs: string[];
  loadedVersion: number | undefined;
} {
  const host: WorldEventsHost & {
    saved: unknown;
    nowMs: number;
    logs: string[];
    loadedVersion: number | undefined;
  } = {
    world,
    saved: {},
    nowMs: 10,
    logs: [],
    loadedVersion: 2,
    worldId: () => 'anarchy',
    now: () => host.nowMs,
    random: () => 0.5,
    spawn: () => [0, 64, 0],
    loadStore: () => host.saved,
    saveStore: (store) => { host.saved = JSON.parse(JSON.stringify(store)); },
    createValidationContext: () => emptyValidationContext(),
    homes: () => [],
    players: () => [],
    flush: () => undefined,
    markDirty: () => undefined,
    persistWorld: () => undefined,
    closeChestWindow: () => undefined,
    broadcast: () => undefined,
    send: () => undefined,
    log: (message) => host.logs.push(message),
    loadedWorldgenVersion: () => host.loadedVersion,
    acknowledgeWorldgenMigration: () => { host.loadedVersion = WORLDGEN_VERSION; },
    ...extra,
  };
  return host;
}

function v2Event(world: VoxelWorld, x: number, z: number) {
  const y = world.surfaceY(x, z);
  const chest = { x, y: y + 1, z };
  const volume = { minX: x, maxX: x, minY: y, maxY: y + 2, minZ: z, maxZ: z };
  const fakeV2 = [
    { x, y, z, blockId: BlockId.GoldBlock },
    { x, y: y + 1, z, blockId: BlockId.GoldBlock },
    { x, y: y + 2, z, blockId: BlockId.GoldBlock },
  ];
  const placement = [
    { x, y, z, blockId: BlockId.GoldBlock },
    { x, y: y + 1, z, blockId: BlockId.EventChest },
    { x, y: y + 2, z, blockId: BlockId.GoldBlock },
  ];
  const event = {
    type: 'resource_chest',
    id: 'chest-old',
    phase: 'spawned_locked' as const,
    worldId: 'anarchy',
    templateName: 'chest_shrine',
    rotation: 0,
    chest,
    volume,
    chestLocked: true,
    spawnAt: 1,
    warningAt: 1,
    unlockAt: 50_000,
    cleanupAt: 80_000,
    snapshot: fakeV2,
    placement,
  };
  return { x, y, z, event, fakeV2 };
}

function naturalAt(world: VoxelWorld, x: number, y: number, z: number): number {
  return world.getBlock(x, y, z, false);
}

describe('world-events V2→V3 generator migration', () => {
  it('rebases placing-journal authority when active is a separate V2 object', () => {
    const world = new VoxelWorld('event-journal-both');
    const site = v2Event(world, 32, 32);
    const base = [
      naturalAt(world, site.x, site.y, site.z),
      naturalAt(world, site.x, site.y + 1, site.z),
      naturalAt(world, site.x, site.y + 2, site.z),
    ];
    const host = memoryHost(world);
    host.nowMs = 90_000;
    host.saved = JSON.parse(JSON.stringify({
      templates: [],
      active: { ...site.event, snapshot: [...site.fakeV2] },
      journal: { phase: 'placing', event: { ...site.event, snapshot: [...site.fakeV2] } },
    }));
    const manager = new WorldEventsManager(host);
    manager.load();
    expect(host.logs.filter((line) => line.includes('rebased event snapshot')).length).toBe(1);
    expect(world.getBlock(site.x, site.y, site.z, false)).toBe(base[0]);
    expect(world.getBlock(site.x, site.y + 1, site.z, false)).toBe(base[1]);
    expect(world.getBlock(site.x, site.y + 2, site.z, false)).toBe(base[2]);
    expect(world.getBlock(site.x, site.y, site.z, false)).not.toBe(BlockId.GoldBlock);
    expect(host.loadedVersion).toBe(WORLDGEN_VERSION);
  });

  it('rebases an active-only V2 snapshot', () => {
    const world = new VoxelWorld('event-active-only');
    const site = v2Event(world, 40, 16);
    const base = naturalAt(world, site.x, site.y, site.z);
    const host = memoryHost(world);
    host.nowMs = 90_000;
    host.saved = JSON.parse(JSON.stringify({
      templates: [],
      active: site.event,
    }));
    new WorldEventsManager(host).load();
    expect(world.getBlock(site.x, site.y, site.z, false)).toBe(base);
    expect(world.getBlock(site.x, site.y, site.z, false)).not.toBe(BlockId.GoldBlock);
  });

  it('rebases a placing-journal-only V2 snapshot', () => {
    const world = new VoxelWorld('event-placing-only');
    const site = v2Event(world, 48, 24);
    const base = naturalAt(world, site.x, site.y, site.z);
    const host = memoryHost(world);
    host.nowMs = 90_000;
    host.saved = JSON.parse(JSON.stringify({
      templates: [],
      journal: { phase: 'placing', event: site.event },
    }));
    new WorldEventsManager(host).load();
    expect(world.getBlock(site.x, site.y, site.z, false)).toBe(base);
    expect(world.getBlock(site.x, site.y, site.z, false)).not.toBe(BlockId.GoldBlock);
  });

  it('skips restoring a cleaning-journal V2 snapshot', () => {
    const world = new VoxelWorld('event-cleaning');
    const site = v2Event(world, 56, 8);
    const base = naturalAt(world, site.x, site.y, site.z);
    const host = memoryHost(world);
    host.saved = JSON.parse(JSON.stringify({
      templates: [],
      journal: { phase: 'cleaning', event: site.event },
    }));
    new WorldEventsManager(host).load();
    expect(world.getBlock(site.x, site.y, site.z, false)).toBe(base);
    expect(world.getBlock(site.x, site.y, site.z, false)).not.toBe(BlockId.GoldBlock);
    expect(host.logs.some((line) => line.includes('skipped V2 snapshot restore'))).toBe(true);
  });

  it('does not rebase again after a plugin lifecycle reload', () => {
    const world = new VoxelWorld('event-reload');
    const site = v2Event(world, 64, 32);
    const host = memoryHost(world);
    host.nowMs = 10;
    host.acknowledgeWorldgenMigration = undefined;
    host.loadedVersion = 2;
    host.saved = JSON.parse(JSON.stringify({
      templates: [],
      active: site.event,
    }));
    const manager = new WorldEventsManager(host);
    manager.load();
    expect(host.logs.filter((line) => line.includes('rebased event snapshot')).length).toBe(1);
    expect(world.getBlock(site.x, site.y + 1, site.z, false)).toBe(BlockId.EventChest);
    manager.load();
    expect(host.logs.filter((line) => line.includes('rebased event snapshot')).length).toBe(1);
    expect(manager.forceCleanup()).toEqual({ ok: true });
    expect(world.getBlock(site.x, site.y + 1, site.z, false)).not.toBe(BlockId.EventChest);
    expect(world.getBlock(site.x, site.y, site.z, false)).not.toBe(BlockId.GoldBlock);
  });
});

describe('worldgenVersion persistence after V2 load', { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('marks a V2 save dirty and writes worldgenVersion 3 on the first persist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-v2-persist-'));
    dirs.push(dir);
    const store = new FsWorldStore(dir);
    await store.save(sampleSnapshot({
      worldgenVersion: 2,
      summary: {
        id: ANARCHY_WORLD_ID,
        name: 'Анархия',
        seed: ANARCHY_WORLD_SEED,
        mode: 'survival',
        kind: 'server',
        createdAt: 11,
        updatedAt: 11,
        playTimeSeconds: 0,
      },
    }));
    expect((await store.load(ANARCHY_WORLD_ID))?.worldgenVersion).toBe(2);
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: ANARCHY_WORLD_ID, WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '4', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
      }, process.cwd()),
      dataDir: dir, port: 0, chunkViewRadius: 1, persistIntervalMs: 60_000,
      pluginDir: join(dir, 'no-plugins'), loadExamplePlugin: false, loadBuiltinPlugins: false,
    });
    worlds.push(world);
    await world.initialize();
    await world.save();
    expect((await store.load(ANARCHY_WORLD_ID))?.worldgenVersion).toBe(WORLDGEN_VERSION);
  });
});
