import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, tntTextureKey } from '../src/blocks';
import { PlayerArrowManager } from '../src/combat';
import { CHUNK_SIZE, WALK_SPEED } from '../src/core/constants';
import {
  DroppedItemManager,
  FallingBlockManager,
  MINECART_OFF_RAIL_PUSH_FACTOR,
  MINECART_PUSH_GAIN,
  MinecartManager,
  MobManager,
  igniteMinecartTntFromFireArrow,
} from '../src/entities';
import { applyEntitySnapshots } from '../src/net/applyEntitySnapshots';
import { EntityInterpolationBuffer } from '../src/net/entitySnapshotInterpolation';
import { PlayerController } from '../src/player';
import { RedstoneSystem } from '../src/redstone';
import { MINECART_TNT_CARGO_NAME } from '../src/rendering/minecartGeometry';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import {
  MINECART_TNT_MAX_FALL_DESTRUCTIVE,
  MINECART_TNT_MAX_FALL_ORDINARY,
  MINECART_TNT_MAX_FALL_POWERFUL,
  MINECART_TNT_PLATFORM_CLEARANCE,
  getTntProfile,
  minecartTntFallDistance,
  minecartTntMaxFall,
} from '../src/world/tnt';
import { resolveExplosion } from '../src/world/Explosion';
import { VoxelWorld } from '../src/world/World';

function emptyColumn(world: VoxelWorld, x: number, z: number, radius = 1): void {
  world.deferredLighting = true;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const cx = x + dx;
      const cz = z + dz;
      world.getChunk(Math.floor(cx / CHUNK_SIZE), Math.floor(cz / CHUNK_SIZE));
      for (let y = 0; y < 256; y += 1) world.setBlock(cx, y, cz, BlockId.Air);
    }
  }
}

function simulateMinecartFall(
  blockId: number,
  originY: number,
  options: { readonly x?: number; readonly z?: number; readonly floorY?: number; readonly viaCart?: boolean } = {},
): { startY: number; explosionY: number; deltaY: number; blockId: number; ticks: number } {
  const x = options.x ?? 8;
  const z = options.z ?? 8;
  const world = new VoxelWorld(`fall-${blockId}-${originY}-${x}`);
  emptyColumn(world, x, z, 2);
  if (options.floorY !== undefined) stoneAt(world, x, options.floorY, z);
  const redstone = new RedstoneSystem(world);
  const manager = carts(world);
  let startY = originY;
  if (options.viaCart) {
    world.setBlock(x, originY, z, BlockId.Rail);
    const cart = manager.spawn(x, originY, z)!;
    expect(manager.insertTnt(cart, blockId)).toBe(true);
    startY = cart.position.y;
    expect(igniteMinecartTntFromFireArrow(manager, redstone, cart)).toBe(true);
  } else {
    redstone.launchMinecartTnt({ x: x + 0.5, y: originY, z: z + 0.5 }, { x: 0, y: 0, z: 0 }, blockId);
  }
  const primed = redstone.primedTnt[0]!;
  expect(primed.blockId).toBe(blockId);
  expect(primed.launchOriginY).toBe(startY);
  expect(primed.maxFallBlocks).toBe(minecartTntMaxFall(blockId));
  let ticks = 0;
  for (; ticks < 120; ticks += 1) {
    redstone.update(0.05);
    if (redstone.primedTntCount === 0) break;
  }
  expect(redstone.primedTntCount).toBe(0);
  expect(redstone.consumeExplosionEvents()).toHaveLength(1);
  const explosionY = primed.position.y;
  const deltaY = minecartTntFallDistance(startY, explosionY);
  manager.dispose();
  redstone.dispose();
  return { startY, explosionY, deltaY, blockId: primed.blockId, ticks };
}

function stoneAt(world: VoxelWorld, x: number, y: number, z: number): void {
  world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
  world.setBlock(x, y, z, BlockId.Stone);
}

function carts(world: VoxelWorld): MinecartManager {
  return new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
}

function sessionOf(world: VoxelWorld) {
  const scene = new THREE.Scene();
  const mobs = new MobManager(scene, world, { automaticSpawning: false });
  return {
    drops: new DroppedItemManager(scene, world),
    falling: new FallingBlockManager(scene, world),
    mobs,
    arrows: new PlayerArrowManager(scene, world, mobs),
    minecarts: new MinecartManager(scene, world, new ItemVisualFactory()),
    redstone: new RedstoneSystem(world),
  };
}

describe('TNT cargo types in minecarts', () => {
  it('stores ordinary, powerful and destructive TNT server-side', () => {
    const world = new VoxelWorld('cart-tnt-types');
    stoneAt(world, 5, 40, 5);
    world.setBlock(5, 41, 5, BlockId.Rail);
    const manager = carts(world);
    const ordinary = manager.spawn(5, 41, 5)!;
    expect(manager.insertTnt(ordinary, BlockId.Tnt)).toBe(true);
    expect(ordinary.tntBlockId).toBe(BlockId.Tnt);
    expect(manager.insertTnt(ordinary, BlockId.TntPowerful)).toBe(false);

    const powerful = manager.spawn(5, 41, 6)!;
    expect(manager.insertTnt(powerful, BlockId.TntPowerful)).toBe(true);
    expect(powerful.tntBlockId).toBe(BlockId.TntPowerful);
    expect(powerful.visual?.userData.tntTextureKey).toBe('block/tnt_powerful');

    const destructive = manager.spawn(5, 41, 7)!;
    expect(manager.insertTnt(destructive, BlockId.TntDestructive)).toBe(true);
    expect(destructive.tntBlockId).toBe(BlockId.TntDestructive);
    expect(destructive.visual?.userData.tntTextureKey).toBe('block/tnt_destructive');

    const saved = manager.serialize();
    expect(saved.find((entry) => entry.id === powerful.id)?.tntBlockId).toBe(BlockId.TntPowerful);
    manager.restore(saved);
    const restored = manager.get(powerful.id)!;
    expect(restored.variant).toBe('tnt');
    expect(restored.tntBlockId).toBe(BlockId.TntPowerful);
    manager.dispose();
  });

  it('shows TNT cargo immediately from a live snapshot without respawning the cart', () => {
    const world = new VoxelWorld('cart-tnt-sync');
    stoneAt(world, 5, 40, 5);
    const session = sessionOf(world);
    const interpolator = new EntityInterpolationBuffer();
    applyEntitySnapshots(session, [{
      id: 'live-cart', kind: 'minecart',
      x: 5.5, y: 41, z: 5.5, vx: 0, vy: 0, vz: 0,
      variant: 'normal',
    }], { interpolator, tick: 1, now: 1_000 });
    const cart = session.minecarts.get('live-cart')!;
    const cargo = cart.visual!.getObjectByName(MINECART_TNT_CARGO_NAME) as THREE.Object3D;
    expect(cargo.visible).toBe(false);

    applyEntitySnapshots(session, [{
      id: 'live-cart', kind: 'minecart',
      x: 5.5, y: 41, z: 5.5, vx: 0, vy: 0, vz: 0,
      variant: 'tnt', blockId: BlockId.TntDestructive,
    }], { interpolator, tick: 2, now: 1_050 });
    expect(cart.variant).toBe('tnt');
    expect(cart.tntBlockId).toBe(BlockId.TntDestructive);
    expect(cargo.visible).toBe(true);
    expect(cart.visual?.userData.tntTextureKey).toBe(tntTextureKey(BlockId.TntDestructive));

    applyEntitySnapshots(session, [{
      id: 'live-cart', kind: 'minecart',
      x: 5.5, y: 41, z: 5.5, vx: 0, vy: 0, vz: 0,
      variant: 'normal',
    }], { interpolator, tick: 3, now: 1_100 });
    expect(cart.variant).toBe('normal');
    expect(cargo.visible).toBe(false);
    session.minecarts.dispose();
    session.mobs.dispose();
    session.arrows.dispose();
    session.drops.dispose();
    session.falling.dispose();
    session.redstone.dispose();
  });

  it('uses the same cargo mesh and primed pulse model, only swapping the texture key', () => {
    const world = new VoxelWorld('cart-tnt-visual');
    stoneAt(world, 5, 40, 5);
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    const cargo = cart.visual!.getObjectByName(MINECART_TNT_CARGO_NAME) as THREE.Mesh;
    manager.insertTnt(cart, BlockId.Tnt);
    const ordinaryMaterial = cargo.material;
    manager.ejectTntCargo(cart);
    manager.insertTnt(cart, BlockId.TntPowerful);
    expect(cart.visual!.getObjectByName(MINECART_TNT_CARGO_NAME)).toBe(cargo);
    expect(cargo.material).not.toBe(ordinaryMaterial);
    expect(cart.visual?.userData.tntTextureKey).toBe('block/tnt_powerful');
    manager.dispose();
  });
});

describe('minecart TNT fire-arrow launch and fall', () => {
  it('launches each stored type as primed TNT with its own profile', () => {
    const world = new VoxelWorld('cart-tnt-launch');
    emptyColumn(world, 5, 5);
    stoneAt(world, 5, 40, 5);
    const manager = carts(world);
    const redstone = new RedstoneSystem(world);
    const cart = manager.spawn(5, 41, 5)!;
    manager.insertTnt(cart, BlockId.TntDestructive);
    expect(igniteMinecartTntFromFireArrow(manager, redstone, cart)).toBe(true);
    expect(cart.variant).toBe('normal');
    const primed = redstone.primedTnt[0]!;
    expect(primed.blockId).toBe(BlockId.TntDestructive);
    expect(getTntProfile(primed.blockId).canBreakObsidian).toBe(true);
    expect(primed.maxFallBlocks).toBe(MINECART_TNT_MAX_FALL_DESTRUCTIVE);
    expect(primed.launchOriginY).toBe(cart.position.y);
    manager.dispose();
    redstone.dispose();
  });

  it('ordinary TNT without a floor explodes after ~20 blocks of vertical fall', () => {
    const fall = simulateMinecartFall(BlockId.Tnt, 80);
    expect(fall.deltaY).toBeGreaterThanOrEqual(MINECART_TNT_MAX_FALL_ORDINARY - 1.5);
    expect(fall.deltaY).toBeLessThan(MINECART_TNT_MAX_FALL_ORDINARY + 2.5);
    expect(fall.ticks * 0.05).toBeLessThan(4);
  });

  it('powerful TNT without a floor explodes after ~30 blocks, not 20', () => {
    const fall = simulateMinecartFall(BlockId.TntPowerful, 90);
    expect(fall.deltaY).toBeGreaterThan(MINECART_TNT_MAX_FALL_ORDINARY + 2);
    expect(fall.deltaY).toBeGreaterThanOrEqual(MINECART_TNT_MAX_FALL_POWERFUL - 1.5);
    expect(fall.deltaY).toBeLessThan(MINECART_TNT_MAX_FALL_POWERFUL + 2.5);
  });

  it('destructive TNT without a floor explodes after ~30 blocks, not 20', () => {
    const fall = simulateMinecartFall(BlockId.TntDestructive, 90);
    expect(fall.deltaY).toBeGreaterThan(MINECART_TNT_MAX_FALL_ORDINARY + 2);
    expect(fall.deltaY).toBeGreaterThanOrEqual(MINECART_TNT_MAX_FALL_DESTRUCTIVE - 1.5);
    expect(fall.deltaY).toBeLessThan(MINECART_TNT_MAX_FALL_DESTRUCTIVE + 2.5);
  });

  it('explodes on a floor closer than the max fall instead of continuing to 20/30', () => {
    const fall = simulateMinecartFall(BlockId.Tnt, 68, { floorY: 60 });
    expect(fall.deltaY).toBeGreaterThan(MINECART_TNT_PLATFORM_CLEARANCE);
    expect(fall.deltaY).toBeLessThan(MINECART_TNT_MAX_FALL_ORDINARY - 5);
    expect(fall.explosionY).toBeGreaterThan(59);
    expect(fall.explosionY).toBeLessThan(62);
  });

  it('uses eject Y as startY, not world Y=20/30', () => {
    const high = simulateMinecartFall(BlockId.Tnt, 100);
    const low = simulateMinecartFall(BlockId.Tnt, 55);
    expect(high.startY).toBe(100);
    expect(low.startY).toBe(55);
    expect(high.deltaY).toBeGreaterThanOrEqual(MINECART_TNT_MAX_FALL_ORDINARY - 1.5);
    expect(high.deltaY).toBeLessThan(MINECART_TNT_MAX_FALL_ORDINARY + 2.5);
    expect(low.deltaY).toBeGreaterThanOrEqual(MINECART_TNT_MAX_FALL_ORDINARY - 1.5);
    expect(low.deltaY).toBeLessThan(MINECART_TNT_MAX_FALL_ORDINARY + 2.5);
    expect(Math.abs(high.deltaY - low.deltaY)).toBeLessThan(1);
    expect(high.explosionY).not.toBeCloseTo(20, 0);
    expect(low.explosionY).not.toBeCloseTo(20, 0);
  });

  it('falls ~20 blocks from a rail sitting on a support block over a void', () => {
    const world = new VoxelWorld('cart-tnt-rail-support');
    emptyColumn(world, 8, 8, 2);
    stoneAt(world, 8, 79, 8);
    world.setBlock(8, 80, 8, BlockId.Rail);
    const manager = carts(world);
    const redstone = new RedstoneSystem(world);
    const cart = manager.spawn(8, 80, 8)!;
    expect(manager.insertTnt(cart, BlockId.Tnt)).toBe(true);
    const startY = cart.position.y;
    expect(igniteMinecartTntFromFireArrow(manager, redstone, cart)).toBe(true);
    const primed = redstone.primedTnt[0]!;
    expect(primed.launchOriginY).toBe(startY);
    for (let tick = 0; tick < 120; tick += 1) {
      redstone.update(0.05);
      if (redstone.primedTntCount === 0) break;
    }
    expect(redstone.primedTntCount).toBe(0);
    const deltaY = minecartTntFallDistance(startY, primed.position.y);
    expect(deltaY).toBeGreaterThan(MINECART_TNT_PLATFORM_CLEARANCE + 5);
    expect(deltaY).toBeGreaterThanOrEqual(MINECART_TNT_MAX_FALL_ORDINARY - 1.5);
    expect(deltaY).toBeLessThan(MINECART_TNT_MAX_FALL_ORDINARY + 2.5);
    manager.dispose();
    redstone.dispose();
  });

  it('keeps the cart TNT blockId on the primed entity until explosion', () => {
    const fall = simulateMinecartFall(BlockId.TntPowerful, 88, { viaCart: true });
    expect(fall.blockId).toBe(BlockId.TntPowerful);
    expect(fall.deltaY).toBeGreaterThan(MINECART_TNT_MAX_FALL_ORDINARY + 2);
  });

  it('keeps the second TNT type when a minecart blast chains', () => {
    const world = new VoxelWorld('cart-tnt-chain');
    emptyColumn(world, 6, 6);
    emptyColumn(world, 7, 6);
    stoneAt(world, 6, 40, 6);
    stoneAt(world, 7, 40, 6);
    world.setBlock(7, 41, 6, BlockId.TntPowerful);
    const redstone = new RedstoneSystem(world);
    redstone.launchMinecartTnt({ x: 6.5, y: 41, z: 6.5 }, { x: 0, y: 0, z: 0 }, BlockId.Tnt);
    redstone.primedTnt[0]!.fuseSeconds = 0.05;
    redstone.primedTnt[0]!.velocity.set(0, 0, 0);
    redstone.update(0.05);
    const event = redstone.consumeExplosionEvents()[0];
    expect(event).toBeDefined();
    const result = resolveExplosion(world, {
      x: event!.position.x, y: event!.position.y, z: event!.position.z,
      radius: event!.radius, power: event!.power, profile: getTntProfile(event!.blockId),
    }, { random: () => 1 });
    const chained = result.chainedTnt.find((tnt) => tnt.blockId === BlockId.TntPowerful);
    expect(chained).toBeDefined();
    redstone.primeTnt(chained!.x, chained!.y, chained!.z, chained!.fuseSeconds, {
      blockAlreadyRemoved: true,
      blockId: chained!.blockId,
    });
    expect(redstone.primedTnt.some((entity) => entity.blockId === BlockId.TntPowerful)).toBe(true);
    expect(getTntProfile(BlockId.TntPowerful).radius).toBe(6);
    redstone.dispose();
  });
});

describe('off-rail minecart player push', () => {
  it('keeps on-rail push strength and applies 50% impulse off rails, including TNT carts', () => {
    const world = new VoxelWorld('cart-push-off');
    world.getChunk(0, 0);
    for (let z = 4; z <= 8; z += 1) {
      world.setBlock(5, 40, z, BlockId.Stone);
      world.setBlock(5, 41, z, BlockId.Rail);
      world.setBlockState(5, 41, z, { railShape: 'north_south' });
    }
    const manager = carts(world);
    const onRail = manager.spawn(5, 41, 6)!;
    const player = new PlayerController({ position: [5.5, 41, 6.15] });
    player.velocity.set(0, 0, 2);
    manager.tryPushFromPlayer(player);
    const onRailDelta = onRail.alongSpeed;
    expect(onRailDelta).toBeCloseTo(2 * MINECART_PUSH_GAIN, 5);
    expect(onRailDelta).toBeGreaterThan(0);

    world.setBlock(7, 40, 6, BlockId.Stone);
    world.setBlock(7, 41, 6, BlockId.Air);
    const offRail = manager.spawn(7, 41, 6)!;
    expect(offRail.rail).toBeUndefined();
    manager.insertTnt(offRail, BlockId.TntPowerful);
    const pusher = new PlayerController({ position: [7.5, 41, 6.15] });
    pusher.velocity.set(0, 0, 2);
    const vzBefore = offRail.velocity.z;
    manager.tryPushFromPlayer(pusher);
    const offRailDelta = offRail.velocity.z - vzBefore;
    expect(offRailDelta).toBeCloseTo(onRailDelta * MINECART_OFF_RAIL_PUSH_FACTOR, 5);
    expect(Math.hypot(offRail.velocity.x, offRail.velocity.z)).toBeLessThanOrEqual(WALK_SPEED + 1e-6);

    const destructive = manager.spawn(7, 41, 7)!;
    manager.insertTnt(destructive, BlockId.TntDestructive);
    const pusher2 = new PlayerController({ position: [7.5, 41, 7.15] });
    pusher2.velocity.set(0, 0, 2);
    manager.tryPushFromPlayer(pusher2);
    expect(destructive.velocity.z).toBeGreaterThan(0);
    manager.dispose();
  });
});
