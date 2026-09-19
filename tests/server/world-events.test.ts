import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../../src/blocks';
import { VoxelWorld } from '../../src/world/World';
import { createItemStack } from '../../src/inventory';
import { EVENT_CHEST_LOOT_TABLE, generateEventChestLoot } from '../../server/services/eventLoot';
import {
  DEFAULT_WORLD_EVENTS_CONFIG,
  WorldEventsManager,
  type WorldEventsHost,
} from '../../server/services/worldEvents';

function memoryHost(world: VoxelWorld, extra: Partial<WorldEventsHost> = {}): WorldEventsHost & { saved: unknown; nowMs: number } {
  const host: WorldEventsHost & { saved: unknown; nowMs: number } = {
    world,
    saved: {},
    nowMs: Date.UTC(2026, 8, 19, 12, 0, 0),
    worldId: () => 'anarchy',
    now: () => host.nowMs,
    random: () => 0.42,
    spawn: () => [0, 64, 0],
    loadStore: () => host.saved,
    saveStore: (store) => { host.saved = JSON.parse(JSON.stringify(store)); },
    claimsAt: () => false,
    autoMineAt: () => false,
    specialZoneAt: () => false,
    homes: () => [],
    players: () => [],
    flush: () => undefined,
    markDirty: () => undefined,
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
  if (!result.ok) throw new Error(result.error);
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
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, unlockDelayMinutes: 5, durationMinutes: 30 });
    manager.load();
    manager.enabled = true;

    const spawned = spawnChest(manager, world);
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);
    expect(manager.isLockedChest(spawned.x, spawned.y, spawned.z)).toBe(true);
    expect(manager.isProtected(spawned.x, spawned.y, spawned.z)).toBe(true);
    const before = world.getChest(spawned.x, spawned.y, spawned.z).slots.map((slot) => slot && { ...slot });
    expect(before.some((slot) => slot?.itemId === 'tnt_powerful')).toBe(true);

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
  });

  it('restores timers after restart and cleans up if the event already expired', () => {
    const world = new VoxelWorld('world-events-restart');
    const host = memoryHost(world);
    const first = new WorldEventsManager(host);
    first.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, durationMinutes: 30 });
    first.load();
    first.enabled = true;
    const spawned = spawnChest(first, world);
    expect(first.active?.phase).toBe('spawned_locked');

    const locked = new WorldEventsManager(host);
    locked.setConfig(first.config);
    locked.load();
    locked.enabled = true;
    expect(locked.active?.phase).toBe('spawned_locked');
    expect(world.getBlock(spawned.x, spawned.y, spawned.z)).toBe(BlockId.EventChest);

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
      useServerLocalTime: false,
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

  it('rejects spawn candidates in claims, water, and special zones', () => {
    const world = new VoxelWorld('world-events-site');
    const host = memoryHost(world);
    const manager = new WorldEventsManager(host);
    manager.load();
    const template = manager.getTemplate('chest_shrine')!;
    const x = 20;
    const z = 20;
    const y = world.surfaceY(x, z) + 1;
    expect(manager.validateCandidate(template, { x, y, z }, 0)).toBe(true);

    host.claimsAt = () => true;
    expect(manager.validateCandidate(template, { x, y, z }, 0)).toBe(false);
    host.claimsAt = () => false;

    host.specialZoneAt = () => true;
    expect(manager.validateCandidate(template, { x, y, z }, 0)).toBe(false);
    host.specialZoneAt = () => false;

    world.setBlock(x, y, z, BlockId.Water);
    expect(manager.validateCandidate(template, { x, y, z }, 0)).toBe(false);
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
