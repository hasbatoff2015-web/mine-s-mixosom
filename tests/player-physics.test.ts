import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import type { MoveInput } from '../src/input/InputManager';
import { PlayerController, type PlayerInputSource } from '../src/player';
import type { VoxelWorld } from '../src/world/World';

class TestWorld {
  readonly blocks = new Map<string, BlockId>();
  readonly states = new Map<string, { facing?: 'north' | 'south' | 'east' | 'west'; stairHalf?: 'bottom' | 'top'; slabType?: 'bottom' | 'top' | 'double' }>();

  set(x: number, y: number, z: number, block: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, block);
  }

  setState(x: number, y: number, z: number, state: TestWorld['states'] extends Map<string, infer V> ? V : never): void {
    this.states.set(`${x},${y},${z}`, state);
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

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

describe('PlayerController voxel physics', () => {
  it('stands on a floor and slides without entering a wall', () => {
    const world = flatWorld();
    for (let y = 1; y <= 3; y += 1) {
      for (let z = -4; z <= 4; z += 1) world.set(1, y, z, BlockId.Stone);
    }
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 30; tick += 1) {
      player.tick(world as unknown as VoxelWorld, input({ forward: 1, right: 1 }), 0.05);
    }
    expect(player.onGround).toBe(true);
    expect(player.position.x).toBeLessThanOrEqual(0.700001);
    expect(player.position.z).toBeLessThan(-0.5);
  });

  it('jumps, lands and reports fall damage only beyond three blocks', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0.5, 7, 0.5] });
    const damage: number[] = [];
    for (let tick = 0; tick < 100 && !player.onGround; tick += 1) {
      player.tick(world as unknown as VoxelWorld, input(), 0.05, (amount) => damage.push(amount));
    }
    expect(player.position.y).toBeCloseTo(1, 6);
    expect(damage).toEqual([3]);
    expect(player.lastFallDistance).toBeCloseTo(6, 1);
  });

  it('uses the half-block collision height for slabs and steps onto them', () => {
    const world = flatWorld();
    world.set(1, 1, 0, BlockId.StoneSlab);
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 20 && player.position.x < 1.3; tick += 1) {
      player.tick(world as unknown as VoxelWorld, input({ right: 1 }), 0.05);
    }
    expect(player.position.x).toBeGreaterThan(1);
    expect(player.position.y).toBeCloseTo(1.5, 5);
  });

  it('walks onto east-facing stairs via generic step-up instead of treating them as a full cube', () => {
    const world = flatWorld();
    world.set(1, 1, 0, BlockId.OakStairs);
    world.setState(1, 1, 0, { facing: 'east', stairHalf: 'bottom' });
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 24 && player.position.x < 1.35; tick += 1) {
      player.tick(world as unknown as VoxelWorld, input({ right: 1 }), 0.05);
    }
    expect(player.position.x).toBeGreaterThan(1);
    expect(player.position.y).toBeGreaterThan(1.45);
  });

  it('reports a held jump only on the takeoff tick', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    const first = player.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05);
    const second = player.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05);
    expect(first.jumped).toBe(true);
    expect(second.jumped).toBe(false);
  });

  it('does not apply a normal ground jump while the player overlaps a cobweb', () => {
    const world = flatWorld();
    world.set(0, 1, 0, BlockId.Cobweb);
    const player = new PlayerController({ position: [0.5, 1, 0.5] });

    const result = player.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05);

    expect(player.inCobweb).toBe(true);
    expect(result.jumped).toBe(false);
    expect(player.position.y).toBeCloseTo(1, 6);
    expect(player.velocity.y).toBeLessThanOrEqual(0);

    world.set(0, 1, 0, BlockId.Air);
    player.tick(world as unknown as VoxelWorld, input(), 0.05);
    const afterExit = player.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05);
    expect(player.inCobweb).toBe(false);
    expect(afterExit.jumped).toBe(true);
    expect(player.velocity.y).toBeGreaterThan(0);
  });

  it('slows existing downward velocity while the player overlaps a cobweb', () => {
    const world = flatWorld();
    world.set(0, 3, 0, BlockId.Cobweb);
    const player = new PlayerController({ position: [0.5, 3, 0.5] });
    player.velocity.y = -8;

    player.tick(world as unknown as VoxelWorld, input(), 0.05);

    expect(player.inCobweb).toBe(true);
    expect(player.position.y).toBeGreaterThan(2.9);
  });

  it('clears a short fall session when grounded after repeated low-ceiling jumps', () => {
    const world = flatWorld();
    world.set(0, 3, 0, BlockId.Stone);
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    const damage: number[] = [];

    for (let jump = 0; jump < 24; jump += 1) {
      player.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05, (amount) => damage.push(amount));
      for (let tick = 0; tick < 8 && !player.onGround; tick += 1) {
        player.tick(world as unknown as VoxelWorld, input(), 0.05, (amount) => damage.push(amount));
      }
      player.tick(world as unknown as VoxelWorld, input(), 0.05, (amount) => damage.push(amount));
      expect(player.onGround).toBe(true);
      expect(player.fallDistance).toBe(0);
    }

    expect(damage).toEqual([]);
  });

  it('finishes fall tracking when the ground probe finds support without a landing collision', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0.5, 1.07, 0.5] });
    player.fallDistance = 0.25;
    player.velocity.y = -0.1;

    const result = player.tick(world as unknown as VoxelWorld, input(), 0.05);

    expect(result.landed).toBe(false);
    expect(player.onGround).toBe(true);
    expect(player.fallDistance).toBe(0);
    expect(result.fallDamage).toBe(0);
  });
});
