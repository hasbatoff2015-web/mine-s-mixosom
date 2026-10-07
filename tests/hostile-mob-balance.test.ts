import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { MobManager } from '../src/entities';
import { MOB_DEFINITIONS } from '../src/entities/mobDefinitions';
import { WOLF_ATTACK_DAMAGE } from '../src/entities/petConstants';
import { VoxelWorld } from '../src/world/World';

function arena(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -1; z <= 12; z += 1) {
      world.setBlock(x, 71, z, BlockId.Stone);
      world.setBlock(x, 72, z, BlockId.Air);
      world.setBlock(x, 73, z, BlockId.Air);
      world.setBlock(x, 74, z, BlockId.Air);
    }
  }
  return world;
}

describe('hostile mob balance', () => {
  it('halves hostile damage and stretches attack cooldowns, leaving creeper and passives', () => {
    expect(MOB_DEFINITIONS.zombie).toMatchObject({ attackDamage: 1.5, attackCooldownSeconds: 1.5 });
    expect(MOB_DEFINITIONS.skeleton).toMatchObject({ attackDamage: 2, attackCooldownSeconds: 2.4 });
    expect(MOB_DEFINITIONS.spider).toMatchObject({ attackDamage: 1, attackCooldownSeconds: 1.35 });
    expect(MOB_DEFINITIONS.creeper).toMatchObject({ attackDamage: 0, attackCooldownSeconds: 1 });
    expect(MOB_DEFINITIONS.wolf.attackDamage).toBe(WOLF_ATTACK_DAMAGE);
    expect(MOB_DEFINITIONS.wolf.attackCooldownSeconds).toBe(1);
    for (const kind of ['cow', 'pig', 'chicken', 'sheep', 'cat'] as const) {
      expect(MOB_DEFINITIONS[kind].attackDamage).toBe(0);
      expect(MOB_DEFINITIONS[kind].attackCooldownSeconds).toBe(1);
    }
  });

  it('waits 1.5s between zombie hits and deals 1.5 damage', () => {
    const manager = new MobManager(new THREE.Scene(), arena('zombie-balance'), { automaticSpawning: false });
    const zombie = manager.spawn('zombie', new THREE.Vector3(0, 72, 1), { force: true })!;
    const playerPosition = new THREE.Vector3(0, 72, 0);
    manager.update(0.05, { playerPosition });
    const first = manager.consumePlayerDamage();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ amount: 1.5, source: 'melee', mobKind: 'zombie' });
    expect(zombie.attackCooldownSeconds).toBeCloseTo(1.5);

    for (let index = 0; index < 29; index += 1) manager.update(0.05, { playerPosition });
    expect(manager.consumePlayerDamage()).toHaveLength(0);
    expect(zombie.attackCooldownSeconds).toBeGreaterThan(0);

    manager.update(0.05, { playerPosition });
    const second = manager.consumePlayerDamage();
    expect(second).toHaveLength(1);
    expect(second[0]?.amount).toBe(1.5);
    manager.dispose();
  });

  it('spaces skeleton shots by the same 2.4s attack cooldown', () => {
    let shots = 0;
    const manager = new MobManager(new THREE.Scene(), arena('skeleton-balance'), {
      automaticSpawning: false,
      onProjectileSpawn: () => { shots += 1; },
    });
    const skeleton = manager.spawn('skeleton', new THREE.Vector3(0, 72, 8), { force: true })!;
    const playerPosition = new THREE.Vector3(0, 72, 0);
    manager.update(0.05, { playerPosition });
    expect(shots).toBe(1);
    expect(skeleton.attackCooldownSeconds).toBeCloseTo(2.4);
    expect(manager.projectileCount).toBe(1);

    const cooldown = skeleton.definition.attackCooldownSeconds;
    let elapsed = 0;
    while (elapsed + 0.05 < cooldown - 1e-4) {
      manager.update(0.05, { playerPosition });
      elapsed += 0.05;
    }
    expect(shots).toBe(1);
    expect(skeleton.attackCooldownSeconds).toBeGreaterThan(0);
    expect(elapsed).toBeGreaterThan(2.2);

    let extra = 0;
    while (shots < 2 && extra < 3) {
      manager.update(0.05, { playerPosition });
      extra += 1;
    }
    expect(shots).toBe(2);
    expect(skeleton.attackCooldownSeconds).toBeCloseTo(2.4);
    manager.dispose();
  });

  it('deals 1 spider damage and waits 1.35s before the next bite', () => {
    const manager = new MobManager(new THREE.Scene(), arena('spider-balance'), { automaticSpawning: false });
    const spider = manager.spawn('spider', new THREE.Vector3(0, 72, 0.4), { force: true })!;
    const playerPosition = new THREE.Vector3(0, 72, 0);
    manager.update(0.05, { playerPosition, daylight: 1 });
    const first = manager.consumePlayerDamage();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ amount: 1, source: 'melee', mobKind: 'spider' });
    expect(spider.attackCooldownSeconds).toBeCloseTo(1.35);

    for (let index = 0; index < 26; index += 1) manager.update(0.05, { playerPosition, daylight: 1 });
    expect(manager.consumePlayerDamage()).toHaveLength(0);

    manager.update(0.05, { playerPosition, daylight: 1 });
    expect(manager.consumePlayerDamage()[0]?.amount).toBe(1);
    manager.dispose();
  });
});
