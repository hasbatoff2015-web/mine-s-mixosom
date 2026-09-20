import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { CHUNK_SIZE, PLAYER_WIDTH, WORLDGEN_VERSION, chunkKey, floorDiv } from '../src/core/constants';
import { requiredChunkKeys } from '../src/core/worldLoading';
import { Vec3 } from '../src/math/vec3';
import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator } from '../src/world/Generator';
import { placeBlockAt, type UseSimulationContext } from '../src/gameplay';
import { Inventory, createItemStack } from '../src/inventory';
import { PlayerController, type PlayerInputSource } from '../src/player';
import type { MoveInput } from '../src/input/InputManager';
import { moveVoxelBody } from '../src/entities/voxelPhysics';
import { resolveExplosion } from '../src/world/Explosion';
import { WorldBorderRenderer, WORLD_BORDER_COLOR } from '../src/rendering/WorldBorderRenderer';
import { VoxelWorld } from '../src/world/World';
import {
  WORLD_BORDER_CLAIM_ERROR,
  WORLD_BORDER_CLAN_BASE_ERROR,
  WORLD_BORDER_FADE_START,
  WORLD_BORDER_HOME_SET_ERROR,
  WORLD_BORDER_HOME_TELEPORT_ERROR,
  WORLD_BORDER_TELEPORT_ERROR,
  WORLD_BORDER_MAX,
  WORLD_BORDER_MAX_ALPHA,
  WORLD_BORDER_MIN,
  clampPlayerCenterToWorldBorder,
  clipAabbAxisToWorldBorder,
  distanceToWorldBorder,
  gameplayMayMutateBlock,
  isAabbInsidePlayableWorld,
  isInsidePlayableBlock,
  isInsidePlayablePoint,
  isPlayerCenterInsidePlayableWorld,
  isVolumeInsidePlayableWorld,
  playerAabbAt,
  relocateStandingPoseInsidePlayableWorld,
  worldBorderOpacity,
} from '../src/world/worldBorder';
import { claimAnchorVolume } from '../server/services/claimAnchors';
import { clanBaseVolume } from '../server/services/clanBase';
import { clampRtpBounds, RTP_MAX, RTP_MIN } from '../server/services/rtp';
import { TeleportHistoryService, TeleportService } from '../server/services/teleport';
import {
  DEFAULT_WORLD_EVENTS_CONFIG,
  WorldEventsManager,
  type WorldEventsHost,
} from '../server/services/worldEvents';
import { emptyValidationContext } from '../server/services/spawnValidation';

const idle: MoveInput = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };

function input(movement: Partial<MoveInput> = {}, yaw = 0): PlayerInputSource {
  return { yaw, pitch: 0, movement: () => ({ ...idle, ...movement }) };
}

class BorderTestWorld {
  readonly blocks = new Map<string, BlockId>();

  set(x: number, y: number, z: number, block: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, block);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    return this.blocks.get(`${x},${y},${z}`) ?? BlockId.Air;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }

  surfaceY(x: number, z: number): number {
    for (let y = 80; y >= 0; y -= 1) {
      if (this.isSolid(x, y, z)) return y;
    }
    return 0;
  }
}

function floorAround(world: BorderTestWorld, minX: number, maxX: number, minZ: number, maxZ: number, y = 40): void {
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) world.set(x, y, z, BlockId.Stone);
  }
}

describe('playable world border helpers', () => {
  it('treats inclusive min and exclusive max block coordinates as the playable square', () => {
    expect(WORLD_BORDER_MIN).toBe(-10_000);
    expect(WORLD_BORDER_MAX).toBe(10_000);
    expect(isInsidePlayableBlock(0, 0)).toBe(true);
    expect(isInsidePlayableBlock(9999, 0)).toBe(true);
    expect(isInsidePlayableBlock(-10000, 0)).toBe(true);
    expect(isInsidePlayableBlock(10000, 0)).toBe(false);
    expect(isInsidePlayableBlock(-10001, 0)).toBe(false);
    expect(isInsidePlayableBlock(0, 9999)).toBe(true);
    expect(isInsidePlayableBlock(0, -10000)).toBe(true);
    expect(isInsidePlayableBlock(0, 10000)).toBe(false);
    expect(isInsidePlayableBlock(0, -10001)).toBe(false);
    expect(gameplayMayMutateBlock(9999, 9999)).toBe(true);
    expect(gameplayMayMutateBlock(10000, 0)).toBe(false);
  });

  it('keeps the full player AABB inside the planes', () => {
    const half = PLAYER_WIDTH / 2;
    expect(isPlayerCenterInsidePlayableWorld(0, 0)).toBe(true);
    expect(isPlayerCenterInsidePlayableWorld(WORLD_BORDER_MAX - half, 0)).toBe(true);
    expect(isPlayerCenterInsidePlayableWorld(WORLD_BORDER_MAX - half + 0.01, 0)).toBe(false);
    expect(isPlayerCenterInsidePlayableWorld(WORLD_BORDER_MIN + half, 0)).toBe(true);
    expect(isPlayerCenterInsidePlayableWorld(WORLD_BORDER_MIN + half - 0.01, 0)).toBe(false);
    const box = playerAabbAt(WORLD_BORDER_MAX - half, 0);
    expect(isAabbInsidePlayableWorld(box)).toBe(true);
    expect(box.maxX).toBeCloseTo(WORLD_BORDER_MAX, 8);
    const clamped = clampPlayerCenterToWorldBorder(10050, -12000);
    expect(clamped.x).toBeCloseTo(WORLD_BORDER_MAX - half, 8);
    expect(clamped.z).toBeCloseTo(WORLD_BORDER_MIN + half, 8);
  });

  it('requires claim and template volumes to fit entirely inside playable cells', () => {
    expect(isVolumeInsidePlayableWorld({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 })).toBe(true);
    expect(isVolumeInsidePlayableWorld({ minX: 9990, maxX: 9999, minZ: 0, maxZ: 4 })).toBe(true);
    expect(isVolumeInsidePlayableWorld({ minX: 9990, maxX: 10000, minZ: 0, maxZ: 4 })).toBe(false);
    expect(isVolumeInsidePlayableWorld({ minX: -10000, maxX: -9990, minZ: 0, maxZ: 4 })).toBe(true);
    const ironInside = claimAnchorVolume(0, 64, 0, 'iron_block');
    expect(isVolumeInsidePlayableWorld(ironInside)).toBe(true);
    const ironCrossing = claimAnchorVolume(9995, 64, 0, 'iron_block');
    expect(ironCrossing.maxX).toBeGreaterThanOrEqual(WORLD_BORDER_MAX);
    expect(isVolumeInsidePlayableWorld(ironCrossing)).toBe(false);
    const diamondCrossing = claimAnchorVolume(9975, 64, 0, 'diamond_block');
    expect(isVolumeInsidePlayableWorld(diamondCrossing)).toBe(false);
    expect(isVolumeInsidePlayableWorld(clanBaseVolume(9975, 64, 0))).toBe(false);
    expect(WORLD_BORDER_CLAIM_ERROR).toMatch(/границ/);
    expect(WORLD_BORDER_CLAN_BASE_ERROR).toMatch(/клан/);
    expect(WORLD_BORDER_HOME_SET_ERROR).toMatch(/Дом/);
  });

  it('keeps RTP candidates inside the canonical exclusive max', () => {
    expect(RTP_MIN).toBe(WORLD_BORDER_MIN);
    expect(RTP_MAX).toBe(WORLD_BORDER_MAX - 1);
    const clamped = clampRtpBounds({ minX: -50_000, maxX: 50_000, minZ: -50_000, maxZ: 50_000 });
    expect(clamped).toEqual({ minX: RTP_MIN, maxX: RTP_MAX, minZ: RTP_MIN, maxZ: RTP_MAX });
  });

  it('clips only the outward displacement component', () => {
    const half = PLAYER_WIDTH / 2;
    const maxX = WORLD_BORDER_MAX - 0.05;
    const minX = maxX - PLAYER_WIDTH;
    expect(clipAabbAxisToWorldBorder(minX, maxX, 2)).toBeCloseTo(0.05, 8);
    expect(clipAabbAxisToWorldBorder(minX, maxX, -1)).toBe(-1);
    expect(clipAabbAxisToWorldBorder(WORLD_BORDER_MIN, WORLD_BORDER_MIN + PLAYER_WIDTH, -3)).toBe(0);
    expect(distanceToWorldBorder(9990, 0)).toBe(10);
    expect(isInsidePlayablePoint(WORLD_BORDER_MAX, 0)).toBe(true);
    expect(isInsidePlayablePoint(WORLD_BORDER_MAX + 0.001, 0)).toBe(false);
    void half;
  });
});

describe('worldBorderOpacity', () => {
  it('is invisible at 50+, monotonic, and stays translucent at contact', () => {
    expect(worldBorderOpacity(150)).toBe(0);
    expect(worldBorderOpacity(100)).toBe(0);
    expect(worldBorderOpacity(WORLD_BORDER_FADE_START)).toBe(0);
    expect(worldBorderOpacity(49.9)).toBeGreaterThan(0);
    expect(worldBorderOpacity(30)).toBeGreaterThan(0);
    expect(worldBorderOpacity(10)).toBeGreaterThan(worldBorderOpacity(30));
    expect(worldBorderOpacity(0)).toBeGreaterThan(worldBorderOpacity(10));
    expect(worldBorderOpacity(0)).toBeLessThanOrEqual(WORLD_BORDER_MAX_ALPHA + 1e-9);
    expect(worldBorderOpacity(0)).toBeLessThanOrEqual(0.35);
    expect(worldBorderOpacity(0)).toBeLessThan(1);
    for (let distance = 0; distance < 50; distance += 1) {
      expect(worldBorderOpacity(distance)).toBeGreaterThanOrEqual(worldBorderOpacity(distance + 1) - 1e-9);
    }
  });
});

describe('WorldBorderRenderer', () => {
  it('creates four translucent red planes at ±10000 and hides far sides', () => {
    const scene = new THREE.Scene();
    const renderer = new WorldBorderRenderer(scene);
    expect(renderer.sideCount).toBe(4);
    expect(renderer.sideMesh('east')?.position.x).toBe(WORLD_BORDER_MAX);
    expect(renderer.sideMesh('west')?.position.x).toBe(WORLD_BORDER_MIN);
    expect(renderer.sideMesh('south')?.position.z).toBe(WORLD_BORDER_MAX);
    expect(renderer.sideMesh('north')?.position.z).toBe(WORLD_BORDER_MIN);
    renderer.update(0, 0);
    for (const side of ['east', 'west', 'north', 'south'] as const) {
      const mesh = renderer.sideMesh(side)!;
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.color.getHex()).toBe(WORLD_BORDER_COLOR);
      expect(mesh.visible).toBe(false);
      expect(material.opacity).toBe(0);
    }
    renderer.update(9990, 0);
    expect(renderer.sideMesh('east')?.visible).toBe(true);
    expect((renderer.sideMesh('east')!.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.05);
    expect(renderer.sideMesh('west')?.visible).toBe(false);
    renderer.update(9992, 9992);
    expect(renderer.sideMesh('east')?.visible).toBe(true);
    expect(renderer.sideMesh('south')?.visible).toBe(true);
    renderer.dispose();
    expect(renderer.sideCount).toBe(0);
    expect(scene.getObjectByName('world-border')).toBeUndefined();
  });
});

describe('border movement', () => {
  it('stops the player AABB before the +X plane and still allows travel along the wall', () => {
    const world = new BorderTestWorld();
    floorAround(world, 9970, 10020, -20, 40);
    const half = PLAYER_WIDTH / 2;
    const player = new PlayerController({ position: [9988.5, 41.01, 0.5] });
    for (let tick = 0; tick < 80; tick += 1) {
      player.tick(world as unknown as VoxelWorld, input({ forward: 1 }, -Math.PI / 2), 0.05);
    }
    expect(player.position.x + half).toBeLessThanOrEqual(WORLD_BORDER_MAX + 1e-6);
    expect(player.position.x).toBeGreaterThan(9988);
    const along = player.position.x;
    for (let tick = 0; tick < 40; tick += 1) {
      player.tick(world as unknown as VoxelWorld, input({ forward: 1 }, Math.PI), 0.05);
    }
    expect(player.position.z).toBeGreaterThan(2);
    expect(player.position.x + half).toBeLessThanOrEqual(WORLD_BORDER_MAX + 1e-6);
    expect(Math.abs(player.position.x - along)).toBeLessThan(0.05);
  });

  it('clips only the outward component of a diagonal wish', () => {
    const world = new BorderTestWorld();
    floorAround(world, 9970, 10020, -20, 40);
    const half = PLAYER_WIDTH / 2;
    const player = new PlayerController({ position: [WORLD_BORDER_MAX - half - 0.02, 41.01, 0.5] });
    const startZ = player.position.z;
    for (let tick = 0; tick < 20; tick += 1) {
      player.tick(world as unknown as VoxelWorld, input({ forward: 1, right: 1 }, -Math.PI / 2), 0.05);
    }
    expect(player.position.x + half).toBeLessThanOrEqual(WORLD_BORDER_MAX + 1e-6);
    expect(player.position.z).not.toBeCloseTo(startZ, 2);
  });

  it('matches voxel-body clipping used by mobs and minecarts', () => {
    const world = new BorderTestWorld();
    floorAround(world, 9970, 10020, -8, 8);
    const position = new Vec3(9999.6, 41.01, 0.5);
    const result = moveVoxelBody(
      world as unknown as VoxelWorld,
      position,
      { x: 8, y: 0, z: 3 },
      0.05,
      { width: PLAYER_WIDTH, height: 1.8 },
    );
    expect(position.x + PLAYER_WIDTH / 2).toBeLessThanOrEqual(WORLD_BORDER_MAX + 1e-5);
    expect(result.hitX).toBe(true);
    expect(position.z).toBeGreaterThan(0.5);
  });
});

describe('border break, place and explosions', () => {
  it('allows the last inside cell and rejects the first outside cell without consuming items', () => {
    const world = new VoxelWorld('border-place');
    world.getChunk(624, 0, true);
    world.getChunk(625, 0, true);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('cobblestone', 8));
    const ctx = {
      world,
      inventory,
      selectedSlot: 0,
      gamemode: 'survival',
      yaw: 0,
      viewDirection: () => new THREE.Vector3(0, 0, 1),
      intersectsBlock: () => false,
      intersectsCollisionBoxes: () => false,
      redstone: { notifyBlockChanged: () => undefined },
    } as unknown as UseSimulationContext;
    world.setBlock(9999, 80, 0, BlockId.Air);
    world.setBlock(9999, 79, 0, BlockId.Stone);
    expect(placeBlockAt(ctx, 9999, 80, 0, BlockId.Cobblestone).ok).toBe(true);
    expect(inventory.getSlot(0)?.count).toBe(7);
    world.setBlock(10000, 80, 0, BlockId.Air);
    expect(placeBlockAt(ctx, 10000, 80, 0, BlockId.Cobblestone)).toEqual({ ok: false, reason: 'bounds' });
    expect(inventory.getSlot(0)?.count).toBe(7);
    expect(world.getBlock(10000, 80, 0, false)).not.toBe(BlockId.Cobblestone);
  });

  it('does not destroy scenery blocks past the playable plane', () => {
    const world = new VoxelWorld('border-tnt');
    world.getChunk(624, 0, true);
    world.getChunk(625, 0, true);
    const y = 50;
    world.setBlock(9998, y, 0, BlockId.Stone);
    world.setBlock(9999, y, 0, BlockId.Stone);
    world.setBlock(10000, y, 0, BlockId.Stone);
    world.setBlock(10001, y, 0, BlockId.Stone);
    const resolution = resolveExplosion(world, {
      x: 9999.5,
      y: y + 0.5,
      z: 0.5,
      radius: 4,
      power: 4,
    }, { random: () => 1 });
    const keys = new Set(resolution.destroyed.map((cell) => `${cell.x},${cell.z}`));
    expect(keys.has('10000,0')).toBe(false);
    expect(keys.has('10001,0')).toBe(false);
    expect(world.getBlock(10000, y, 0, false)).toBe(BlockId.Stone);
  });
});

describe('login relocate and world-event footprint', () => {
  it('stands a saved outside pose on solid ground inside the border', () => {
    const world = new BorderTestWorld();
    floorAround(world, 9988, 9999, -2, 2, 40);
    const pose = relocateStandingPoseInsidePlayableWorld(
      world,
      10080,
      12,
      0.4,
    );
    expect(pose.x + PLAYER_WIDTH / 2).toBeLessThanOrEqual(WORLD_BORDER_MAX + 1e-8);
    expect(isPlayerCenterInsidePlayableWorld(pose.x, pose.z)).toBe(true);
    expect(pose.y).toBeGreaterThan(40);
  });

  it('streams ordinary view-distance chunks past the playable plane', () => {
    const generator = new TerrainGenerator('alpha');
    const outsideX = WORLD_BORDER_MAX + CHUNK_SIZE;
    const column = generator.columnAt(outsideX, 0);
    expect(column.height).toBeGreaterThan(0);
    const chunk = new Chunk(floorDiv(outsideX, CHUNK_SIZE), 0);
    generator.generate(chunk);
    expect(chunk.generated).toBe(true);
    const keys = requiredChunkKeys(9980, 0, 6);
    expect(keys).toContain(chunkKey(floorDiv(9980, CHUNK_SIZE), 0));
    expect(keys).toContain(chunkKey(floorDiv(WORLD_BORDER_MAX, CHUNK_SIZE), 0));
    expect(keys).toContain(chunkKey(floorDiv(9980, CHUNK_SIZE) + 6, 0));
  });

  it('rejects world-event candidates whose footprint crosses the border', () => {
    expect(WORLDGEN_VERSION).toBe(3);
    const world = new VoxelWorld('event-border');
    const host: WorldEventsHost = {
      world,
      worldId: () => 'anarchy',
      now: () => Date.UTC(2026, 8, 21, 12, 0, 0),
      random: () => 0.5,
      spawn: () => [0, 64, 0],
      loadStore: () => ({}),
      saveStore: () => undefined,
      createValidationContext: () => emptyValidationContext(),
      homes: () => [],
      players: () => [],
      flush: () => undefined,
      markDirty: () => undefined,
      closeChestWindow: () => undefined,
      broadcast: () => undefined,
      send: () => undefined,
      log: () => undefined,
    };
    const manager = new WorldEventsManager(host);
    manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, worldBorder: WORLD_BORDER_MAX });
    manager.load();
    const template = manager.listTemplates()[0]!;
    const y = world.surfaceY(9998, 0) + 1;
    expect(manager.validateCandidate(template, { x: 9998, y, z: 0 }, 0)).toBe(false);
    const originY = world.surfaceY(24, 24) + 1;
    const nearOrigin = manager.validateCandidate(template, { x: 24, y: originY, z: 24 }, 0);
    expect(typeof nearOrigin).toBe('boolean');
  });

  it('rejects ordinary teleports whose destination is outside the playable square', () => {
    let teleported = false;
    const teleports = new TeleportService('anarchy', new TeleportHistoryService(), () => ({
      id: 'p1',
      position: () => ({ x: 0, y: 70, z: 0 }),
      teleport: () => {
        teleported = true;
        return true;
      },
      sendMessage: () => undefined,
    }));
    expect(teleports.now('p1', { x: 12_000, y: 70, z: 0 }, 'command')).toEqual({
      ok: false,
      error: WORLD_BORDER_TELEPORT_ERROR,
    });
    expect(teleported).toBe(false);
    expect(WORLD_BORDER_HOME_TELEPORT_ERROR).toMatch(/границ/);
  });
});
