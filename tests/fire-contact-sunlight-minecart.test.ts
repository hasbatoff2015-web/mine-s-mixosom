import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import {
  FIRE_ARROW_IGNITE_TICKS,
  FIRE_DAMAGE_INTERVAL_TICKS,
  flamingArrowBlockHit,
} from '../src/combat';
import { CHUNK_SIZE, WALK_SPEED, WORLD_HEIGHT } from '../src/core/constants';
import { findCraftingRecipe, getCraftingResult, CRAFTING_RECIPES } from '../src/crafting';
import {
  isMinecartEntityVisual,
  MinecartManager,
  MobManager,
  TNT_MINECART_EXPLOSION_POWER,
  TNT_MINECART_EXPLOSION_RADIUS,
  TNT_MINECART_FUSE_TICKS,
  entryProgress,
} from '../src/entities';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { PlayerController } from '../src/player';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import {
  isolatedRailShapeFromYaw,
  railTextureYaw,
  resolveRailShape,
} from '../src/rendering/specialBlockGeometry';
import { SurvivalSystem } from '../src/survival';
import { allCraftingBookEntries } from '../src/ui/recipeBook';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

const grid = (...rows: readonly (readonly (string | null)[])[]): readonly (string | null)[] => rows.flat();

function platform(world: VoxelWorld, x0: number, z0: number, x1: number, z1: number, y = 40): void {
  world.getChunk(Math.floor(x0 / CHUNK_SIZE), Math.floor(z0 / CHUNK_SIZE));
  world.getChunk(Math.floor(x1 / CHUNK_SIZE), Math.floor(z1 / CHUNK_SIZE));
  for (let x = x0; x <= x1; x += 1) {
    for (let z = z0; z <= z1; z += 1) {
      world.setBlock(x, y, z, BlockId.Stone);
      for (let above = y + 1; above < WORLD_HEIGHT; above += 1) world.setBlock(x, above, z, BlockId.Air);
    }
  }
}

function setSkyColumn(world: VoxelWorld, x: number, z: number, value: number, maxY = WORLD_HEIGHT - 1): void {
  const chunk = world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), false);
  if (!chunk) return;
  chunk.skyReady = true;
  const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  for (let y = 0; y <= maxY; y += 1) chunk.skyLight[Chunk.index(lx, y, lz)] = value;
}

function carts(world: VoxelWorld): MinecartManager {
  return new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
}

describe('fire contact and independent burn sources', () => {
  it('damages a player standing in Fire once per second and stops when they leave', () => {
    const survival = new SurvivalSystem({ hunger: 10, saturation: 0 });
    for (let tick = 0; tick < FIRE_DAMAGE_INTERVAL_TICKS; tick += 1) {
      survival.tick(0.05, { inFire: true });
    }
    expect(survival.health).toBe(19);
    expect(survival.contactFire).toBe(true);
    expect(survival.isOnFire).toBe(true);
    const after = survival.health;
    for (let tick = 0; tick < 12; tick += 1) survival.tick(0.05, { inFire: false });
    expect(survival.contactFire).toBe(false);
    expect(survival.isOnFire).toBe(false);
    expect(survival.health).toBe(after);
  });

  it('damages a mob inside Fire and stops contact burn immediately after leaving', () => {
    const world = new VoxelWorld('fire-contact-mob');
    platform(world, 3, 3, 8, 8);
    world.setBlock(5, 41, 5, BlockId.Fire);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const cow = manager.spawn('cow', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    const before = cow.health;
    for (let tick = 0; tick < 22; tick += 1) {
      cow.position.set(5.5, 41, 5.5);
      cow.velocity.set(0, 0, 0);
      manager.update(0.05, { daylight: 0.2 });
    }
    expect(cow.contactBurning).toBe(true);
    expect(cow.health).toBeLessThan(before);
    cow.position.set(7.5, 41, 7.5);
    cow.velocity.set(0, 0, 0);
    manager.update(0.05, { daylight: 0.2 });
    expect(cow.contactBurning).toBe(false);
    const left = cow.health;
    for (let tick = 0; tick < 12; tick += 1) manager.update(0.05, { daylight: 0.2 });
    expect(cow.health).toBe(left);
    manager.dispose();
  });

  it('keeps Fire Arrow burn after leaving a Fire cell, and water extinguishes the arrow timer', () => {
    const survival = new SurvivalSystem();
    survival.igniteFromArrow(FIRE_ARROW_IGNITE_TICKS);
    survival.tick(0.05, { inFire: true });
    expect(survival.contactFire).toBe(true);
    expect(survival.arrowFireTicks).toBeGreaterThan(0);
    survival.tick(0.05, { inFire: false });
    expect(survival.contactFire).toBe(false);
    expect(survival.arrowFireTicks).toBeGreaterThan(90);
    expect(survival.isOnFire).toBe(true);
    survival.tick(0.05, { inFire: false, inWater: true });
    expect(survival.arrowFireTicks).toBe(0);
    expect(survival.isOnFire).toBe(false);
  });

  it('keeps a mob Fire Arrow burn after leaving Fire, independent of contact', () => {
    const world = new VoxelWorld('mob-arrow-fire');
    platform(world, 4, 4, 8, 8);
    world.setBlock(5, 41, 5, BlockId.Fire);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const cow = manager.spawn('cow', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    manager.damage(cow, 1, { source: 'projectile', igniteTicks: FIRE_ARROW_IGNITE_TICKS });
    cow.position.set(5.5, 41, 5.5);
    cow.velocity.set(0, 0, 0);
    manager.update(0.05, { daylight: 0.2 });
    expect(cow.contactBurning).toBe(true);
    expect(cow.fireTicks).toBeGreaterThan(90);
    cow.position.set(7.5, 41, 7.5);
    cow.velocity.set(0, 0, 0);
    manager.update(0.05, { daylight: 0.2 });
    expect(cow.contactBurning).toBe(false);
    expect(cow.fireTicks).toBeGreaterThan(80);
    expect(cow.isOnFire).toBe(true);
    manager.dispose();
  });
});

describe('sunlight burning for all hostile mobs', () => {
  function spawnHostile(kind: 'zombie' | 'creeper' | 'spider', sky: number, water = false) {
    const world = new VoxelWorld(`sun-${kind}-${sky}`);
    platform(world, 4, 4, 10, 10);
    setSkyColumn(world, 6, 6, sky);
    if (water) {
      world.setBlock(6, 41, 6, BlockId.Water);
      world.setBlock(6, 42, 6, BlockId.Water);
    }
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const mob = manager.spawn(kind, new THREE.Vector3(6.5, 41, 6.5), { force: true })!;
    return { world, manager, mob };
  }

  it('burns any hostile under direct daylight', () => {
    const { manager, mob } = spawnHostile('creeper', 15);
    manager.update(0.05, { daylight: 1 });
    expect(mob.sunlightBurning).toBe(true);
    expect(mob.isOnFire).toBe(true);
    const before = mob.health;
    for (let tick = 0; tick < 22; tick += 1) manager.update(0.05, { daylight: 1 });
    expect(mob.health).toBeLessThan(before);
    manager.dispose();
  });

  it('does not burn a hostile under a roof', () => {
    const { manager, mob } = spawnHostile('zombie', 0);
    manager.update(0.05, { daylight: 1 });
    expect(mob.sunlightBurning).toBe(false);
    expect(mob.isOnFire).toBe(false);
    manager.dispose();
  });

  it('does not burn a hostile standing in water', () => {
    const { manager, mob } = spawnHostile('spider', 15, true);
    manager.update(0.05, { daylight: 1 });
    expect(mob.sunlightBurning).toBe(false);
    manager.dispose();
  });

  it('does not burn passive mobs or the player from daylight', () => {
    const world = new VoxelWorld('sun-passive');
    platform(world, 4, 4, 8, 8);
    setSkyColumn(world, 5, 5, 15);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const cow = manager.spawn('cow', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    manager.update(0.05, { daylight: 1 });
    expect(cow.sunlightBurning).toBe(false);
    expect(cow.isOnFire).toBe(false);
    manager.dispose();
    const survival = new SurvivalSystem();
    for (let tick = 0; tick < 40; tick += 1) survival.tick(0.05, { inFire: false });
    expect(survival.health).toBe(20);
    expect(survival.isOnFire).toBe(false);
  });

  it('does not burn hostiles at night even under open sky', () => {
    const { manager, mob } = spawnHostile('zombie', 15);
    manager.update(0.05, { daylight: 0.2 });
    expect(mob.sunlightBurning).toBe(false);
    manager.dispose();
  });
});

describe('rail orientation mapping', () => {
  it('orients an isolated rail from player facing, rotated 90° from the old always-NS default', () => {
    expect(isolatedRailShapeFromYaw(0)).toBe('north_south');
    expect(isolatedRailShapeFromYaw(Math.PI)).toBe('north_south');
    expect(isolatedRailShapeFromYaw(-Math.PI / 2)).toBe('east_west');
    expect(isolatedRailShapeFromYaw(Math.PI / 2)).toBe('east_west');
  });

  it('keeps logical NS/EW matching visual texture yaw without swapping curves or slopes', () => {
    expect(railTextureYaw('north_south')).toBe(0);
    expect(railTextureYaw('east_west')).toBeCloseTo(Math.PI / 2);
    expect(railTextureYaw('north_east')).toBe(0);
    expect(railTextureYaw('south_west')).toBe(0);
    expect(railTextureYaw('ascending_north')).toBe(0);
    expect(railTextureYaw('ascending_south')).toBe(0);
    expect(railTextureYaw('ascending_east')).toBeCloseTo(Math.PI / 2);
    expect(railTextureYaw('ascending_west')).toBeCloseTo(Math.PI / 2);
  });

  it('autoconnects NS, EW, curves and ascending without the EW UV swap changing topology', () => {
    const world = new VoxelWorld('rail-topology');
    platform(world, 4, 4, 10, 10);
    for (let z = 5; z <= 8; z += 1) world.setBlock(6, 41, z, BlockId.Rail);
    expect(resolveRailShape(world, 6, 41, 6)).toBe('north_south');

    world.setBlock(7, 41, 6, BlockId.Rail);
    world.setBlock(8, 41, 6, BlockId.Rail);
    expect(resolveRailShape(world, 7, 41, 6)).toBe('east_west');

    world.setBlock(6, 41, 5, BlockId.Air);
    world.setBlock(6, 41, 7, BlockId.Air);
    world.setBlock(6, 41, 8, BlockId.Air);
    world.setBlock(6, 41, 6, BlockId.Rail);
    world.setBlock(6, 41, 5, BlockId.Rail);
    world.setBlock(7, 41, 6, BlockId.Rail);
    expect(resolveRailShape(world, 6, 41, 6)).toBe('north_east');

    world.setBlock(9, 41, 6, BlockId.Stone);
    world.setBlock(9, 42, 6, BlockId.Rail);
    world.setBlock(8, 41, 6, BlockId.Rail);
    expect(resolveRailShape(world, 8, 41, 6)).toBe('ascending_east');
  });

  it('maps rail entry from the previous cell offset, not world coordinates', () => {
    expect(entryProgress('north_south', 0, 0, -1)).toBe(0);
    expect(entryProgress('north_south', 0, 0, 1)).toBe(1);
    expect(entryProgress('east_west', -1, 0, 0)).toBe(0);
    expect(entryProgress('east_west', 1, 0, 0)).toBe(1);
  });
});

describe('minecart 3D entity, riding and rail motion', () => {
  it('places a 3D cart entity rather than an item billboard and snaps it to the rail', () => {
    const world = new VoxelWorld('cart-visual');
    platform(world, 4, 4, 8, 10);
    world.setBlock(5, 41, 6, BlockId.Rail);
    world.setBlockState(5, 41, 6, { railShape: 'north_south' });
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 6)!;
    expect(isMinecartEntityVisual(cart.visual)).toBe(true);
    expect(cart.visual.userData.heldMeshKind).toBeUndefined();
    expect(cart.visual.children.length).toBeGreaterThan(5);
    expect(cart.position.x).toBeCloseTo(5.5, 3);
    expect(cart.position.z).toBeCloseTo(6.5, 3);
    expect(cart.rail?.shape).toBe('north_south');
    manager.dispose();
  });

  it('accelerates with W, brakes/reverses with S, caps near walk speed and coasts after release', () => {
    const world = new VoxelWorld('cart-ws');
    world.getChunk(0, 0);
    world.getChunk(0, 1);
    world.getChunk(0, 2);
    platform(world, 4, 4, 6, 40);
    for (let z = 5; z <= 39; z += 1) {
      world.setBlock(5, 41, z, BlockId.Rail);
      world.setBlockState(5, 41, z, { railShape: 'north_south' });
    }
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 6)!;
    const lookSouth = Math.PI;
    manager.update(0.05, { riderId: cart.id, forward: 1, riderYaw: lookSouth });
    const first = cart.alongSpeed;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(WALK_SPEED);
    for (let tick = 0; tick < 6; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: 1, riderYaw: lookSouth });
    }
    expect(cart.alongSpeed).toBeGreaterThan(first);
    for (let tick = 0; tick < 12; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: 1, riderYaw: lookSouth });
    }
    expect(cart.alongSpeed).toBeGreaterThan(3);
    expect(cart.alongSpeed).toBeLessThanOrEqual(WALK_SPEED + 1e-3);
    expect(cart.rail).toBeDefined();
    expect(cart.position.z).toBeGreaterThan(7);
    expect(cart.position.z).toBeLessThan(20);
    const cruising = cart.alongSpeed;
    manager.update(0.05, { riderId: cart.id, forward: -1, riderYaw: lookSouth });
    expect(cart.alongSpeed).toBeLessThan(cruising);
    const released = cart.alongSpeed;
    for (let tick = 0; tick < 16; tick += 1) manager.update(0.05, { riderId: cart.id, forward: 0 });
    expect(Math.abs(cart.alongSpeed)).toBeGreaterThan(0);
    expect(Math.abs(cart.alongSpeed)).toBeLessThan(Math.abs(released));
    for (let tick = 0; tick < 24; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: -1, riderYaw: lookSouth });
    }
    expect(cart.alongSpeed).toBeLessThan(0);
    const xOnRail = cart.position.x;
    for (let tick = 0; tick < 8; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: 1, strafe: 1, riderYaw: lookSouth });
    }
    expect(cart.position.x).toBeCloseTo(xOnRail, 3);
    manager.dispose();
  });

  it('gains speed downhill and loses speed uphill while remaining climbable with W', () => {
    const world = new VoxelWorld('cart-slope');
    platform(world, 4, 4, 6, 8);
    world.setBlock(5, 41, 5, BlockId.Rail);
    world.setBlockState(5, 41, 5, { railShape: 'ascending_south' });
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    cart.progress = 0.2;
    cart.alongSpeed = 1.2;
    const up = cart.alongSpeed;
    manager.update(0.05);
    expect(cart.alongSpeed).toBeLessThan(up);
    cart.alongSpeed = -0.4;
    const down = cart.alongSpeed;
    manager.update(0.05);
    expect(cart.alongSpeed).toBeLessThan(down);
    cart.alongSpeed = 0;
    cart.progress = 0.08;
    manager.update(0.05);
    const startY = cart.position.y;
    for (let tick = 0; tick < 30; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: 1, riderYaw: Math.PI });
    }
    expect(cart.position.y).toBeGreaterThan(startY);
    manager.dispose();
  });

  it('lets the player push a stationary cart along the rail but not sideways off it', () => {
    const world = new VoxelWorld('cart-push');
    platform(world, 4, 4, 6, 10);
    for (let z = 5; z <= 9; z += 1) {
      world.setBlock(5, 41, z, BlockId.Rail);
      world.setBlockState(5, 41, z, { railShape: 'north_south' });
    }
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 6)!;
    const player = new PlayerController({ position: [5.5, 41, 6.15] });
    player.velocity.set(0, 0, 2);
    manager.tryPushFromPlayer(player);
    expect(cart.alongSpeed).toBeGreaterThan(0);
    const startX = cart.position.x;
    cart.alongSpeed = 0;
    player.velocity.set(0, 0, -2);
    manager.tryPushFromPlayer(player);
    expect(cart.alongSpeed).toBeLessThan(0);
    cart.alongSpeed = 0;
    player.velocity.set(3, 0, 0);
    manager.tryPushFromPlayer(player);
    expect(Math.abs(cart.alongSpeed)).toBeLessThan(0.05);
    manager.update(0.05);
    expect(cart.position.x).toBeCloseTo(startX, 3);
    manager.dispose();
  });

  it('follows a curve and an ascending rail, including a chunk border', () => {
    const world = new VoxelWorld('cart-path');
    platform(world, 4, 4, 8, 8);
    world.getChunk(0, 1);
    platform(world, 5, 15, 5, 18, 40);
    world.setBlock(5, 41, 6, BlockId.Rail);
    world.setBlock(5, 41, 5, BlockId.Rail);
    world.setBlock(6, 41, 6, BlockId.Rail);
    world.setBlockState(5, 41, 6, { railShape: resolveRailShape(world, 5, 41, 6) });
    expect(resolveRailShape(world, 5, 41, 6)).toBe('north_east');
    const manager = carts(world);
    const curve = manager.spawn(5, 41, 6)!;
    curve.alongSpeed = 4;
    const startX = curve.position.x;
    const startZ = curve.position.z;
    for (let tick = 0; tick < 40; tick += 1) manager.update(0.05);
    expect(Math.abs(curve.position.x - startX) + Math.abs(curve.position.z - startZ)).toBeGreaterThan(0.3);

    for (let z = 14; z <= 18; z += 1) {
      world.setBlock(5, 40, z, BlockId.Stone);
      world.setBlock(5, 41, z, BlockId.Rail);
      world.setBlockState(5, 41, z, { railShape: 'north_south' });
    }
    const border = manager.spawn(5, 41, 15)!;
    border.alongSpeed = 3;
    const z0 = border.position.z;
    for (let tick = 0; tick < 16; tick += 1) manager.update(0.05);
    expect(border.position.z).toBeGreaterThan(z0);
    expect(border.position.z).toBeGreaterThan(16);
    manager.dispose();
  });

  it('saves variant, fuse and velocity, then snaps back onto the rail', () => {
    const world = new VoxelWorld('cart-save');
    platform(world, 4, 4, 6, 10);
    for (let z = 5; z <= 9; z += 1) {
      world.setBlock(5, 41, z, BlockId.Rail);
      world.setBlockState(5, 41, z, { railShape: 'north_south' });
    }
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 6)!;
    expect(manager.insertTnt(cart)).toBe(true);
    expect(manager.primeTnt(cart)).toBe(true);
    cart.alongSpeed = 2;
    manager.update(0.05);
    const saved = manager.serialize();
    expect(saved[0]?.variant).toBe('tnt');
    expect(saved[0]?.fuseTicks).toBe(TNT_MINECART_FUSE_TICKS - 1);
    manager.restore(saved);
    const restored = manager.entities[0]!;
    expect(restored.variant).toBe('tnt');
    expect(restored.fuseTicks).toBe(TNT_MINECART_FUSE_TICKS - 1);
    expect(restored.rail?.shape).toBe('north_south');
    expect(restored.alongSpeed).toBeGreaterThan(1);
    manager.dispose();
  });
});

describe('TNT minecart', () => {
  it('inserts TNT into a normal cart, consumes one in Survival, shows cargo and cannot be ridden', () => {
    const world = new VoxelWorld('tnt-insert');
    platform(world, 4, 4, 6, 6);
    world.setBlock(5, 41, 5, BlockId.Rail);
    world.setBlockState(5, 41, 5, { railShape: 'north_south' });
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('tnt', 4));
    expect(manager.insertTnt(cart)).toBe(true);
    expect(cart.variant).toBe('tnt');
    expect(cart.visual.getObjectByName('tnt-cargo')?.visible).toBe(true);
    expect(manager.isRideable(cart)).toBe(false);
    expect(inventory.remove('tnt', 1)).toBe(1);
    expect(inventory.getSlot(0)?.count).toBe(3);
    manager.dispose();
  });

  it('primes with an 80-tick fuse, keeps moving, then uses the canonical TNT explosion', () => {
    const world = new VoxelWorld('tnt-fuse');
    platform(world, 4, 4, 6, 12);
    for (let z = 5; z <= 11; z += 1) {
      world.setBlock(5, 41, z, BlockId.Rail);
      world.setBlockState(5, 41, z, { railShape: 'north_south' });
    }
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    manager.insertTnt(cart);
    expect(manager.primeTnt(cart)).toBe(true);
    expect(cart.fuseTicks).toBe(TNT_MINECART_FUSE_TICKS);
    cart.alongSpeed = 2;
    const startZ = cart.position.z;
    for (let tick = 0; tick < 10; tick += 1) manager.update(0.05);
    expect(manager.count).toBe(1);
    expect(cart.position.z).not.toBeCloseTo(startZ, 2);
    cart.fuseTicks = 1;
    manager.update(0.05);
    const booms = manager.consumeExplosions();
    expect(booms).toHaveLength(1);
    expect(booms[0]?.power).toBe(TNT_MINECART_EXPLOSION_POWER);
    expect(booms[0]?.radius).toBe(TNT_MINECART_EXPLOSION_RADIUS);
    expect(manager.count).toBe(0);
    manager.dispose();
  });

  it('detonates immediately from a fire arrow and ignores a normal arrow, without lighting ground', () => {
    const world = new VoxelWorld('tnt-arrow');
    platform(world, 4, 4, 6, 6);
    world.setBlock(5, 41, 5, BlockId.Rail);
    const manager = carts(world);
    const cart = manager.spawn(5, 41, 5)!;
    manager.insertTnt(cart);
    const hit = manager.raycast(new THREE.Vector3(5.5, 41.4, 4.2), new THREE.Vector3(0, 0, 1), 3);
    expect(hit?.cart).toBe(cart);
    expect(manager.explodeNow(cart)).toBe(true);
    expect(manager.count).toBe(0);
    expect(flamingArrowBlockHit(BlockId.GrassBlock)).toBe('none');
    expect(flamingArrowBlockHit(BlockId.Tnt)).toBe('prime_tnt');
    const leftover = manager.spawn(5, 41, 5)!;
    expect(manager.explodeNow(leftover)).toBe(false);
    manager.dispose();
  });
});

describe('minecart crafting recipe', () => {
  const iron = ItemId.IronIngot;
  const uTop = grid(
    [iron, null, iron],
    [iron, iron, iron],
    [null, null, null],
  );
  const uBottom = grid(
    [null, null, null],
    [iron, null, iron],
    [iron, iron, iron],
  );

  it('crafts one Minecart from the 5-ingot U and rejects a wrong arrangement', () => {
    expect(findCraftingRecipe(uTop)?.id).toBe('minecart');
    expect(getCraftingResult(uTop)?.itemId).toBe(ItemId.Minecart);
    expect(findCraftingRecipe(uBottom)?.id).toBe('minecart');
    expect(findCraftingRecipe(grid(
      [iron, iron, iron],
      [null, iron, null],
      [iron, null, iron],
    ))).toBeUndefined();
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id === 'minecart')).toBe(true);
    expect(allCraftingBookEntries().some((entry) => entry.id === 'minecart')).toBe(true);
  });
});

describe('player fire AABB', () => {
  it('detects Fire by body overlap, not only the block under the feet', () => {
    const world = new VoxelWorld('player-fire-aabb');
    platform(world, 4, 4, 8, 8);
    world.setBlock(6, 41, 5, BlockId.Fire);
    const player = new PlayerController({ position: [6.5, 41, 5.5] });
    player.tick(world, {
      yaw: 0, pitch: 0,
      movement: () => ({ forward: 0, right: 0, jump: false, sprint: false, sneak: false }),
    }, 0.05);
    expect(player.inFire).toBe(true);
  });
});
