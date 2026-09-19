import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, tntTextureKey, type RailShape } from '../src/blocks';
import { PlayerArrowManager } from '../src/combat';
import { CHUNK_SIZE, PLAYER_REACH, WALK_SPEED } from '../src/core/constants';
import { lerpAngle } from '../src/core/entityInterpolation';
import {
  DroppedItemManager,
  FallingBlockManager,
  MINECART_MAX_SPEED,
  MINECART_OFF_RAIL_PUSH_FACTOR,
  MINECART_PUSH_GAIN,
  MINECART_VISUAL_YAW_OFFSET,
  MinecartManager,
  MobManager,
  igniteMinecartTntFromFireArrow,
  minecartVisualEuler,
  sampleRail,
} from '../src/entities';
import { applyEntitySnapshots } from '../src/net/applyEntitySnapshots';
import { EntityInterpolationBuffer } from '../src/net/entitySnapshotInterpolation';
import { PlayerController } from '../src/player';
import { RedstoneSystem } from '../src/redstone';
import { MINECART_TNT_CARGO_NAME } from '../src/rendering/minecartGeometry';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { getTntProfile } from '../src/world/tnt';
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

function stoneAt(world: VoxelWorld, x: number, y: number, z: number): void {
  world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
  world.setBlock(x, y, z, BlockId.Stone);
}

function carts(world: VoxelWorld): MinecartManager {
  return new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
}

/** Box-Muller zeros: u=0.5, v=0.25 → no arrow spread. */
function noSpreadRandom(): () => number {
  let index = 0;
  const seq = [0.5, 0.25];
  return () => seq[index++ % 2]!;
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

describe('minecart TNT fire-arrow ignition', () => {
  it('ejects stored TNT as primed cargo of the same type without a 20/30 fall cap', () => {
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
    expect(primed.launchOriginY).toBeUndefined();
    expect(primed.maxFallBlocks).toBeUndefined();
    manager.dispose();
    redstone.dispose();
  });

  it('does not start a 20-block downward flight after fire-arrow ignition', () => {
    const world = new VoxelWorld('cart-tnt-no-fall-cap');
    emptyColumn(world, 8, 8, 2);
    stoneAt(world, 8, 79, 8);
    world.setBlock(8, 80, 8, BlockId.Rail);
    const manager = carts(world);
    const redstone = new RedstoneSystem(world);
    const cart = manager.spawn(8, 80, 8)!;
    expect(manager.insertTnt(cart, BlockId.TntPowerful)).toBe(true);
    const startY = cart.position.y;
    expect(igniteMinecartTntFromFireArrow(manager, redstone, cart)).toBe(true);
    const primed = redstone.primedTnt[0]!;
    expect(primed.blockId).toBe(BlockId.TntPowerful);
    expect(primed.maxFallBlocks).toBeUndefined();
    expect(primed.launchOriginY).toBeUndefined();
    for (let tick = 0; tick < 25; tick += 1) redstone.update(0.05);
    expect(redstone.primedTntCount).toBe(1);
    expect(startY - primed.position.y).toBeLessThan(8);
    redstone.primedTnt[0]!.fuseSeconds = 0.05;
    redstone.update(0.05);
    expect(redstone.primedTntCount).toBe(0);
    expect(redstone.consumeExplosionEvents()[0]?.blockId).toBe(BlockId.TntPowerful);
    manager.dispose();
    redstone.dispose();
  });

  it('ignites minecart TNT only from a fire arrow, not flint or an ordinary arrow', () => {
    const world = new VoxelWorld('cart-tnt-fire-arrow-only');
    for (let x = 4; x <= 6; x += 1) {
      for (let z = 4; z <= 8; z += 1) {
        stoneAt(world, x, 40, z);
        for (let above = 41; above < 48; above += 1) world.setBlock(x, above, z, BlockId.Air);
      }
    }
    world.setBlock(5, 41, 6, BlockId.Rail);
    world.setBlockState(5, 41, 6, { railShape: 'north_south' });
    const scene = new THREE.Scene();
    const manager = new MinecartManager(scene, world, new ItemVisualFactory());
    const mobs = new MobManager(scene, world, { automaticSpawning: false });
    const redstone = new RedstoneSystem(world);
    const cart = manager.spawn(5, 41, 6)!;
    expect(manager.insertTnt(cart, BlockId.TntDestructive)).toBe(true);
    expect(manager.handleFlintUse(
      { x: 5.5, y: 42.1, z: 6.5 },
      { x: 0, y: -1, z: 0 },
      PLAYER_REACH,
    )).toBe('none');
    expect(cart.variant).toBe('tnt');
    expect(cart.tntBlockId).toBe(BlockId.TntDestructive);
    expect(redstone.primedTntCount).toBe(0);

    const arrows = new PlayerArrowManager(scene, world, mobs, {
      minecarts: manager,
      random: noSpreadRandom(),
      onMinecartHit: (hit, flaming) => {
        if (flaming) igniteMinecartTntFromFireArrow(manager, redstone, hit);
      },
    });
    arrows.spawn(new THREE.Vector3(5.5, 41.55, 4.4), new THREE.Vector3(0, 0, 1), 3, 2, false, false);
    arrows.tick(0.05);
    expect(cart.variant).toBe('tnt');
    expect(cart.tntBlockId).toBe(BlockId.TntDestructive);
    expect(redstone.primedTntCount).toBe(0);

    arrows.spawn(new THREE.Vector3(5.5, 41.55, 4.4), new THREE.Vector3(0, 0, 1), 3, 2, false, true);
    arrows.tick(0.05);
    expect(cart.variant).toBe('normal');
    expect(cart.tntBlockId).toBeUndefined();
    expect(redstone.primedTntCount).toBe(1);
    expect(redstone.primedTnt[0]?.blockId).toBe(BlockId.TntDestructive);
    expect(redstone.primedTnt[0]?.launchOriginY).toBeUndefined();
    expect(redstone.primedTnt[0]?.maxFallBlocks).toBeUndefined();
    arrows.dispose();
    mobs.dispose();
    manager.dispose();
    redstone.dispose();
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

describe('minecart visual yaw', () => {
  it('turns the long local +X hull onto the rail tangent without changing cart.yaw', () => {
    const world = new VoxelWorld('cart-visual-yaw');
    emptyColumn(world, 5, 5, 2);
    stoneAt(world, 5, 40, 5);
    stoneAt(world, 8, 40, 8);
    world.setBlock(5, 41, 5, BlockId.Rail);
    world.setBlockState(5, 41, 5, { railShape: 'north_south' });
    world.setBlock(8, 41, 8, BlockId.Rail);
    world.setBlockState(8, 41, 8, { railShape: 'east_west' });
    const manager = carts(world);

    const ns = manager.spawn(5, 41, 5)!;
    expect(MINECART_VISUAL_YAW_OFFSET).toBeCloseTo(-Math.PI / 2);
    expect(ns.visual!.rotation.y).toBeCloseTo(ns.yaw + MINECART_VISUAL_YAW_OFFSET);
    const nsAlong = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ns.visual!.rotation.y);
    expect(nsAlong.x).toBeCloseTo(0);
    expect(nsAlong.z).toBeCloseTo(1);
    expect(manager.serialize().find((entry) => entry.id === ns.id)?.yaw).toBeCloseTo(ns.yaw);

    const ew = manager.spawn(8, 41, 8)!;
    expect(ew.visual!.rotation.y).toBeCloseTo(ew.yaw + MINECART_VISUAL_YAW_OFFSET);
    const ewAlong = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ew.visual!.rotation.y);
    expect(ewAlong.x).toBeCloseTo(1);
    expect(ewAlong.z).toBeCloseTo(0);
    expect(ew.yaw).not.toBeCloseTo(ew.visual!.rotation.y);

    manager.interpolateVisuals(1);
    expect(ns.visual!.rotation.y).toBeCloseTo(ns.yaw + MINECART_VISUAL_YAW_OFFSET);
    expect(ns.visual!.rotation.x).toBeCloseTo(0);
    expect(ns.visual!.rotation.z).toBeCloseTo(0);
    manager.dispose();
  });
});

describe('minecart max speed', () => {
  it('reaches 1.5× walk speed on a long straight, then brakes to a stop without reversing', () => {
    expect(MINECART_MAX_SPEED).toBeCloseTo(WALK_SPEED * 1.5);
    expect(MINECART_MAX_SPEED).toBeCloseTo(6.4755);
    const world = new VoxelWorld('cart-max-speed');
    for (let z = 0; z <= 80; z += 1) {
      emptyColumn(world, 5, z, 0);
      stoneAt(world, 5, 40, z);
      world.setBlock(5, 41, z, BlockId.Rail);
      world.setBlockState(5, 41, z, { railShape: 'north_south' });
    }
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 4)!;
    const lookSouth = Math.PI;
    manager.update(0.05, { riderId: cart.id, forward: 1, riderYaw: lookSouth });
    const first = cart.alongSpeed;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(WALK_SPEED);
    for (let tick = 0; tick < 23; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: 1, riderYaw: lookSouth });
      expect(Math.abs(cart.alongSpeed)).toBeLessThanOrEqual(MINECART_MAX_SPEED + 1e-6);
      expect(manager.isOnRail(cart)).toBe(true);
    }
    expect(cart.alongSpeed).toBeGreaterThan(WALK_SPEED);
    expect(cart.alongSpeed).toBeCloseTo(MINECART_MAX_SPEED, 5);
    expect(cart.position.z).toBeGreaterThan(8);
    const cruising = cart.alongSpeed;
    manager.update(0.05, { riderId: cart.id, forward: -1, riderYaw: lookSouth });
    expect(cart.alongSpeed).toBeLessThan(cruising);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    const released = cart.alongSpeed;
    for (let tick = 0; tick < 16; tick += 1) manager.update(0.05, { riderId: cart.id, forward: 0 });
    expect(Math.abs(cart.alongSpeed)).toBeGreaterThan(0);
    expect(Math.abs(cart.alongSpeed)).toBeLessThan(Math.abs(released));
    for (let tick = 0; tick < 40; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: -1, riderYaw: lookSouth });
    }
    expect(cart.alongSpeed).toBe(0);
    manager.dispose();
  });
});

function visualAxis(
  visual: { updateMatrixWorld?(force?: boolean): void },
  local: THREE.Vector3,
): THREE.Vector3 {
  const object = visual as THREE.Object3D;
  object.updateMatrixWorld(true);
  return local.clone().applyQuaternion(object.quaternion).normalize();
}

describe('minecart visual pose interpolation', () => {
  it('interpolates yaw at alpha 0.5 on a curved rail, not the current sim yaw', () => {
    const world = new VoxelWorld('cart-yaw-alpha');
    emptyColumn(world, 5, 6, 1);
    stoneAt(world, 5, 40, 6);
    world.setBlock(5, 41, 6, BlockId.Rail);
    world.setBlockState(5, 41, 6, { railShape: 'south_east' });
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 6)!;
    cart.alongSpeed = 6;
    manager.update(0.05);
    expect(cart.yaw).not.toBeCloseTo(cart.previousYaw, 3);
    const midYaw = lerpAngle(cart.previousYaw, cart.yaw, 0.5);
    const midPitch = lerpAngle(cart.previousPitch, cart.pitch, 0.5);
    const expected = minecartVisualEuler(midYaw, midPitch);
    manager.interpolateVisuals(0.5);
    expect(cart.visual!.position.x).toBeCloseTo((cart.previousPosition.x + cart.position.x) * 0.5, 5);
    expect(cart.visual!.position.z).toBeCloseTo((cart.previousPosition.z + cart.position.z) * 0.5, 5);
    expect(cart.visual!.rotation.y).toBeCloseTo(expected.y, 5);
    expect(cart.visual!.rotation.y).not.toBeCloseTo(cart.yaw + MINECART_VISUAL_YAW_OFFSET, 3);
    expect(cart.visual!.rotation.z).toBeCloseTo(expected.z, 5);
    manager.dispose();
  });

  it('interpolates pitch at alpha 0.5 instead of using the current sim pitch', () => {
    const world = new VoxelWorld('cart-pitch-alpha');
    emptyColumn(world, 5, 5, 1);
    stoneAt(world, 5, 40, 5);
    world.setBlock(5, 41, 5, BlockId.Rail);
    world.setBlockState(5, 41, 5, { railShape: 'north_south' });
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    cart.previousPosition.set(5.5, 41, 5.2);
    cart.position.set(5.5, 41.2, 5.5);
    cart.previousYaw = 0;
    cart.yaw = 0;
    cart.previousPitch = 0;
    cart.pitch = -Math.PI / 4;
    const expected = minecartVisualEuler(0, -Math.PI / 8);
    manager.interpolateVisuals(0.5);
    expect(cart.visual!.position.y).toBeCloseTo(41.1, 5);
    expect(cart.visual!.rotation.x).toBeCloseTo(0);
    expect(cart.visual!.rotation.z).toBeCloseTo(expected.z, 5);
    expect(cart.visual!.rotation.z).not.toBeCloseTo(-cart.pitch, 3);
    manager.dispose();
  });

  it('wraps interpolated yaw through ±π instead of the long way around', () => {
    const world = new VoxelWorld('cart-yaw-wrap');
    emptyColumn(world, 5, 5, 1);
    stoneAt(world, 5, 40, 5);
    world.setBlock(5, 41, 5, BlockId.Rail);
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    cart.previousYaw = Math.PI - 0.2;
    cart.yaw = -Math.PI + 0.2;
    cart.previousPitch = 0;
    cart.pitch = 0;
    const expected = minecartVisualEuler(lerpAngle(cart.previousYaw, cart.yaw, 0.5), 0);
    manager.interpolateVisuals(0.5);
    expect(cart.visual!.rotation.y).toBeCloseTo(expected.y, 5);
    const longWay = (cart.previousYaw + cart.yaw) * 0.5 + MINECART_VISUAL_YAW_OFFSET;
    expect(Math.abs(cart.visual!.rotation.y - longWay)).toBeGreaterThan(1);
    manager.dispose();
  });
});

describe('minecart visual slope orientation', () => {
  const slopes: readonly RailShape[] = [
    'ascending_east',
    'ascending_west',
    'ascending_north',
    'ascending_south',
  ];

  it.each(slopes)('aligns local +X with the 3D rail tangent on %s without roll', (shape) => {
    const world = new VoxelWorld(`cart-slope-${shape}`);
    emptyColumn(world, 5, 5, 1);
    stoneAt(world, 5, 40, 5);
    world.setBlock(5, 41, 5, BlockId.Rail);
    world.setBlockState(5, 41, 5, { railShape: shape });
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    const sample = sampleRail(cart.rail!, cart.progress);
    const tangent = new THREE.Vector3(sample.tangentX, sample.tangentY, sample.tangentZ).normalize();
    const forward = visualAxis(cart.visual!, new THREE.Vector3(1, 0, 0));
    const up = visualAxis(cart.visual!, new THREE.Vector3(0, 1, 0));
    const side = visualAxis(cart.visual!, new THREE.Vector3(0, 0, 1));
    expect(forward.dot(tangent), `${shape} forward`).toBeCloseTo(1, 3);
    expect(Math.sign(forward.y) || 0).toBe(Math.sign(tangent.y) || 0);
    expect(forward.y).toBeGreaterThan(0.3);
    const expectedSide = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
    expect(side.dot(expectedSide), `${shape} side`).toBeCloseTo(1, 3);
    expect(Math.abs(up.dot(tangent))).toBeLessThan(0.08);
    const euler = minecartVisualEuler(cart.yaw, cart.pitch);
    expect(cart.visual!.rotation.x).toBeCloseTo(0);
    expect(cart.visual!.rotation.y).toBeCloseTo(euler.y);
    expect(cart.visual!.rotation.z).toBeCloseTo(euler.z);
    expect(cart.visual!.rotation.z).not.toBeCloseTo(0);
    manager.dispose();
  });

  it('keeps hull heading on reverse alongSpeed so the nose is not mirrored', () => {
    const world = new VoxelWorld('cart-slope-reverse');
    emptyColumn(world, 5, 5, 1);
    stoneAt(world, 5, 40, 5);
    world.setBlock(5, 41, 5, BlockId.Rail);
    world.setBlockState(5, 41, 5, { railShape: 'ascending_east' });
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    const before = visualAxis(cart.visual!, new THREE.Vector3(1, 0, 0));
    cart.alongSpeed = -4;
    manager.update(0.05);
    manager.interpolateVisuals(1);
    const after = visualAxis(cart.visual!, new THREE.Vector3(1, 0, 0));
    expect(after.dot(before)).toBeGreaterThan(0.7);
    expect(after.y).toBeGreaterThan(0);
    manager.dispose();
  });
});
