import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, floorDiv } from '../src/core/constants';
import {
  CAVE_HOSTILE_DENSITY_RADIUS,
  MAX_NEW_CAVE_HOSTILES_PER_CHUNK_EVENT,
  MOB_HURT_FLASH_SECONDS,
  MobManager,
  SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR,
  applyMobHurtTint,
  mobHurtFlashIntensity,
} from '../src/entities';
import { VoxelWorld } from '../src/world/World';
import { mulberry32 } from '../src/world/noise';

function prepareWorld(seed: string, radius: number, mode: 'solid' | 'cave' | 'lava-cave' | 'water-cave'): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.setViewCenter(8, 8, radius);
  for (let cz = -radius; cz <= radius; cz += 1) {
    for (let cx = -radius; cx <= radius; cx += 1) {
      const chunk = world.getChunk(cx, cz)!;
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          fillColumnInto(chunk, lx, lz, mode);
        }
      }
      chunk.skyReady = false;
      chunk.blockLightReady = false;
      chunk.skyFillCursor = 0;
    }
  }
  return world;
}

function fillColumnInto(
  chunk: { set(x: number, y: number, z: number, block: BlockId): void },
  lx: number,
  lz: number,
  mode: 'solid' | 'cave' | 'lava-cave' | 'water-cave',
): void {
  const surface = 40;
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    let block = BlockId.Air;
    if (y < surface) block = BlockId.Stone;
    else if (y === surface) block = BlockId.GrassBlock;
    if (mode !== 'solid' && y >= 8 && y <= 12) block = BlockId.Air;
    if (mode === 'cave' && y === 7) block = BlockId.Stone;
    if (mode === 'lava-cave' && y >= 8 && y <= 12) block = BlockId.Lava;
    if (mode === 'lava-cave' && y === 7) block = BlockId.Stone;
    if (mode === 'water-cave' && y >= 8 && y <= 12) block = BlockId.Water;
    if (mode === 'water-cave' && y === 7) block = BlockId.Stone;
    chunk.set(lx, y, lz, block);
  }
}

function lightFor(daylight: number, y: number): number {
  if (y < 20) return 0;
  return daylight < 0.45 ? 3 : 15;
}

function runSpawns(options: {
  seed: number;
  mode: 'solid' | 'cave';
  daylight: number;
  ticks: number;
  surfaceFactor?: number;
  interval?: number;
  radius?: number;
  hostileCap?: number;
  maxMobs?: number;
}): {
  hostile: number;
  passive: number;
  caveHostiles: number;
  surfaceHostiles: number;
  hostileSpawns: number;
} {
  const world = prepareWorld(`spawn-${options.seed}`, options.radius ?? 2, options.mode);
  let hostileSpawns = 0;
  const manager = new MobManager(new THREE.Scene(), world, {
    automaticSpawning: true,
    spawnIntervalSeconds: options.interval ?? 0.05,
    surfaceHostileSpawnFactor: options.surfaceFactor ?? SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR,
    random: mulberry32(options.seed),
    hostileCap: options.hostileCap ?? 28,
    passiveCap: 20,
    maxMobs: options.maxMobs ?? 48,
    onSpawn: (mob) => {
      if (mob.definition.disposition === 'hostile') hostileSpawns += 1;
    },
  });
  const player = new THREE.Vector3(8.5, options.mode === 'cave' ? 9 : 41, 8.5);
  for (let tick = 0; tick < options.ticks; tick += 1) {
    manager.update(options.interval ?? 0.05, {
      playerPosition: player,
      daylight: options.daylight,
      lightLevelAt: (position) => lightFor(options.daylight, position.y),
    });
  }
  let caveHostiles = 0;
  let surfaceHostiles = 0;
  for (const mob of manager.entities) {
    if (!mob.alive || mob.definition.disposition !== 'hostile') continue;
    if (mob.position.y < 20) caveHostiles += 1;
    else surfaceHostiles += 1;
  }
  const result = {
    hostile: manager.countByDisposition('hostile'),
    passive: manager.countByDisposition('passive'),
    caveHostiles,
    surfaceHostiles,
    hostileSpawns,
  };
  manager.dispose();
  return result;
}

describe('hostile spawn balance', () => {
  it('keeps the accepted surface-night factor and cave density constants', () => {
    expect(SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR).toBe(0.5);
    expect(MAX_NEW_CAVE_HOSTILES_PER_CHUNK_EVENT).toBe(1);
    expect(CAVE_HOSTILE_DENSITY_RADIUS).toBe(12);
    expect(MOB_HURT_FLASH_SECONDS).toBe(0.22);
    expect(mobHurtFlashIntensity(0.22)).toBe(1);
    const tint = applyMobHurtTint([0.4, 0.4, 0.4], 1);
    expect(tint[0]).toBeGreaterThan(tint[1]);
  });

  it('cuts night surface hostiles to about half of the unrestricted factor', () => {
    const ticks = 48;
    const seeds = [901, 902, 903];
    let oldTotal = 0;
    let newTotal = 0;
    for (const seed of seeds) {
      oldTotal += runSpawns({
        seed, mode: 'solid', daylight: 0.2, ticks, surfaceFactor: 1, hostileCap: 80, maxMobs: 80,
      }).hostileSpawns;
      newTotal += runSpawns({
        seed, mode: 'solid', daylight: 0.2, ticks, surfaceFactor: 0.5, hostileCap: 80, maxMobs: 80,
      }).hostileSpawns;
    }
    expect(oldTotal).toBeGreaterThan(20);
    expect(newTotal).toBeGreaterThan(8);
    const ratio = newTotal / oldTotal;
    expect(ratio, `ratio=${ratio.toFixed(3)} old=${oldTotal} new=${newTotal}`).toBeGreaterThan(0.35);
    expect(ratio, `ratio=${ratio.toFixed(3)} old=${oldTotal} new=${newTotal}`).toBeLessThan(0.7);
  }, 20_000);

  it('does not change daytime surface-only passive spawning when the night factor changes', () => {
    const ticks = 80;
    const a = runSpawns({ seed: 407, mode: 'solid', daylight: 1, ticks, surfaceFactor: 0.5 });
    const b = runSpawns({ seed: 407, mode: 'solid', daylight: 1, ticks, surfaceFactor: 1 });
    expect(a.hostile).toBe(0);
    expect(b.hostile).toBe(0);
    expect(a.passive).toBeGreaterThan(0);
    expect(a.passive).toBe(b.passive);
  });

  it('spawns cave hostiles in dark underground air and not in lava or water', () => {
    const cave = runSpawns({ seed: 220, mode: 'cave', daylight: 1, ticks: 80, surfaceFactor: 0.5 });
    const solidDay = runSpawns({ seed: 220, mode: 'solid', daylight: 1, ticks: 80, surfaceFactor: 0.5 });
    expect(solidDay.hostile).toBe(0);
    expect(cave.caveHostiles).toBeGreaterThan(solidDay.hostile);
    expect(cave.caveHostiles).toBeGreaterThan(2);
    expect(cave.surfaceHostiles).toBe(0);

    const lavaWorld = prepareWorld('spawn-lava', 2, 'lava-cave');
    const lavaManager = new MobManager(new THREE.Scene(), lavaWorld, {
      automaticSpawning: true,
      spawnIntervalSeconds: 0.05,
      random: mulberry32(11),
    });
    for (let tick = 0; tick < 80; tick += 1) {
      lavaManager.update(0.05, {
        playerPosition: new THREE.Vector3(8.5, 9, 8.5),
        daylight: 1,
        lightLevelAt: () => 0,
      });
    }
    expect(lavaManager.countByDisposition('hostile')).toBe(0);
    lavaManager.dispose();

    const waterWorld = prepareWorld('spawn-water', 2, 'water-cave');
    const waterManager = new MobManager(new THREE.Scene(), waterWorld, {
      automaticSpawning: true,
      spawnIntervalSeconds: 0.05,
      random: mulberry32(12),
    });
    for (let tick = 0; tick < 80; tick += 1) {
      waterManager.update(0.05, {
        playerPosition: new THREE.Vector3(8.5, 9, 8.5),
        daylight: 1,
        lightLevelAt: () => 0,
      });
    }
    expect(waterManager.countByDisposition('hostile')).toBe(0);
    waterManager.dispose();
  });

  it('requires cave darkness, solid floor, headroom, and a minimum player distance', () => {
    const world = prepareWorld('spawn-rules', 2, 'cave');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const player = new THREE.Vector3(8.5, 9, 8.5);
    let spawned = 0;
    for (let tick = 0; tick < 40; tick += 1) {
      manager.update(0.05, {
        playerPosition: player,
        daylight: 1,
        lightLevelAt: () => 0,
      });
    }
    expect(manager.count).toBe(0);

    const auto = new MobManager(new THREE.Scene(), world, {
      automaticSpawning: true,
      spawnIntervalSeconds: 0.05,
      minimumSpawnDistance: 14,
      maximumSpawnDistance: 34,
      random: mulberry32(44),
    });
    for (let tick = 0; tick < 80; tick += 1) {
      auto.update(0.05, {
        playerPosition: player,
        daylight: 1,
        lightLevelAt: (position) => lightFor(1, position.y),
      });
    }
    for (const mob of auto.entities) {
      if (mob.definition.disposition !== 'hostile') continue;
      spawned += 1;
      const dx = mob.position.x - player.x;
      const dz = mob.position.z - player.z;
      expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(13.5);
      expect(world.getBlock(Math.floor(mob.position.x), Math.floor(mob.position.y) - 1, Math.floor(mob.position.z))).toBe(BlockId.Stone);
      expect(world.getBlock(Math.floor(mob.position.x), Math.floor(mob.position.y), Math.floor(mob.position.z))).toBe(BlockId.Air);
      expect(world.skyLightAt(Math.floor(mob.position.x), Math.floor(mob.position.y), Math.floor(mob.position.z))).toBeLessThanOrEqual(7);
    }
    expect(spawned).toBeGreaterThan(0);
    manager.dispose();
    auto.dispose();
  });

  it('spawns at most one new cave hostile per chunk per event and respects local density', () => {
    const world = prepareWorld('spawn-density', 2, 'cave');
    const perEvent = new Map<string, number>();
    let eventId = 0;
    const manager = new MobManager(new THREE.Scene(), world, {
      automaticSpawning: true,
      spawnIntervalSeconds: 0.05,
      random: mulberry32(77),
      onSpawn: (mob) => {
        if (mob.definition.disposition !== 'hostile') return;
        const key = `${eventId}:${floorDiv(Math.floor(mob.position.x), CHUNK_SIZE)},${floorDiv(Math.floor(mob.position.z), CHUNK_SIZE)}`;
        perEvent.set(key, (perEvent.get(key) ?? 0) + 1);
      },
    });
    const player = new THREE.Vector3(8.5, 9, 8.5);
    for (let tick = 0; tick < 120; tick += 1) {
      eventId += 1;
      manager.update(0.05, {
        playerPosition: player,
        daylight: 1,
        lightLevelAt: () => 0,
      });
    }
    expect(Math.max(0, ...perEvent.values())).toBeLessThanOrEqual(MAX_NEW_CAVE_HOSTILES_PER_CHUNK_EVENT);
    const clustered = manager.entities.filter((mob) => mob.alive && mob.definition.disposition === 'hostile');
    for (const mob of clustered) {
      let nearby = 0;
      for (const other of clustered) {
        if (other === mob) continue;
        const dx = other.position.x - mob.position.x;
        const dz = other.position.z - mob.position.z;
        if (dx * dx + dz * dz <= 4) nearby += 1;
      }
      expect(nearby).toBeLessThan(3);
    }
    expect(manager.countByDisposition('hostile')).toBeLessThanOrEqual(28);
    manager.dispose();
  });

  it('allows a later cave spawn after the previous hostile dies', () => {
    const world = prepareWorld('spawn-respawn', 2, 'cave');
    const manager = new MobManager(new THREE.Scene(), world, {
      automaticSpawning: true,
      spawnIntervalSeconds: 0.05,
      random: mulberry32(91),
      hostileCap: 28,
    });
    const player = new THREE.Vector3(8.5, 9, 8.5);
    const context = {
      playerPosition: player,
      daylight: 1 as const,
      lightLevelAt: () => 0,
    };
    for (let tick = 0; tick < 40; tick += 1) manager.update(0.05, context);
    const first = manager.entities.find((mob) => mob.definition.disposition === 'hostile' && mob.alive);
    expect(first).toBeDefined();
    const id = first!.id;
    manager.damage(first!, 1000, { source: 'player' });
    expect(first!.alive).toBe(false);
    for (let tick = 0; tick < 20; tick += 1) manager.update(0.05, context);
    expect(manager.get(id)).toBeUndefined();
    for (let tick = 0; tick < 80; tick += 1) manager.update(0.05, context);
    expect(manager.entities.some((mob) => mob.alive && mob.definition.disposition === 'hostile' && mob.id !== id)).toBe(true);
    manager.dispose();
  }, 15_000);

  it('keeps the global hostile cap bounded in the active area', () => {
    const result = runSpawns({ seed: 55, mode: 'cave', daylight: 0.2, ticks: 120, surfaceFactor: 0.5 });
    expect(result.hostile).toBeLessThanOrEqual(28);
    expect(result.hostile + result.passive).toBeLessThanOrEqual(48);
  });
});
