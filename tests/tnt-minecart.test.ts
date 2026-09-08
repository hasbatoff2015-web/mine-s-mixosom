import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, tntTextureKey } from '../src/blocks';
import { PlayerArrowManager } from '../src/combat';
import { CHUNK_SIZE, PLAYER_REACH, WALK_SPEED } from '../src/core/constants';
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
