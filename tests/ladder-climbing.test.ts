import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  LADDER_CLIMB_SPEED,
  LADDER_MAX_DESCENT_SPEED,
  desiredHorizontalWish,
  findLadderContact,
  isClimbIntent,
  ladderClimbBox,
  ladderTowardSupport,
  ladderVerticalVelocity,
} from '../src/player/ladderMotion';
import { PlayerController, type PlayerInputSource } from '../src/player/PlayerController';
import type { MoveInput } from '../src/input/InputManager';
import { getBlockDefinition } from '../src/blocks';
import type { VoxelWorld } from '../src/world/World';
import { LADDER_DEPTH } from '../src/rendering/specialBlockGeometry';

class TestWorld {
  readonly blocks = new Map<string, BlockId>();
  readonly states = new Map<string, { facing?: 'north' | 'south' | 'east' | 'west' }>();

  set(x: number, y: number, z: number, block: BlockId, facing?: 'north' | 'south' | 'east' | 'west'): void {
    this.blocks.set(`${x},${y},${z}`, block);
    if (facing) this.states.set(`${x},${y},${z}`, { facing });
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    return this.blocks.get(`${x},${y},${z}`) ?? BlockId.Air;
  }

  getBlockState(x: number, y: number, z: number) {
    return this.states.get(`${x},${y},${z}`);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }
}

const idle: MoveInput = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };

function input(movement: Partial<MoveInput> = {}, yaw = 0, pitch = 0): PlayerInputSource {
  return { yaw, pitch, movement: () => ({ ...idle, ...movement }) };
}

/** East-facing ladder at (1,y,0) against a wall at (0,y,0). Player stands in x>1. */
function eastLadderWall(height = 8): TestWorld {
  const world = new TestWorld();
  for (let x = -2; x <= 4; x += 1) world.set(x, 0, 0, BlockId.Stone);
  for (let y = 1; y <= height; y += 1) {
    world.set(0, y, 0, BlockId.Stone);
    world.set(1, y, 0, BlockId.Ladder, 'east');
  }
  return world;
}

function asWorld(world: TestWorld): VoxelWorld {
  return world as unknown as VoxelWorld;
}

describe('ladder contact and intent math', () => {
  it('does not treat a distant body as ladder contact', () => {
    const world = eastLadderWall();
    const away = { minX: 3.2, minY: 1, minZ: -0.3, maxX: 3.8, maxY: 2.8, maxZ: 0.3 };
    expect(findLadderContact(world, away)).toBeUndefined();
  });

  it('detects contact only against the thin east climb volume', () => {
    const world = eastLadderWall();
    const touching = { minX: 1.0, minY: 1, minZ: -0.3, maxX: 1.6, maxY: 2.8, maxZ: 0.3 };
    const contact = findLadderContact(world, touching);
    expect(contact?.facing).toBe('east');
    expect(contact?.towardX).toBe(-1);
    const farSide = { minX: 1.55, minY: 1, minZ: -0.3, maxX: 2.15, maxY: 2.8, maxZ: 0.3 };
    expect(findLadderContact(world, farSide)).toBeUndefined();
  });

  it('resolves N/S/E/W toward-support vectors', () => {
    expect(ladderTowardSupport('east').x).toBe(-1);
    expect(ladderTowardSupport('east').z).toBeCloseTo(0, 8);
    expect(ladderTowardSupport('west').x).toBe(1);
    expect(ladderTowardSupport('south').z).toBe(-1);
    expect(ladderTowardSupport('north').z).toBe(1);
    expect(ladderClimbBox(0, 0, 0, 'east').maxX - ladderClimbBox(0, 0, 0, 'east').minX)
      .toBeGreaterThan(LADDER_DEPTH);
    expect(ladderClimbBox(0, 0, 0, 'east').maxX - ladderClimbBox(0, 0, 0, 'east').minX)
      .toBeLessThan(0.5);
  });

  it('treats movement into the support as climb intent for any camera yaw', () => {
    const toward = ladderTowardSupport('east');
    const faceWall = desiredHorizontalWish(Math.PI / 2, 1, 0);
    expect(isClimbIntent(faceWall.x, faceWall.z, toward.x, toward.z)).toBe(true);
    const backToWall = desiredHorizontalWish(-Math.PI / 2, -1, 0);
    expect(isClimbIntent(backToWall.x, backToWall.z, toward.x, toward.z)).toBe(true);
    const away = desiredHorizontalWish(Math.PI / 2, -1, 0);
    expect(isClimbIntent(away.x, away.z, toward.x, toward.z)).toBe(false);
    const along = desiredHorizontalWish(Math.PI / 2, 0, 1);
    expect(isClimbIntent(along.x, along.z, toward.x, toward.z)).toBe(false);
  });

  it('maps climb / sneak / descent / jump-keep correctly', () => {
    expect(ladderVerticalVelocity({ climbIntent: true, sneak: false, keepJump: false, currentY: 0 }))
      .toBe(LADDER_CLIMB_SPEED);
    expect(ladderVerticalVelocity({ climbIntent: false, sneak: true, keepJump: false, currentY: -8 }))
      .toBe(0);
    expect(ladderVerticalVelocity({ climbIntent: false, sneak: false, keepJump: false, currentY: -40 }))
      .toBe(-LADDER_MAX_DESCENT_SPEED);
    expect(ladderVerticalVelocity({ climbIntent: false, sneak: false, keepJump: true, currentY: 8.4 }))
      .toBe(8.4);
  });

  it('does not treat stairs or plain walls as ladders', () => {
    const world = new TestWorld();
    world.set(0, 0, 0, BlockId.Stone);
    world.set(1, 1, 0, BlockId.OakStairs, 'east');
    world.set(0, 1, 0, BlockId.Stone);
    const body = { minX: 1.0, minY: 1, minZ: -0.3, maxX: 1.6, maxY: 2.8, maxZ: 0.3 };
    expect(findLadderContact(world, body)).toBeUndefined();
    const wallBody = { minX: 0.7, minY: 1, minZ: -0.3, maxX: 1.3, maxY: 2.8, maxZ: 0.3 };
    expect(findLadderContact(world, wallBody)).toBeUndefined();
  });
});

describe('ladder climbing movement', () => {
  it('climbs when pressing into an east ladder with W while facing it', () => {
    const world = eastLadderWall();
    const player = new PlayerController({ position: [1.3, 1, 0.5] });
    const startY = player.position.y;
    for (let tick = 0; tick < 8; tick += 1) {
      player.tick(asWorld(world), input({ forward: 1 }, Math.PI / 2), 0.05);
    }
    expect(player.onLadder).toBe(true);
    expect(player.position.y).toBeGreaterThan(startY + 0.6);
    expect(player.velocity.y).toBeCloseTo(LADDER_CLIMB_SPEED, 5);
  });

  it('climbs when facing away and pressing S into the same ladder', () => {
    const world = eastLadderWall();
    const player = new PlayerController({ position: [1.3, 1, 0.5] });
    const startY = player.position.y;
    for (let tick = 0; tick < 8; tick += 1) {
      player.tick(asWorld(world), input({ forward: -1 }, -Math.PI / 2), 0.05);
    }
    expect(player.onLadder).toBe(true);
    expect(player.position.y).toBeGreaterThan(startY + 0.6);
  });

  it('does not climb when moving away from the ladder', () => {
    const world = eastLadderWall();
    const player = new PlayerController({ position: [1.3, 2, 0.5] });
    player.tick(asWorld(world), input({ forward: 1 }, -Math.PI / 2), 0.05);
    expect(player.velocity.y).toBeLessThanOrEqual(0);
  });

  it('slides down slowly with no input and clamps a fast fall', () => {
    const world = eastLadderWall();
    const player = new PlayerController({ position: [1.3, 4, 0.5] });
    player.velocity.y = -40;
    player.tick(asWorld(world), input(), 0.05);
    expect(player.onLadder).toBe(true);
    expect(player.velocity.y).toBeCloseTo(-LADDER_MAX_DESCENT_SPEED, 5);
    expect(player.fallDistance).toBe(0);
    const held = new PlayerController({ position: [1.3, 4, 0.5] });
    held.tick(asWorld(world), input({ sneak: true }), 0.05);
    expect(held.velocity.y).toBe(0);
  });

  it('resumes gravity after losing ladder contact', () => {
    const world = eastLadderWall();
    const player = new PlayerController({ position: [3.5, 4, 0.5] });
    player.tick(asWorld(world), input(), 0.05);
    player.tick(asWorld(world), input(), 0.05);
    player.tick(asWorld(world), input(), 0.05);
    expect(player.onLadder).toBe(false);
    expect(player.velocity.y).toBeLessThan(-3.1);
  });

  it('climbs north/south/west ladders with into-wall input', () => {
    const cases: Array<{
      facing: 'north' | 'south' | 'west';
      wall: [number, number, number];
      ladder: [number, number, number];
      start: [number, number, number];
      yaw: number;
    }> = [
      { facing: 'west', wall: [2, 2, 0], ladder: [1, 2, 0], start: [1.7, 1, 0.5], yaw: -Math.PI / 2 },
      { facing: 'south', wall: [0, 2, 0], ladder: [0, 2, 1], start: [0.5, 1, 1.3], yaw: 0 },
      { facing: 'north', wall: [0, 2, 2], ladder: [0, 2, 1], start: [0.5, 1, 1.7], yaw: Math.PI },
    ];
    for (const sample of cases) {
      const world = new TestWorld();
      for (let x = -2; x <= 3; x += 1) {
        for (let z = -2; z <= 3; z += 1) world.set(x, 0, z, BlockId.Stone);
      }
      for (let y = 1; y <= 6; y += 1) {
        world.set(sample.wall[0], y, sample.wall[2], BlockId.Stone);
        world.set(sample.ladder[0], y, sample.ladder[2], BlockId.Ladder, sample.facing);
      }
      const player = new PlayerController({ position: sample.start });
      expect(findLadderContact(world, player.aabb)?.facing, `${sample.facing} contact`).toBe(sample.facing);
      const startY = player.position.y;
      for (let tick = 0; tick < 10; tick += 1) {
        player.tick(asWorld(world), input({ forward: 1 }, sample.yaw), 0.05);
      }
      expect(player.onLadder, sample.facing).toBe(true);
      expect(player.position.y, sample.facing).toBeGreaterThan(startY + 0.4);
    }
  });

  it('does not set onLadder when walking oak stairs', () => {
    const world = new TestWorld();
    for (let x = -2; x <= 4; x += 1) world.set(x, 0, 0, BlockId.Stone);
    world.set(1, 1, 0, BlockId.OakStairs, 'east');
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 12; tick += 1) {
      player.tick(asWorld(world), input({ right: 1 }), 0.05);
    }
    expect(player.onLadder).toBe(false);
  });
});
