import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../../src/blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y } from '../../src/core/constants';
import { VoxelWorld } from '../../src/world/World';
import { createItemStack } from '../../src/inventory';
import { EVENT_CHEST_LOOT_TABLE, generateEventChestLoot } from '../../server/services/eventLoot';
import {
  dayKey,
} from '../../server/services/eventScheduler';
import { emptyValidationContext } from '../../server/services/spawnValidation';
import { eventProtectionVolume } from '../../server/services/eventProtection';
import { JsonFileStore } from '../../server/services/jsonStore';
import {
  DEFAULT_WORLD_EVENTS_CONFIG,
  EVENT_SEARCH_MAX_CHUNK_COMMITS_PER_TICK,
  overlayEventPlacementOnChunkModifications,
  overlayEventPlacementOnModifications,
  SEARCH_RETRY_MS,
  WorldEventsManager,
  type WorldEventsHost,
} from '../../server/services/worldEvents';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../src/core/constants';
import { Chunk } from '../../src/world/Chunk';

function memoryHost(world: VoxelWorld, extra: Partial<WorldEventsHost> = {}): WorldEventsHost & {
  saved: unknown;
  nowMs: number;
  storeReads: number;
  persistCalls: number;
} {
  const host: WorldEventsHost & {
    saved: unknown;
    nowMs: number;
    storeReads: number;
    persistCalls: number;
  } = {
    world,
    saved: {},
    nowMs: Date.UTC(2026, 8, 19, 12, 0, 0),
    storeReads: 0,
    persistCalls: 0,
    worldId: () => 'anarchy',
    now: () => host.nowMs,
    random: () => 0.42,
    spawn: () => [0, 64, 0],
    loadStore: () => host.saved,
    saveStore: (store) => { host.saved = JSON.parse(JSON.stringify(store)); },
    createValidationContext: () => {
      host.storeReads += 1;
      return emptyValidationContext({ storeReads: 1, homes: host.homes(), players: host.players() });
    },
    homes: () => [],
    players: () => [],
    flush: () => undefined,
    markDirty: () => undefined,
    persistWorld: () => { host.persistCalls += 1; },
    closeChestWindow: () => undefined,
    broadcast: () => undefined,
    send: () => undefined,
    log: () => undefined,
    ...extra,
  };
  return host;
}

function spawnChest(manager: WorldEventsManager, world: VoxelWorld) {
  const x = 24;
  const z = 24;
  const y = world.surfaceY(x, z) + 1;
  const result = manager.forceSpawn({ at: { x, y, z }, yaw: 0 });
  if (!result.ok || !('event' in result)) throw new Error('ok' in result && !result.ok ? result.error : 'searching');
  return { x, y, z, event: result.event };
}

function findValidPlusXColumn(seed: string, minX: number, maxX: number): { x: number; y: number; z: number } {
  const world = new VoxelWorld(seed);
  const manager = new WorldEventsManager(memoryHost(world));
  manager.load();
  const template = manager.getTemplate('chest_shrine')!;
  for (let x = minX; x <= maxX; x += 1) {
    const y = world.surfaceY(x, 0) + 1;
    if (manager.validateCandidate(template, { x, y, z: 0 }, 0)) return { x, y, z: 0 };
  }
  throw new Error(`no valid +X shrine column in ${seed} for ${minX}..${maxX}`);
}

describe('event chest loot', () => {
  it('always includes the required rare items and fills most of the pool', () => {
    const loot = generateEventChestLoot(() => 0.1);
    const ids = loot.map((stack) => stack.itemId);
    expect(ids).toEqual(expect.arrayContaining([
      'tnt_powerful', 'tnt', 'titanium_ingot', 'ruby_ingot', 'diamond', 'golden_apple', 'titanium_hoe',
    ]));
    expect(loot.length).toBeGreaterThanOrEqual(EVENT_CHEST_LOOT_TABLE.filter((entry) => entry.required).length + 4);
    expect(loot.find((stack) => stack.itemId === 'diamond')?.count).toBeGreaterThanOrEqual(7);
  });
});

describe('world events lifecycle', () => {
  it('spawns a locked event chest, keeps loot stable, unlocks, then restores the world', () => {
    const world = new VoxelWorld('world-events-life');
    const host = memoryHost(world);
    const marker = { x: 22, y: world.surfaceY(22, 22) + 1, z: 22 };
    world.setBlock(marker.x, marker.y, marker.z, BlockId.GoldBlock);
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC', unlockDelayMinutes: 5, durationMinutes: 30 });
    manager.load();
    manager.enabled = true;

    const spawned = spawnChest(manager, world);
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);
    expect(manager.isLockedChest(spawned.x, spawned.y, spawned.z)).toBe(true);
    expect(manager.isProtected(spawned.x, spawned.y, spawned.z)).toBe(true);
    expect(manager.isProtected(spawned.x, spawned.y + 20, spawned.z)).toBe(true);
    expect(manager.isProtected(spawned.x, MIN_WORLD_Y, spawned.z)).toBe(true);
    expect(manager.isProtected(spawned.x, MAX_WORLD_Y, spawned.z)).toBe(true);
    const protection = manager.protectionVolume()!;
    expect(protection.minY).toBe(MIN_WORLD_Y);
    expect(protection.maxY).toBe(MAX_WORLD_Y);
    expect(protection.minX).toBe(manager.structureVolume()!.minX);
    const before = world.getChest(spawned.x, spawned.y, spawned.z).slots.map((slot) => slot && { ...slot });
    expect(before.some((slot) => slot?.itemId === 'tnt_powerful')).toBe(true);
    expect(host.persistCalls).toBeGreaterThan(0);

    host.nowMs = spawned.event.unlockAt + 1;
    manager.tick();
    expect(manager.active?.phase).toBe('active_unlocked');
    expect(manager.isLockedChest(spawned.x, spawned.y, spawned.z)).toBe(false);
    expect(world.getChest(spawned.x, spawned.y, spawned.z).slots).toEqual(before);

    host.nowMs = spawned.event.cleanupAt + 1;
    manager.tick();
    expect(manager.active).toBeUndefined();
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).not.toBe(BlockId.EventChest);
    expect(world.getBlock(marker.x, marker.y, marker.z)).toBe(BlockId.GoldBlock);
    expect(world.chests.get(`${spawned.x},${spawned.y},${spawned.z}`)).toBeUndefined();
    expect(manager.isProtected(spawned.x, spawned.y, spawned.z)).toBe(true);
    manager.acknowledgeWorldSaved();
    expect(manager.isProtected(spawned.x, spawned.y, spawned.z)).toBe(false);
  });

  it('restores timers after restart and cleans up if the event already expired', () => {
    const world = new VoxelWorld('world-events-restart');
    const host = memoryHost(world);
    const first = new WorldEventsManager(host);
    first.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC', durationMinutes: 30 });
    first.load();
    first.enabled = true;
    const spawned = spawnChest(first, world);
    expect(first.active?.phase).toBe('spawned_locked');
    expect(first.systemClaim()?.id).toBe(`world-event:${first.active!.id}`);

    const locked = new WorldEventsManager(host);
    locked.setConfig(first.config);
    locked.load();
    locked.enabled = true;
    expect(locked.active?.phase).toBe('spawned_locked');
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);
    expect(locked.isProtected(spawned.x, spawned.y + 40, spawned.z)).toBe(true);

    host.nowMs = spawned.event.unlockAt + 50;
    const unlocked = new WorldEventsManager(host);
    unlocked.setConfig(first.config);
    unlocked.load();
    expect(unlocked.active?.phase).toBe('active_unlocked');
    expect(unlocked.active?.chestLocked).toBe(false);

    host.nowMs = spawned.event.cleanupAt + 50;
    const expired = new WorldEventsManager(host);
    expired.setConfig(first.config);
    expired.load();
    expect(expired.active).toBeUndefined();
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).not.toBe(BlockId.EventChest);
  });

  it('reapplies stored loot after a crash that lost the world save', () => {
    const world = new VoxelWorld('world-events-crash-place');
    const host = memoryHost(world);
    const first = new WorldEventsManager(host);
    first.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    first.load();
    first.enabled = true;
    const spawned = spawnChest(first, world);
    const loot = world.getChest(spawned.x, spawned.y, spawned.z).slots.map((slot) => slot && { ...slot });
    world.setBlock(spawned.x, spawned.y, spawned.z, BlockId.Air);
    world.chests.delete(`${spawned.x},${spawned.y},${spawned.z}`);

    const recovered = new WorldEventsManager(host);
    recovered.setConfig(first.config);
    recovered.load();
    expect(recovered.active?.phase).toBe('spawned_locked');
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);
    expect(world.getChest(spawned.x, spawned.y, spawned.z).slots).toEqual(loot);
  });

  it('rejects a second active event and keeps generated loot on the server', () => {
    const world = new VoxelWorld('world-events-once');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.load();
    manager.enabled = true;
    const first = spawnChest(manager, world);
    const second = manager.forceSpawn({ at: { x: first.x + 20, y: first.y, z: first.z } });
    expect(second.ok).toBe(false);
    expect(world.getChest(first.x, first.y, first.z).slots.some((slot) => slot && createItemStack(slot.itemId, slot.count))).toBe(true);
  });

  it('sends the daily warning once, then waits for spawn time', () => {
    const world = new VoxelWorld('world-events-warn');
    const host = memoryHost(world);
    const messages: string[] = [];
    host.broadcast = (text) => { messages.push(text); };
    host.nowMs = Date.UTC(2026, 8, 19, 19, 40, 0);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      dailyTime: '20:00',
      warningMinutes: 15,
    });
    manager.load();
    manager.enabled = true;
    manager.tick();
    expect(manager.active?.phase).toBe('scheduled');
    expect(messages).toEqual([]);

    host.nowMs = Date.UTC(2026, 8, 19, 19, 45, 0);
    manager.tick();
    expect(manager.active?.phase).toBe('warning_sent');
    expect(messages.some((line) => line.includes('Через') && line.includes('ивентовый сундук'))).toBe(true);

    messages.length = 0;
    host.nowMs = Date.UTC(2026, 8, 19, 19, 50, 0);
    manager.tick();
    expect(manager.active?.phase).toBe('warning_sent');
    expect(messages).toEqual([]);
  });

  it('does not count a failed search as the daily spawn', () => {
    const world = new VoxelWorld('world-events-retry');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      spawnMinDistance: 3000,
      spawnMaxDistance: 3000,
      worldBorder: 10,
      maxSearchAttempts: 3,
      attemptsPerTick: 3,
    });
    manager.load();
    manager.enabled = true;
    const started = manager.forceSpawn();
    expect(started).toEqual({ ok: true, searching: true });
    host.nowMs += 50;
    manager.tick();
    expect(manager.active?.phase === 'spawned_locked').toBe(false);
    const saved = host.saved as { lastSpawnDayKey?: string };
    expect(saved.lastSpawnDayKey).toBeUndefined();
    expect(manager.lastSearchError).toMatch(/Не найдено место/);
    host.nowMs += SEARCH_RETRY_MS - 100;
    manager.tick();
    expect(manager.lastSearchError).toMatch(/Не найдено место/);
  });

  it('does not let a morning force spawn eat the 20:00 daily event', () => {
    const world = new VoxelWorld('world-events-force-daily');
    const host = memoryHost(world);
    host.nowMs = Date.UTC(2026, 8, 19, 10, 0, 0);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      dailyTime: '20:00',
      spawnMinDistance: 8,
      spawnMaxDistance: 40,
      maxSearchAttempts: 40,
    });
    manager.load();
    manager.enabled = true;
    spawnChest(manager, world);
    expect((host.saved as { lastSpawnDayKey?: string }).lastSpawnDayKey).toBeUndefined();
    manager.forceCleanup();
    manager.acknowledgeWorldSaved();
    host.nowMs = Date.UTC(2026, 8, 19, 20, 0, 1);
    manager.tick();
    expect(manager.active?.phase === 'spawned_locked' || manager.active?.phase === 'scheduled').toBe(true);
    if (manager.active?.phase === 'scheduled') {
      expect(manager.active.spawnAt).toBe(Date.UTC(2026, 8, 19, 20, 0, 0));
    }
  });

  it('catches up when the server starts shortly after the daily time', () => {
    const world = new VoxelWorld('world-events-catchup');
    const host = memoryHost(world);
    host.nowMs = Date.UTC(2026, 8, 19, 20, 2, 0);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      dailyTime: '20:00',
      durationMinutes: 120,
      spawnMinDistance: 8,
      spawnMaxDistance: 40,
    });
    manager.load();
    manager.enabled = true;
    manager.tick();
    expect(manager.active).toBeDefined();
    expect(manager.active?.spawnAt).toBe(Date.UTC(2026, 8, 19, 20, 0, 0));
  });

  it('misses the day when started after the full event window', () => {
    const world = new VoxelWorld('world-events-miss');
    const host = memoryHost(world);
    host.nowMs = Date.UTC(2026, 8, 19, 22, 1, 0);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      dailyTime: '20:00',
      durationMinutes: 120,
    });
    manager.load();
    manager.enabled = true;
    manager.tick();
    expect(manager.active?.phase).toBe('scheduled');
    expect(manager.active?.spawnAt).toBeGreaterThan(Date.UTC(2026, 8, 19, 22, 1, 0));
  });

  it('recomputes a future schedule on config reload but not an already spawned event', () => {
    const world = new VoxelWorld('world-events-reload');
    const host = memoryHost(world);
    host.nowMs = Date.UTC(2026, 8, 19, 18, 0, 0);
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC', dailyTime: '20:00' });
    manager.load();
    manager.enabled = true;
    manager.tick();
    expect(manager.active?.spawnAt).toBe(Date.UTC(2026, 8, 19, 20, 0, 0));
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC', dailyTime: '21:30' });
    expect(manager.active?.spawnAt).toBe(Date.UTC(2026, 8, 19, 21, 30, 0));
    spawnChest(manager, world);
    const spawnAt = manager.active!.spawnAt;
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC', dailyTime: '19:00' });
    expect(manager.active?.spawnAt).toBe(spawnAt);
    expect(manager.active?.phase).toBe('spawned_locked');
  });

  it('rejects spawn candidates in claims, water, buried chests, furnaces and signs', () => {
    const world = new VoxelWorld('world-events-site');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.load();
    const template = manager.getTemplate('chest_shrine')!;
    const x = 20;
    const z = 20;
    const y = world.surfaceY(x, z) + 1;
    expect(manager.validateCandidate(template, { x, y, z }, 0)).toBe(true);

    expect(manager.validateCandidate(template, { x, y, z }, 0, emptyValidationContext({
      claimVolumes: [{ minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z }],
    }))).toBe(false);

    expect(manager.validateCandidate(template, { x, y, z }, 0, emptyValidationContext({
      specialVolumes: [{ minX: x, minY: y - 2, minZ: z, maxX: x, maxY: y + 2, maxZ: z }],
    }))).toBe(false);

    world.setBlock(x, y, z, BlockId.Water);
    expect(manager.validateCandidate(template, { x, y, z }, 0)).toBe(false);
  });

  it('rejects a buried chest, furnace, or sign inside the structure volume', () => {
    const world = new VoxelWorld('world-events-persist');
    const manager = new WorldEventsManager(memoryHost(world));
    manager.load();
    const template = manager.getTemplate('chest_shrine')!;
    const x = 20;
    const z = 20;
    const y = world.surfaceY(x, z) + 1;

    world.setBlock(x, y - 1, z, BlockId.Chest);
    expect(manager.validateCandidate(template, { x, y, z }, 0)).toBe(false);

    const furnaceWorld = new VoxelWorld('world-events-furnace');
    const furnaceManager = new WorldEventsManager(memoryHost(furnaceWorld));
    furnaceManager.load();
    const fy = furnaceWorld.surfaceY(x, z) + 1;
    furnaceWorld.setBlock(x, fy - 1, z, BlockId.Furnace);
    furnaceWorld.getFurnace(x, fy - 1, z).slots[0] = createItemStack('coal', 4);
    expect(furnaceManager.validateCandidate(template, { x, y: fy, z }, 0)).toBe(false);

    const signWorld = new VoxelWorld('world-events-sign');
    const signManager = new WorldEventsManager(memoryHost(signWorld));
    signManager.load();
    const sy = signWorld.surfaceY(x, z) + 1;
    signWorld.setBlock(x, sy, z + 1, BlockId.OakSign);
    signWorld.setSignText(x, sy, z + 1, ['home', '', '', '']);
    expect(signManager.validateCandidate(template, { x, y: sy, z }, 0)).toBe(false);
  });

  it('repeats a failed daily search later without consuming the day', () => {
    const world = new VoxelWorld('world-events-daily-retry');
    const host = memoryHost(world);
    host.nowMs = Date.UTC(2026, 8, 19, 20, 0, 1);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      dailyTime: '20:00',
      spawnMinDistance: 3000,
      spawnMaxDistance: 3000,
      worldBorder: 8,
      maxSearchAttempts: 3,
      attemptsPerTick: 3,
    });
    manager.load();
    manager.enabled = true;
    manager.tick();
    expect((host.saved as { lastSpawnDayKey?: string }).lastSpawnDayKey).toBeUndefined();
    expect(manager.active?.phase === 'spawned_locked').toBe(false);
    expect(manager.lastSearchError).toMatch(/Не найдено место/);
    host.nowMs += SEARCH_RETRY_MS + 1;
    manager.tick();
    expect((host.saved as { lastSpawnDayKey?: string }).lastSpawnDayKey).toBeUndefined();
  });

  it('restores a cleaning journal after a crash that kept the old world save', () => {
    const world = new VoxelWorld('world-events-crash-clean');
    const host = memoryHost(world);
    const first = new WorldEventsManager(host);
    first.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    first.load();
    first.enabled = true;
    const x = 24;
    const z = 24;
    const y = world.surfaceY(x, z) + 1;
    const original = world.getBlock(x, y, z);
    expect(first.forceSpawn({ at: { x, y, z }, yaw: 0 }).ok).toBe(true);
    first.forceCleanup();
    expect((host.saved as { journal?: { phase?: string } }).journal?.phase).toBe('cleaning');
    world.setBlock(x, y, z, BlockId.EventChest);
    const recovered = new WorldEventsManager(host);
    recovered.setConfig(first.config);
    recovered.load();
    expect(recovered.active).toBeUndefined();
    expect(world.getBlock(x, y, z)).toBe(original);
    recovered.acknowledgeWorldSaved();
    expect(recovered.isProtected(x, y, z)).toBe(false);
  });

  it('loads claim/portal stores once per search cycle, not per voxel', () => {
    const world = new VoxelWorld('world-events-io');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      spawnMinDistance: 3000,
      spawnMaxDistance: 3000,
      worldBorder: 4,
      maxSearchAttempts: 8,
      attemptsPerTick: 4,
    });
    manager.load();
    manager.enabled = true;
    host.storeReads = 0;
    manager.forceSpawn();
    manager.tick();
    expect(host.storeReads).toBe(1);
    expect(manager.lastValidationStoreReads).toBe(1);
  });

  it('does not read JSON from disk inside validateCandidate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-event-io-'));
    try {
      const store = new JsonFileStore(dir);
      store.save('claims/claims', { claims: [] });
      store.save('rtpportal/portals', { portals: [] });
      const world = new VoxelWorld('world-events-json-io');
      const host = memoryHost(world, {
        createValidationContext: () => {
          const before = store.readCount;
          store.load('claims/claims', { claims: [] });
          store.load('rtpportal/portals', { portals: [] });
          return emptyValidationContext({ storeReads: store.readCount - before });
        },
      });
      const manager = new WorldEventsManager(host);
      manager.load();
      const template = manager.getTemplate('chest_shrine')!;
      const x = 20;
      const z = 20;
      const y = world.surfaceY(x, z) + 1;
      const before = store.readCount;
      const context = host.createValidationContext();
      expect(store.readCount - before).toBe(2);
      manager.validateCandidate(template, { x, y, z }, 0, context);
      manager.validateCandidate(template, { x: x + 1, y, z }, 0, context);
      expect(store.readCount - before).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a full-height protection volume from the structure footprint', () => {
    const structure = { minX: 100, minY: 40, minZ: 200, maxX: 104, maxY: 42, maxZ: 204 };
    expect(eventProtectionVolume(structure)).toEqual({
      minX: 100, maxX: 104, minZ: 200, maxZ: 204, minY: MIN_WORLD_Y, maxY: MAX_WORLD_Y,
    });
  });

  it('does not record temporary event blocks as world.modifications', () => {
    const world = new VoxelWorld('world-events-mods-a');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    manager.load();
    manager.enabled = true;
    const x = 24;
    const z = 24;
    world.surfaceY(x, z);
    const before = world.serializeModifications();
    const spawned = spawnChest(manager, world);
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);
    expect(world.serializeModifications()).toEqual(before);
    manager.forceCleanup();
    manager.acknowledgeWorldSaved();
    expect(world.serializeModifications()).toEqual(before);
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).not.toBe(BlockId.EventChest);
  });

  it('keeps a pre-existing modification through spawn and cleanup', () => {
    const world = new VoxelWorld('world-events-mods-b');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    manager.load();
    manager.enabled = true;
    const x = 24;
    const z = 24;
    const y = world.surfaceY(x, z) + 1;
    world.setBlock(x + 2, y, z + 2, BlockId.GoldBlock);
    const before = world.serializeModifications();
    expect(Object.keys(before).length).toBeGreaterThan(0);
    expect(manager.forceSpawn({ at: { x, y, z }, yaw: 0 }).ok).toBe(true);
    expect(world.getBlock(x, y, z)).toBe(BlockId.EventChest);
    manager.forceCleanup();
    manager.acknowledgeWorldSaved();
    expect(world.serializeModifications()).toEqual(before);
    expect(world.getBlock(x + 2, y, z + 2)).toBe(BlockId.GoldBlock);
  });

  it('restores missing BlockRenderState when the overlay reused the same block id', () => {
    const world = new VoxelWorld('world-events-state-absent');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    manager.load();
    manager.enabled = true;
    const x = 24;
    const z = 24;
    const y = world.surfaceY(x, z) + 1;
    const stair = { x, y, z: z - 2 };
    world.setBlock(stair.x, stair.y, stair.z, BlockId.StoneBrickStairs);
    expect(world.getBlockState(stair.x, stair.y, stair.z)).toBeUndefined();
    expect(manager.forceSpawn({ at: { x, y, z }, yaw: 0 }).ok).toBe(true);
    expect(world.getBlock(stair.x, stair.y, stair.z)).toBe(BlockId.StoneBrickStairs);
    expect(world.getBlockState(stair.x, stair.y, stair.z)).toEqual({ facing: 'north', stairHalf: 'bottom' });
    manager.forceCleanup();
    manager.acknowledgeWorldSaved();
    expect(world.getBlock(stair.x, stair.y, stair.z)).toBe(BlockId.StoneBrickStairs);
    expect(world.getBlockState(stair.x, stair.y, stair.z)).toBeUndefined();
  });

  it('restores an existing BlockRenderState 1:1 after cleanup', () => {
    const world = new VoxelWorld('world-events-state-keep');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    manager.load();
    manager.enabled = true;
    const x = 24;
    const z = 24;
    const y = world.surfaceY(x, z) + 1;
    const stair = { x, y, z: z - 2 };
    const original = { facing: 'east' as const, stairHalf: 'top' as const };
    world.setBlock(stair.x, stair.y, stair.z, BlockId.StoneBrickStairs);
    world.setBlockState(stair.x, stair.y, stair.z, original);
    expect(manager.forceSpawn({ at: { x, y, z }, yaw: 0 }).ok).toBe(true);
    manager.forceCleanup();
    manager.acknowledgeWorldSaved();
    expect(world.getBlock(stair.x, stair.y, stair.z)).toBe(BlockId.StoneBrickStairs);
    expect(world.getBlockState(stair.x, stair.y, stair.z)).toEqual(original);
  });

  it('does not spawn a failed daily search after cleanupAt', () => {
    const world = new VoxelWorld('world-events-expired-search');
    const host = memoryHost(world);
    const messages: string[] = [];
    host.broadcast = (text) => { messages.push(text); };
    host.nowMs = Date.UTC(2026, 8, 19, 20, 0, 1);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      dailyTime: '20:00',
      durationMinutes: 120,
      spawnMinDistance: 3000,
      spawnMaxDistance: 3000,
      worldBorder: 8,
      maxSearchAttempts: 3,
      attemptsPerTick: 3,
    });
    manager.load();
    manager.enabled = true;
    manager.tick();
    expect(manager.lastSearchError).toMatch(/Не найдено место/);
    expect(manager.active?.phase === 'spawned_locked' || manager.active?.phase === 'active_unlocked').toBe(false);

    host.random = () => 0;
    host.nowMs = Date.UTC(2026, 8, 19, 22, 0, 1);
    manager.config = {
      ...manager.config,
      spawnMinDistance: 24,
      spawnMaxDistance: 24,
      worldBorder: 10_000,
      maxSearchAttempts: 80,
    };
    const y = world.surfaceY(24, 0) + 1;
    messages.length = 0;
    manager.tick();
    expect(world.getBlock(24, y, 0)).not.toBe(BlockId.EventChest);
    expect(manager.active?.phase === 'spawned_locked' || manager.active?.phase === 'active_unlocked').toBe(false);
    expect(messages.some((line) => line.includes('Ивентовый сундук появился'))).toBe(false);
    expect(manager.active?.phase).toBe('scheduled');
    expect(dayKey(manager.active!.spawnAt, 'UTC')).toBe('2026-09-20');
  });

  it('catch-up before unlock keeps the chest locked with the actual remaining time', () => {
    const site = findValidPlusXColumn('world-events-catchup-lock', 48, 96);
    const world = new VoxelWorld('world-events-catchup-lock');
    const host = memoryHost(world);
    const messages: string[] = [];
    host.broadcast = (text) => { messages.push(text); };
    host.random = () => 0;
    host.nowMs = Date.UTC(2026, 8, 19, 20, 2, 0);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      dailyTime: '20:00',
      unlockDelayMinutes: 5,
      durationMinutes: 120,
      spawnMinDistance: site.x,
      spawnMaxDistance: site.x,
      worldBorder: 10_000,
      announceCoordinates: false,
    });
    manager.load();
    manager.enabled = true;
    manager.searchGenerationBudgetMs = 1_000;
    let guard = 0;
    while (!manager.active?.chest && guard < 40) {
      manager.tick();
      guard += 1;
    }
    expect(manager.active?.phase).toBe('spawned_locked');
    expect(manager.active?.chestLocked).toBe(true);
    expect(manager.isLockedChest(manager.active!.chest!.x, manager.active!.chest!.y, manager.active!.chest!.z)).toBe(true);
    expect(messages.some((line) => line.includes('откроется через 5 мин'))).toBe(false);
    expect(messages.some((line) => line.includes('откроется через 3 мин'))).toBe(true);
  });

  it('catch-up after unlock spawns the chest already open', () => {
    const site = findValidPlusXColumn('world-events-catchup-open', 48, 96);
    const world = new VoxelWorld('world-events-catchup-open');
    const host = memoryHost(world);
    const messages: string[] = [];
    host.broadcast = (text) => { messages.push(text); };
    host.random = () => 0;
    host.nowMs = Date.UTC(2026, 8, 19, 20, 10, 0);
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      dailyTime: '20:00',
      unlockDelayMinutes: 5,
      durationMinutes: 120,
      spawnMinDistance: site.x,
      spawnMaxDistance: site.x,
      worldBorder: 10_000,
      announceCoordinates: false,
    });
    manager.load();
    manager.enabled = true;
    manager.searchGenerationBudgetMs = 1_000;
    let guard = 0;
    while (!manager.active?.chest && guard < 40) {
      manager.tick();
      guard += 1;
    }
    expect(manager.active?.phase).toBe('active_unlocked');
    expect(manager.active?.chestLocked).toBe(false);
    expect(manager.isLockedChest(manager.active!.chest!.x, manager.active!.chest!.y, manager.active!.chest!.z)).toBe(false);
    expect(messages.some((line) => line.includes('откроется через 5 мин'))).toBe(false);
    expect(messages.some((line) => line.includes('Сундук открыт!'))).toBe(true);
  });

  it('rejects a candidate against a claim created after the cached search context', () => {
    const site = findValidPlusXColumn('world-events-toctou', 48, 80);
    const world = new VoxelWorld('world-events-toctou');
    const claims: Array<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }> = [];
    const host = memoryHost(world);
    host.random = () => 0;
    host.createValidationContext = () => {
      host.storeReads += 1;
      return emptyValidationContext({
        storeReads: 1,
        claimVolumes: claims.map((volume) => ({ ...volume })),
        homes: host.homes(),
        players: host.players(),
      });
    };
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      spawnMinDistance: site.x,
      spawnMaxDistance: site.x,
      worldBorder: 10_000,
    });
    manager.load();
    manager.enabled = true;
    manager.searchGenerationBudgetMs = 1_000;
    host.storeReads = 0;
    expect(manager.forceSpawn({ yaw: 0 })).toEqual({ ok: true, searching: true });
    expect(host.storeReads).toBe(1);
    claims.push({
      minX: site.x - 2,
      minY: MIN_WORLD_Y,
      minZ: site.z - 2,
      maxX: site.x + 2,
      maxY: MAX_WORLD_Y,
      maxZ: site.z + 2,
    });
    let guard = 0;
    while (guard < 40 && manager.active?.phase !== 'spawned_locked' && manager.active?.phase !== 'active_unlocked') {
      manager.tick();
      guard += 1;
      if (manager.lastSearchError?.includes('Не найдено место')) break;
    }
    expect(world.getBlock(site.x, site.y, site.z)).not.toBe(BlockId.EventChest);
    expect(manager.active?.chest).toBeUndefined();
    expect(host.storeReads).toBeGreaterThanOrEqual(2);
    expect(host.storeReads).toBeLessThan(20);
  });

  it('reapplies a placing journal without polluting modifications', () => {
    const world = new VoxelWorld('world-events-crash-place-mods');
    const host = memoryHost(world);
    const first = new WorldEventsManager(host);
    first.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    first.load();
    first.enabled = true;
    const x = 24;
    const z = 24;
    world.surfaceY(x, z);
    const before = world.serializeModifications();
    const spawned = spawnChest(first, world);
    expect(world.serializeModifications()).toEqual(before);
    const loot = world.getChest(spawned.x, spawned.y, spawned.z).slots.map((slot) => slot && { ...slot });
    world.setBlock(spawned.x, spawned.y, spawned.z, BlockId.Air, false);
    world.chests.delete(`${spawned.x},${spawned.y},${spawned.z}`);
    const recovered = new WorldEventsManager(host);
    recovered.setConfig(first.config);
    recovered.load();
    expect(recovered.active?.phase).toBe('spawned_locked');
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);
    expect(world.getChest(spawned.x, spawned.y, spawned.z).slots).toEqual(loot);
    expect(world.serializeModifications()).toEqual(before);
  });

  it('repeats cleaning restore without destroying pre-event modifications', () => {
    const world = new VoxelWorld('world-events-crash-clean-mods');
    const host = memoryHost(world);
    const first = new WorldEventsManager(host);
    first.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    first.load();
    first.enabled = true;
    const x = 24;
    const z = 24;
    const y = world.surfaceY(x, z) + 1;
    world.setBlock(x + 2, y, z + 2, BlockId.DiamondBlock);
    const before = world.serializeModifications();
    expect(first.forceSpawn({ at: { x, y, z }, yaw: 0 }).ok).toBe(true);
    first.forceCleanup();
    expect((host.saved as { journal?: { phase?: string } }).journal?.phase).toBe('cleaning');
    world.setBlock(x, y, z, BlockId.EventChest, false);
    const recovered = new WorldEventsManager(host);
    recovered.setConfig(first.config);
    recovered.load();
    expect(recovered.active).toBeUndefined();
    expect(world.getBlock(x, y, z)).not.toBe(BlockId.EventChest);
    expect(world.getBlock(x + 2, y, z + 2)).toBe(BlockId.DiamondBlock);
    expect(world.serializeModifications()).toEqual(before);
    recovered.acknowledgeWorldSaved();
    expect(recovered.isProtected(x, y, z)).toBe(false);
  });

  it('time-slices far candidate generation instead of completing several chunks in one tick', () => {
    const seed = 'world-events-far-search';
    const site = findValidPlusXColumn(seed, 64, 112);
    const world = new VoxelWorld(seed);
    const host = memoryHost(world);
    host.random = () => 0;
    const manager = new WorldEventsManager(host);
    manager.setConfig({
      ...DEFAULT_WORLD_EVENTS_CONFIG,
      timeZone: 'UTC',
      spawnMinDistance: site.x,
      spawnMaxDistance: site.x,
      worldBorder: 10_000,
      maxSearchAttempts: 16,
      attemptsPerTick: 4,
    });
    manager.load();
    manager.enabled = true;
    manager.searchGenerationBudgetMs = 2;
    manager.searchMaxChunkCommitsPerTick = EVENT_SEARCH_MAX_CHUNK_COMMITS_PER_TICK;
    let t = 0;
    manager.searchClock = () => {
      t += 1;
      return t;
    };
    expect(manager.forceSpawn({ yaw: 0 })).toEqual({ ok: true, searching: true });
    const commits: number[] = [];
    let guard = 0;
    while (!manager.active?.chest && guard < 200) {
      const before = world.generationCommitCount;
      manager.tick();
      const added = world.generationCommitCount - before;
      commits.push(added);
      expect(added).toBeLessThanOrEqual(EVENT_SEARCH_MAX_CHUNK_COMMITS_PER_TICK);
      expect(manager.lastSearchChunkCommits).toBeLessThanOrEqual(EVENT_SEARCH_MAX_CHUNK_COMMITS_PER_TICK);
      guard += 1;
    }
    expect(manager.active?.chest).toBeDefined();
    expect(world.getBlock(manager.active!.chest!.x, manager.active!.chest!.y, manager.active!.chest!.z)).toBe(BlockId.EventChest);
    expect(commits.some((count) => count === 0 || count === 1)).toBe(true);
    expect(Math.max(...commits)).toBeLessThanOrEqual(1);
    expect(guard).toBeGreaterThan(1);
  });

  it('overlays event placement onto network modifications without mutating persistence', () => {
    const persistent = { '0,0': { '1': BlockId.Dirt } };
    const snapshot = JSON.parse(JSON.stringify(persistent)) as typeof persistent;
    const cell = { x: 4, y: 40, z: 5, blockId: BlockId.StoneBricks };
    const air = { x: 4, y: 41, z: 5, blockId: BlockId.Air };
    const key = chunkKey(0, 0);
    const composed = overlayEventPlacementOnModifications(persistent, [cell, air]);
    expect(persistent).toEqual(snapshot);
    expect(composed[key]?.[String(Chunk.index(4, 40, 5))]).toBe(BlockId.StoneBricks);
    expect(composed[key]?.[String(Chunk.index(4, 41, 5))]).toBe(BlockId.Air);
    expect(composed[key]?.['1']).toBe(BlockId.Dirt);
    const chunk = overlayEventPlacementOnChunkModifications({}, [cell, air], 0, 0);
    expect(chunk[String(Chunk.index(4, 40, 5))]).toBe(BlockId.StoneBricks);
    expect(overlayEventPlacementOnChunkModifications({}, [cell], 1, 0)).toEqual({});
  });

  it('reconnects a fresh client world to the live shrine without persistent mods', () => {
    const world = new VoxelWorld('world-events-reconnect-visual');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    manager.load();
    manager.enabled = true;
    const spawned = spawnChest(manager, world);
    const persistent = world.serializeModifications();
    expect(persistent).toEqual({});
    const network = overlayEventPlacementOnModifications(persistent, manager.networkPlacement());
    expect(network).not.toEqual(persistent);

    const client = new VoxelWorld('world-events-reconnect-visual');
    client.restore({
      timeOfDay: world.timeOfDay,
      modifications: network,
      chests: {},
      furnaces: {},
      blockStates: world.serializeBlockStates(),
    });
    const cx = floorDiv(spawned.x, CHUNK_SIZE);
    const cz = floorDiv(spawned.z, CHUNK_SIZE);
    client.getChunk(cx, cz, true);
    expect(client.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);
    expect(client.getBlock(spawned.x, spawned.y, spawned.z)).toBe(world.getBlock(spawned.x, spawned.y, spawned.z));
    expect(client.getBlockState(spawned.x, spawned.y, spawned.z)).toEqual(world.getBlockState(spawned.x, spawned.y, spawned.z));
    expect(client.getBlock(spawned.x, spawned.y - 1, spawned.z)).toBe(BlockId.StoneBricks);
    expect(client.getBlock(spawned.x - 2, spawned.y, spawned.z - 2)).toBe(BlockId.RedWool);
    expect(client.getBlock(spawned.x - 2, spawned.y + 1, spawned.z - 2)).toBe(BlockId.OakFence);
    expect(client.getBlock(spawned.x, spawned.y + 1, spawned.z)).toBe(BlockId.Air);
    expect(client.getBlockState(spawned.x, spawned.y, spawned.z - 2)).toEqual({
      facing: 'north',
      stairHalf: 'bottom',
    });
    for (const cell of manager.active!.placement!) {
      expect(client.getBlock(cell.x, cell.y, cell.z)).toBe(world.getBlock(cell.x, cell.y, cell.z));
      expect(client.getBlockState(cell.x, cell.y, cell.z)).toEqual(world.getBlockState(cell.x, cell.y, cell.z));
    }

    const control = new VoxelWorld('world-events-reconnect-visual');
    control.restore({
      timeOfDay: world.timeOfDay,
      modifications: persistent,
      chests: {},
      furnaces: {},
      blockStates: {},
    });
    control.getChunk(cx, cz, true);
    expect(control.getBlock(spawned.x, spawned.y, spawned.z)).not.toBe(BlockId.EventChest);

    client.pruneChunks(spawned.x + 10_000, spawned.z + 10_000, 0);
    expect(client.getChunk(cx, cz, false)).toBeUndefined();
    client.getChunk(cx, cz, true);
    expect(client.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);

    manager.forceCleanup();
    manager.acknowledgeWorldSaved();
    expect(world.serializeModifications()).toEqual(persistent);
    const after = overlayEventPlacementOnModifications(world.serializeModifications(), manager.networkPlacement());
    expect(after).toEqual(persistent);
    const cleaned = new VoxelWorld('world-events-reconnect-visual');
    cleaned.restore({
      timeOfDay: world.timeOfDay,
      modifications: after,
      chests: {},
      furnaces: {},
      blockStates: world.serializeBlockStates(),
    });
    cleaned.getChunk(cx, cz, true);
    expect(cleaned.getBlock(spawned.x, spawned.y, spawned.z)).not.toBe(BlockId.EventChest);
    expect(cleaned.getBlock(spawned.x, spawned.y, spawned.z)).toBe(world.getBlock(spawned.x, spawned.y, spawned.z));
  });

  it('overlays a shrine that straddles a chunk border', () => {
    const world = new VoxelWorld('world-events-chunk-border');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
    manager.load();
    manager.enabled = true;
    const x = CHUNK_SIZE;
    const z = CHUNK_SIZE;
    const y = world.surfaceY(x, z) + 1;
    expect(manager.forceSpawn({ at: { x, y, z }, yaw: 0 }).ok).toBe(true);
    const network = overlayEventPlacementOnModifications(
      world.serializeModifications(),
      manager.networkPlacement(),
    );
    expect(network['0,0']).toBeDefined();
    expect(network['1,1']).toBeDefined();
    const client = new VoxelWorld('world-events-chunk-border');
    client.restore({
      timeOfDay: world.timeOfDay,
      modifications: network,
      chests: {},
      furnaces: {},
      blockStates: world.serializeBlockStates(),
    });
    for (const [cx, cz] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) client.getChunk(cx, cz, true);
    expect(client.getBlock(x, y, z)).toBe(BlockId.EventChest);
    expect(client.getBlock(x - 2, y, z - 2)).toBe(world.getBlock(x - 2, y, z - 2));
  });
});

describe('event chest block', () => {
  it('is a distinct chest-shaped block', () => {
    expect(BlockId.EventChest).toBe(166);
    expect(BlockId.EventChest).not.toBe(BlockId.Chest);
    expect(BlockId.EventChest).not.toBe(BlockId.PortalChest);
    expect(getBlockDefinition(BlockId.EventChest).key).toBe('event_chest');
    expect(getBlockDefinition(BlockId.EventChest).name).toBe('Ивентовый сундук');
    expect(getBlockDefinition(BlockId.EventChest).renderShape).toBe('chest');
    expect(getBlockDefinition(BlockId.EventChest).soundGroup).toBe('wood');
  });
});
