import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { BlockId } from '../src/blocks';
import { createItemStack } from '../src/inventory';
import {
  DroppedItemManager,
  FallingBlockManager,
  HeadlessEntityHost,
  MinecartManager,
  MobManager,
} from '../src/entities';
import { VoxelWorld } from '../src/world/World';

const ROOT = process.cwd();

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

function platform(world: VoxelWorld, y = 40): void {
  world.getChunk(0, 0);
  for (let x = 2; x <= 8; x += 1) {
    for (let z = 2; z <= 8; z += 1) {
      world.setBlock(x, y, z, BlockId.Stone);
    }
  }
}

describe('entity host import boundary', () => {
  it('keeps the headless host free of Mesh / Geometry / Material and item factories', () => {
    const text = source('src/entities/EntityHost.ts');
    expect(text).not.toMatch(/from ['"]three['"]/);
    expect(text).not.toMatch(/BoxGeometry/);
    expect(text).not.toMatch(/MeshBasicMaterial/);
    expect(text).not.toMatch(/ItemVisualFactory/);
    expect(text).not.toMatch(/ArrowVisualFactory/);
    expect(text).not.toMatch(/VoxelVisualFactory/);
  });

  it('keeps Anarchy server gameplay off ItemVisualFactory and dummy entity scenes', () => {
    const text = source('server/gameplay.ts');
    expect(text).not.toMatch(/ItemVisualFactory/);
    expect(text).not.toMatch(/new THREE\.Group\(\)/);
    expect(text).toMatch(/HeadlessEntityHost/);
    expect(text).not.toMatch(/new RedstoneSystem\(world,\s*\{\s*root:/);
  });

  it('keeps mob simulation off VoxelVisualFactory / createMobModel / ArrowVisualFactory constructors', () => {
    const text = source('src/entities/MobManager.ts');
    expect(text).not.toMatch(/new VoxelVisualFactory/);
    expect(text).not.toMatch(/createMobModel\(/);
    expect(text).not.toMatch(/new ArrowVisualFactory/);
    expect(text).not.toMatch(/SharedFireTexture/);
    expect(text).not.toMatch(/applySampledEntityLight/);
  });
});

describe('HeadlessEntityHost simulation', () => {
  it('spawns and ticks drops, mobs, carts, falling blocks and arrows without visuals', () => {
    const host = new HeadlessEntityHost();
    expect(host.hasVisuals).toBe(false);
    const world = new VoxelWorld('entity-host-headless');
    platform(world);
    const drops = new DroppedItemManager(host, world, { pickupDelaySeconds: 0 });
    const falling = new FallingBlockManager(host, world);
    const mobs = new MobManager(host, world, { automaticSpawning: false });
    const minecarts = new MinecartManager(host, world);
    const arrows = new PlayerArrowManager(host, world, mobs);

    const item = drops.spawn(createItemStack('dirt', 3), new THREE.Vector3(4.5, 41, 4.5));
    expect(item.visual).toBeUndefined();
    expect(drops.count).toBe(1);

    world.setBlock(5, 42, 5, BlockId.Sand);
    const sand = falling.spawn(BlockId.Sand, 5, 42, 5);
    expect(sand?.visual).toBeUndefined();

    const mob = mobs.spawn('cow', new THREE.Vector3(4.5, 41, 4.5), { force: true })!;
    expect(mob.visual).toBeUndefined();
    expect(mob.model).toBeUndefined();
    expect(mobs.count).toBe(1);

    world.setBlock(6, 41, 6, BlockId.Rail);
    const cart = minecarts.spawn(6, 41, 6);
    expect(cart?.visual).toBeUndefined();
    expect(minecarts.count).toBe(1);

    arrows.spawn(new THREE.Vector3(4.5, 42, 4.5), new THREE.Vector3(1, 0, 0), 1.5, 4, false);
    expect(arrows.count).toBe(1);
    expect(arrows.entities[0]?.visual).toBeUndefined();

    drops.update(0.05);
    falling.update(0.05);
    mobs.update(0.05, { daylight: 1, playerPosition: new THREE.Vector3(4.5, 41, 4.5) });
    minecarts.update(0.05, {});
    arrows.tick(0.05);
    drops.interpolateVisuals(0.5);
    mobs.interpolateVisuals(0.5);
    minecarts.interpolateVisuals(0.5);
    arrows.interpolateVisuals(0.5);

    expect(drops.serialize()).toHaveLength(1);
    expect(mobs.serialize()).toHaveLength(1);
    expect(minecarts.serialize()).toHaveLength(1);
    expect(item.stack.count).toBe(3);
    expect(mob.alive).toBe(true);

    drops.dispose();
    falling.dispose();
    mobs.dispose();
    minecarts.dispose();
    arrows.dispose();
  });
});

describe('ThreeEntityHost scene wrapping', () => {
  it('still attaches real visuals when managers wrap a Scene', () => {
    const scene = new THREE.Scene();
    const world = new VoxelWorld('entity-host-scene');
    platform(world);
    const drops = new DroppedItemManager(scene, world);
    const item = drops.spawn(createItemStack('dirt', 1), new THREE.Vector3(4.5, 41, 4.5));
    expect(item.visual).toBeInstanceOf(THREE.Object3D);
    expect(scene.children.length).toBeGreaterThan(0);

    const mobs = new MobManager(scene, world, { automaticSpawning: false });
    const mob = mobs.spawn('pig', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    expect(mob.visual).toBeInstanceOf(THREE.Object3D);
    expect(mob.model).toBeDefined();
    mobs.interpolateVisuals(1);
    expect(mob.visual!.position.y).toBeCloseTo(mob.position.y, 5);

    drops.dispose();
    mobs.dispose();
  });
});
