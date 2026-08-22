import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  CREATIVE_FLY_DOUBLE_TAP_TICKS,
  CREATIVE_FLY_SPEED,
  CREATIVE_SPRINT_FLY_SPEED,
  CREATIVE_VERTICAL_SPEED,
} from '../src/core/constants';
import type { MoveInput } from '../src/input/InputManager';
import { PlayerController, type PlayerInputSource } from '../src/player';
import {
  nextFlyWindowTicks,
  shouldAcceptFlyToggle,
} from '../src/player/creativeFlight';
import { resolvePlayerMoveInput } from '../src/core/gameplayModal';
import type { VoxelWorld } from '../src/world/World';

class TestWorld {
  readonly blocks = new Map<string, BlockId>();
  readonly states = new Map<string, { facing?: 'north' | 'south' | 'east' | 'west' }>();

  set(x: number, y: number, z: number, block: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, block);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    return this.blocks.get(`${x},${y},${z}`) ?? BlockId.Air;
  }

  getBlockState(x: number, y: number, z: number) {
    return this.states.get(`${x},${y},${z}`);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.getBlock(x, y, z) !== BlockId.Air && this.getBlock(x, y, z) !== BlockId.Water;
  }
}

const idle: MoveInput = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };

function input(movement: Partial<MoveInput> = {}, yaw = 0): PlayerInputSource {
  return { yaw, pitch: 0, movement: () => ({ ...idle, ...movement }) };
}

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -6; z <= 6; z += 1) {
    for (let x = -6; x <= 6; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

function tickJumpPulse(player: PlayerController, world: TestWorld, heldTicks = 1): void {
  for (let i = 0; i < heldTicks; i += 1) player.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05);
  player.tick(world as unknown as VoxelWorld, input(), 0.05);
}

describe('creative flight', () => {
  it('uses a 7-tick edge-detected double Space window', () => {
    expect(CREATIVE_FLY_DOUBLE_TAP_TICKS).toBe(7);
    expect(shouldAcceptFlyToggle(false, true, 0)).toBe('idle');
    expect(shouldAcceptFlyToggle(true, true, 0)).toBe('arm');
    expect(shouldAcceptFlyToggle(true, true, 3)).toBe('toggle');
    expect(shouldAcceptFlyToggle(true, false, 3)).toBe('idle');
    expect(nextFlyWindowTicks('arm', 0)).toBe(7);
    expect(nextFlyWindowTicks('idle', 7)).toBe(6);
  });

  it('does not fly in Survival and does not toggle on a single Space', () => {
    const world = flatWorld();
    const survival = new PlayerController({ position: [0.5, 1, 0.5] });
    survival.creativeFlightAllowed = false;
    tickJumpPulse(survival, world);
    tickJumpPulse(survival, world);
    expect(survival.isFlying).toBe(false);

    const creative = new PlayerController({ position: [0.5, 1, 0.5] });
    creative.creativeFlightAllowed = true;
    for (let i = 0; i < 4; i += 1) creative.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05);
    expect(creative.isFlying).toBe(false);
  });

  it('toggles on a second press within 7 ticks and times out otherwise', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.creativeFlightAllowed = true;
    tickJumpPulse(player, world);
    tickJumpPulse(player, world);
    expect(player.isFlying).toBe(true);
    for (let i = 0; i < 8; i += 1) player.tick(world as unknown as VoxelWorld, input(), 0.05);
    expect(player.isFlying).toBe(true);

    const late = new PlayerController({ position: [0.5, 1, 0.5] });
    late.creativeFlightAllowed = true;
    tickJumpPulse(late, world);
    for (let i = 0; i < 8; i += 1) late.tick(world as unknown as VoxelWorld, input(), 0.05);
    tickJumpPulse(late, world);
    expect(late.isFlying).toBe(false);
  });

  it('double Space while flying turns flight off', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0.5, 3, 0.5] });
    player.creativeFlightAllowed = true;
    player.isFlying = true;
    tickJumpPulse(player, world);
    tickJumpPulse(player, world);
    expect(player.isFlying).toBe(false);
  });

  it('ascends, descends, hovers, and sprints faster with Ctrl', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0.5, 4, 0.5] });
    player.creativeFlightAllowed = true;
    player.isFlying = true;
    player.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05);
    expect(player.velocity.y).toBeGreaterThan(0);
    player.tick(world as unknown as VoxelWorld, input({ descend: true }), 0.05);
    expect(player.velocity.y).toBeLessThan(0);
    const hover = new PlayerController({ position: [0.5, 4, 0.5] });
    hover.creativeFlightAllowed = true;
    hover.isFlying = true;
    hover.velocity.y = 2;
    for (let i = 0; i < 30; i += 1) hover.tick(world as unknown as VoxelWorld, input(), 0.05);
    expect(Math.abs(hover.velocity.y)).toBeLessThan(0.4);

    const walk = new PlayerController({ position: [0.5, 4, 0.5] });
    walk.creativeFlightAllowed = true;
    walk.isFlying = true;
    for (let i = 0; i < 20; i += 1) walk.tick(world as unknown as VoxelWorld, input({ forward: 1 }), 0.05);
    const sprint = new PlayerController({ position: [0.5, 4, 0.5] });
    sprint.creativeFlightAllowed = true;
    sprint.isFlying = true;
    for (let i = 0; i < 20; i += 1) sprint.tick(world as unknown as VoxelWorld, input({ forward: 1, flySprint: true }), 0.05);
    expect(Math.abs(sprint.velocity.z)).toBeGreaterThan(Math.abs(walk.velocity.z));
    expect(CREATIVE_SPRINT_FLY_SPEED / CREATIVE_FLY_SPEED).toBeCloseTo(2, 1);
    expect(CREATIVE_VERTICAL_SPEED).toBeGreaterThan(5);
  });

  it('keeps collision, lands to disable flight, and ignores ladders while flying', () => {
    const world = flatWorld();
    for (let y = 1; y <= 6; y += 1) world.set(2, y, 0, BlockId.Stone);
    const player = new PlayerController({ position: [0.5, 4, 0.5] });
    player.creativeFlightAllowed = true;
    player.isFlying = true;
    for (let i = 0; i < 40; i += 1) player.tick(world as unknown as VoxelWorld, input({ right: 1 }), 0.05);
    expect(player.position.x).toBeLessThan(1.75);

    const lander = new PlayerController({ position: [0.5, 1.2, 0.5] });
    lander.creativeFlightAllowed = true;
    lander.isFlying = true;
    lander.velocity.y = -2;
    for (let i = 0; i < 20; i += 1) lander.tick(world as unknown as VoxelWorld, input({ descend: true }), 0.05);
    expect(lander.onGround).toBe(true);
    expect(lander.isFlying).toBe(false);

    world.set(0, 2, 0, BlockId.Ladder);
    world.states.set('0,2,0', { facing: 'south' });
    const flyer = new PlayerController({ position: [0.5, 2, 0.5] });
    flyer.creativeFlightAllowed = true;
    flyer.isFlying = true;
    flyer.tick(world as unknown as VoxelWorld, input({ jump: true }), 0.05);
    expect(flyer.onLadder).toBe(false);
    expect(flyer.velocity.y).toBeGreaterThan(0);
  });

  it('clears flight when Creative is disallowed', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0.5, 4, 0.5] });
    player.creativeFlightAllowed = true;
    player.isFlying = true;
    player.creativeFlightAllowed = false;
    player.tick(world as unknown as VoxelWorld, input(), 0.05);
    expect(player.isFlying).toBe(false);
  });

  it('does not accept fly/movement input while a container GUI is open', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0.5, 4, 0.5] });
    player.creativeFlightAllowed = true;
    player.isFlying = true;
    const blocked = resolvePlayerMoveInput(true, {
      forward: 1, right: 0, jump: true, sprint: false, sneak: false, descend: false, flySprint: true,
    });
    expect(blocked.jump).toBe(false);
    expect(blocked.forward).toBe(0);
    player.tick(world as unknown as VoxelWorld, input(blocked), 0.05);
    expect(player.isFlying).toBe(true);
    expect(Math.abs(player.velocity.y)).toBeLessThan(0.8);
  });
});
