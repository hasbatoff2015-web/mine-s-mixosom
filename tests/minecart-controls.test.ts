import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, type RailShape } from '../src/blocks';
import { CHUNK_SIZE, WALK_SPEED } from '../src/core/constants';
import {
  MINECART_MAX_SPEED,
  MinecartManager,
  collectMinecartPassengers,
  extraMinecartOccupants,
  findMinecartPassenger,
} from '../src/entities';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { VoxelWorld } from '../src/world/World';

const LOOK_SOUTH = Math.PI;
const LOOK_NORTH = 0;
const LOOK_EAST = -Math.PI / 2;
const LOOK_WEST = Math.PI / 2;
const DT = 0.05;

function carts(world: VoxelWorld): MinecartManager {
  return new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
}

function nsTrack(world: VoxelWorld, x: number, y: number, z0: number, z1: number): void {
  world.deferredLighting = true;
  world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z0 / CHUNK_SIZE));
  world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z1 / CHUNK_SIZE));
  for (let z = z0; z <= z1; z += 1) {
    world.setBlock(x, y - 1, z, BlockId.Stone);
    world.setBlock(x, y, z, BlockId.Rail);
    world.setBlockState(x, y, z, { railShape: 'north_south' });
  }
}

function hold(
  manager: MinecartManager,
  cartId: string,
  ticks: number,
  forward: number,
  yaw: number,
): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    manager.update(DT, { riderId: cartId, forward, riderYaw: yaw });
  }
}

describe('minecart occupancy helpers', () => {
  it('keeps one live passenger per cart and ignores disconnected riders', () => {
    const players = [
      { id: 'a', connected: true, ridingCartId: 'cart-1' },
      { id: 'b', connected: true, ridingCartId: 'cart-1' },
      { id: 'c', connected: false, ridingCartId: 'cart-2' },
      { id: 'd', connected: true, survival: { dead: true }, ridingCartId: 'cart-2' },
      { id: 'e', connected: true, ridingCartId: 'cart-2' },
    ];
    expect(findMinecartPassenger(players, 'cart-1')?.id).toBe('a');
    expect(findMinecartPassenger(players, 'cart-1', 'a')?.id).toBe('b');
    expect(collectMinecartPassengers(players).get('cart-1')).toBe('a');
    expect(collectMinecartPassengers(players).get('cart-2')).toBe('e');
    expect(extraMinecartOccupants(players).map((player) => player.id)).toEqual(['b']);
  });
});

describe('minecart W latch and S brake', () => {
  it('does not reverse W when the camera turns 180° while moving', () => {
    const world = new VoxelWorld('cart-camera-w');
    nsTrack(world, 5, 41, 2, 40);
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 4)!;
    hold(manager, cart.id, 8, 1, LOOK_SOUTH);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    const before = cart.alongSpeed;
    hold(manager, cart.id, 8, 1, LOOK_NORTH);
    expect(cart.alongSpeed).toBeGreaterThanOrEqual(before - 1e-6);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    manager.dispose();
  });

  it('represses W in the current travel direction while still moving', () => {
    const world = new VoxelWorld('cart-repress-w');
    nsTrack(world, 5, 41, 2, 40);
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 4)!;
    hold(manager, cart.id, 8, 1, LOOK_SOUTH);
    hold(manager, cart.id, 4, 0, LOOK_SOUTH);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    const coasting = cart.alongSpeed;
    manager.update(DT, { riderId: cart.id, forward: 1, riderYaw: LOOK_NORTH });
    expect(cart.alongSpeed).toBeGreaterThan(coasting);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    manager.dispose();
  });

  it('uses S only as a brake to zero and holds the cart stopped', () => {
    const world = new VoxelWorld('cart-s-brake');
    nsTrack(world, 5, 41, 2, 50);
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 4)!;
    hold(manager, cart.id, 20, 1, LOOK_SOUTH);
    expect(cart.alongSpeed).toBeCloseTo(MINECART_MAX_SPEED, 5);
    let previous = cart.alongSpeed;
    for (let tick = 0; tick < 20; tick += 1) {
      manager.update(DT, { riderId: cart.id, forward: -1, riderYaw: LOOK_SOUTH });
      expect(cart.alongSpeed).toBeLessThanOrEqual(previous + 1e-6);
      expect(cart.alongSpeed).toBeGreaterThanOrEqual(0);
      previous = cart.alongSpeed;
    }
    expect(cart.alongSpeed).toBe(0);
    hold(manager, cart.id, 8, -1, LOOK_NORTH);
    expect(cart.alongSpeed).toBe(0);
    manager.dispose();
  });

  it('reverses only after a full stop and a new W press', () => {
    const world = new VoxelWorld('cart-reverse-w');
    nsTrack(world, 5, 41, 2, 50);
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 20)!;
    hold(manager, cart.id, 12, 1, LOOK_SOUTH);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    hold(manager, cart.id, 20, -1, LOOK_SOUTH);
    expect(cart.alongSpeed).toBe(0);
    hold(manager, cart.id, 2, 0, LOOK_NORTH);
    hold(manager, cart.id, 8, 1, LOOK_NORTH);
    expect(cart.alongSpeed).toBeLessThan(0);
    manager.dispose();
  });

  it('ignores camera spin while W is held on a straight and around a corner', () => {
    const world = new VoxelWorld('cart-spin');
    world.deferredLighting = true;
    nsTrack(world, 5, 41, 4, 8);
    for (let x = 6; x <= 18; x += 1) {
      world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(8 / CHUNK_SIZE));
      world.setBlock(x, 40, 8, BlockId.Stone);
      world.setBlock(x, 41, 8, BlockId.Rail);
      world.setBlockState(x, 41, 8, { railShape: 'east_west' });
    }
    world.setBlock(5, 41, 8, BlockId.Rail);
    world.setBlockState(5, 41, 8, { railShape: 'south_east' });
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    const yaws = [LOOK_SOUTH, LOOK_EAST, LOOK_NORTH, LOOK_WEST, LOOK_SOUTH];
    hold(manager, cart.id, 4, 1, LOOK_SOUTH);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    for (const yaw of yaws) {
      const before = cart.alongSpeed;
      manager.update(DT, { riderId: cart.id, forward: 1, riderYaw: yaw });
      expect(Math.sign(cart.alongSpeed)).toBe(Math.sign(before));
      expect(cart.alongSpeed).not.toBe(0);
    }
    for (let tick = 0; tick < 40; tick += 1) {
      const yaw = yaws[tick % yaws.length]!;
      const prevVx = cart.velocity.x;
      const prevVz = cart.velocity.z;
      manager.update(DT, { riderId: cart.id, forward: 1, riderYaw: yaw });
      expect(manager.isOnRail(cart), `tick ${tick}`).toBe(true);
      expect(Math.abs(cart.alongSpeed), `tick ${tick}`).toBeGreaterThan(0.05);
      expect(prevVx * cart.velocity.x + prevVz * cart.velocity.z, `tick ${tick}`).toBeGreaterThan(-0.05);
    }
    expect(cart.position.x).toBeGreaterThan(5.6);
    manager.dispose();
  });

  it('does not recapture launch direction from a held W after stopping', () => {
    const world = new VoxelWorld('cart-held-w-stop');
    nsTrack(world, 5, 41, 2, 40);
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 20)!;
    hold(manager, cart.id, 6, 1, LOOK_EAST);
    expect(cart.alongSpeed).toBe(0);
    hold(manager, cart.id, 6, 1, LOOK_SOUTH);
    expect(cart.alongSpeed).toBe(0);
    hold(manager, cart.id, 1, 0, LOOK_SOUTH);
    hold(manager, cart.id, 6, 1, LOOK_SOUTH);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    manager.dispose();
  });
});

describe('minecart slope W/S', () => {
  const slopes: readonly RailShape[] = [
    'ascending_north',
    'ascending_south',
    'ascending_east',
    'ascending_west',
  ];

  function ramp(world: VoxelWorld, shape: RailShape): { x: number; y: number; z: number } {
    world.deferredLighting = true;
    const origin = { x: 8, y: 41, z: 8 };
    for (let i = 0; i < 6; i += 1) {
      const x = origin.x + (shape === 'ascending_east' ? i : shape === 'ascending_west' ? -i : 0);
      const z = origin.z + (shape === 'ascending_south' ? i : shape === 'ascending_north' ? -i : 0);
      const y = origin.y + i;
      world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
      world.setBlock(x, y - 1, z, BlockId.Stone);
      world.setBlock(x, y, z, BlockId.Rail);
      world.setBlockState(x, y, z, { railShape: shape });
    }
    return origin;
  }

  function launchYaw(shape: RailShape): number {
    if (shape === 'ascending_south') return LOOK_SOUTH;
    if (shape === 'ascending_north') return LOOK_NORTH;
    if (shape === 'ascending_east') return LOOK_EAST;
    return LOOK_WEST;
  }

  it.each(slopes)('latches W on %s and holds a stop with S against gravity', (shape) => {
    const world = new VoxelWorld(`cart-slope-ctrl-${shape}`);
    const origin = ramp(world, shape);
    const manager = carts(world);
    const cart = manager.spawn(origin.x, origin.y, origin.z)!;
    const yaw = launchYaw(shape);
    hold(manager, cart.id, 8, 1, yaw);
    const moving = cart.alongSpeed;
    expect(Math.abs(moving)).toBeGreaterThan(0.05);
    const travel = Math.sign(moving);
    hold(manager, cart.id, 4, 1, yaw + Math.PI);
    expect(Math.sign(cart.alongSpeed)).toBe(travel);
    hold(manager, cart.id, 24, -1, yaw + Math.PI);
    expect(cart.alongSpeed).toBe(0);
    hold(manager, cart.id, 6, -1, yaw);
    expect(cart.alongSpeed).toBe(0);
    const parked = { x: cart.position.x, y: cart.position.y, z: cart.position.z };
    hold(manager, cart.id, 4, 0, yaw);
    expect(Math.abs(cart.position.y - parked.y) + Math.abs(cart.position.x - parked.x)
      + Math.abs(cart.position.z - parked.z)).toBeGreaterThan(0.001);
    manager.dispose();
  });
});

describe('per-cart minecart controls', () => {
  it('updates every cart once with independent rider input', () => {
    const world = new VoxelWorld('cart-two-controls');
    nsTrack(world, 4, 41, 2, 30);
    nsTrack(world, 8, 41, 2, 30);
    const manager = carts(world);
    const a = manager.spawn(4, 41, 4)!;
    const b = manager.spawn(8, 41, 4)!;
    const controls = new Map([
      [a.id, { throttle: 1, riderYaw: LOOK_SOUTH }],
      [b.id, { throttle: 1, riderYaw: LOOK_SOUTH }],
    ]);
    for (let tick = 0; tick < 8; tick += 1) manager.update(DT, { controls });
    expect(a.alongSpeed).toBeGreaterThan(1);
    expect(b.alongSpeed).toBeGreaterThan(1);
    controls.set(a.id, { throttle: -1, riderYaw: LOOK_SOUTH });
    const aBefore = a.alongSpeed;
    const bBefore = b.alongSpeed;
    for (let tick = 0; tick < 6; tick += 1) manager.update(DT, { controls });
    expect(a.alongSpeed).toBeLessThan(aBefore);
    expect(b.alongSpeed).toBeGreaterThanOrEqual(bBefore - 1e-6);
    manager.dispose();
  });
});

describe('minecart max speed invariant', () => {
  it('keeps the on-rail cap at 1.5× walk speed', () => {
    expect(MINECART_MAX_SPEED).toBeCloseTo(WALK_SPEED * 1.5);
    expect(MINECART_MAX_SPEED).toBeCloseTo(6.4755);
  });
});
