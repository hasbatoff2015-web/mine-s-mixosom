import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../../src/blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y } from '../../src/core/constants';
import { VoxelWorld } from '../../src/world/World';
import { createItemStack } from '../../src/inventory';
import { EVENT_CHEST_LOOT_TABLE, generateEventChestLoot } from '../../server/services/eventLoot';
import { emptyValidationContext } from '../../server/services/spawnValidation';
import { eventProtectionVolume } from '../../server/services/eventProtection';
import { JsonFileStore } from '../../server/services/jsonStore';
import {
  DEFAULT_WORLD_EVENTS_CONFIG,
  SEARCH_RETRY_MS,
  WorldEventsManager,
  type WorldEventsHost,
} from '../../server/services/worldEvents';

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
