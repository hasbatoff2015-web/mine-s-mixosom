import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { createItemStack } from '../src/inventory';
import {
  DroppedItemManager,
  MobManager,
  type MobKind,
} from '../src/entities';
import { VoxelWorld } from '../src/world/World';

describe('DroppedItemManager', () => {
  it('merges compatible stacks and supports partial pickup after its delay', () => {
    const scene = new THREE.Scene();
    const world = new VoxelWorld('item-entities');
    const manager = new DroppedItemManager(scene, world, {
      pickupDelaySeconds: 0,
      mergeRadius: 1,
    });
    const position = new THREE.Vector3(0.5, 72, 0.5);

    const first = manager.spawn(createItemStack('dirt', 2), position);
    const second = manager.spawn(createItemStack('dirt', 3), position.clone().addScalar(0.1));

    expect(second).toBe(first);
    expect(manager.count).toBe(1);
    expect(first.stack.count).toBe(5);
    expect(manager.collectNearby(position, () => 2)).toBe(2);
    expect(first.stack.count).toBe(3);
    expect(manager.collectNearby(position, () => true)).toBe(3);
    expect(manager.count).toBe(0);
    manager.dispose();
  });

  it('enforces its cap and round-trips serializable state', () => {
    const scene = new THREE.Scene();
    const world = new VoxelWorld('bounded-items');
    const manager = new DroppedItemManager(scene, world, { maxItems: 2 });
    manager.spawn(createItemStack('dirt'), new THREE.Vector3(0, 72, 0));
    manager.spawn(createItemStack('stone'), new THREE.Vector3(3, 72, 0));
    manager.spawn(createItemStack('sand'), new THREE.Vector3(6, 72, 0));
    expect(manager.count).toBe(2);

    const saved = manager.serialize();
    const restored = new DroppedItemManager(new THREE.Scene(), world, { maxItems: 2 });
    expect(restored.restore(saved)).toBe(2);
    expect(restored.serialize().map((entry) => entry.stack.itemId)).toEqual(
      saved.map((entry) => entry.stack.itemId),
    );
    manager.dispose();
    restored.dispose();
  });
});

describe('MobManager', () => {
  it('builds every alpha mob as a bounded voxel entity', () => {
    const scene = new THREE.Scene();
    const world = new VoxelWorld('mob-models');
    const manager = new MobManager(scene, world, { automaticSpawning: false, maxMobs: 8 });
    const kinds: readonly MobKind[] = [
      'cow', 'pig', 'chicken', 'sheep', 'zombie', 'skeleton', 'creeper', 'spider',
    ];
    kinds.forEach((kind, index) => {
      expect(manager.spawn(kind, new THREE.Vector3(index * 2, 72, 0), { force: true })).toBeDefined();
    });
    expect(manager.count).toBe(8);
    expect(scene.children).toHaveLength(8);
    manager.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('ray-targets mobs without selecting through voxels and applies damage', () => {
    const world = new VoxelWorld('mob-ray');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const cow = manager.spawn('cow', new THREE.Vector3(0, 72, 3), { force: true });
    expect(cow).toBeDefined();

    const hit = manager.attackTarget(
      new THREE.Vector3(0, 73, 0),
      new THREE.Vector3(0, 0, 1),
      4,
      5,
    );
    expect(hit?.mob).toBe(cow);
    expect(cow?.health).toBe(6);
    expect(cow?.state).toBe('hurt');
    manager.dispose();
  });

  it('runs the creeper fuse and exposes explosion events', () => {
    const world = new VoxelWorld('creeper-fuse');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    for (let z = 0; z <= 2; z += 1) world.setBlock(0, 71, z, BlockId.Stone);
    manager.spawn('creeper', new THREE.Vector3(0, 72, 2), { force: true });
    const playerPosition = new THREE.Vector3(0, 72, 0);
    for (let index = 0; index < 7; index += 1) manager.update(0.25, { playerPosition });

    const explosions = manager.consumeExplosions();
    expect(explosions).toHaveLength(1);
    expect(explosions[0]?.power).toBe(3);
    expect(manager.count).toBe(0);
    manager.dispose();
  });

  it('spawns a lightweight skeleton arrow while attacking at range', () => {
    const world = new VoxelWorld('skeleton-arrow');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    manager.spawn('skeleton', new THREE.Vector3(0, 72, 8), { force: true });
    manager.update(0.05, { playerPosition: new THREE.Vector3(0, 72, 0) });
    expect(manager.projectileCount).toBe(1);
    manager.dispose();
  });

  it('keeps creative-style non-targetable players out of hostile attacks', () => {
    const world = new VoxelWorld('non-targetable-player');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    manager.spawn('zombie', new THREE.Vector3(0, 72, 1), { force: true });
    for (let index = 0; index < 30; index += 1) {
      manager.update(0.05, {
        playerPosition: new THREE.Vector3(0, 72, 0),
        playerAlive: true,
        playerTargetable: false,
      });
    }
    expect(manager.consumePlayerDamage()).toHaveLength(0);
    manager.dispose();
  });

  it('does not melee a player on another vertical level', () => {
    const world = new VoxelWorld('vertical-melee');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    manager.spawn('zombie', new THREE.Vector3(0, 72, 0), { force: true });
    manager.update(0.05, { playerPosition: new THREE.Vector3(0, 75, 0) });
    expect(manager.consumePlayerDamage()).toHaveLength(0);
    manager.dispose();
  });

  it('softly separates overlapping mobs with a bounded neighbor pass', () => {
    const world = new VoxelWorld('mob-separation');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const y = world.surfaceY(0, 0) + 1.01;
    const first = manager.spawn('cow', new THREE.Vector3(0.45, y, 0.5), { force: true })!;
    const second = manager.spawn('cow', new THREE.Vector3(0.55, y, 0.5), { force: true })!;
    const before = first.position.distanceTo(second.position);
    for (let index = 0; index < 20; index += 1) {
      manager.update(0.05, { playerTargetable: false });
    }
    expect(first.position.distanceTo(second.position)).toBeGreaterThan(before + 0.2);
    manager.dispose();
  });
});
