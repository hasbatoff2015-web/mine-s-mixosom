import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { WORLD_HEIGHT } from '../src/core/constants';
import {
  MOB_HURT_FLASH_SECONDS,
  MobManager,
  applyMobHurtTint,
  mobHurtFlashIntensity,
} from '../src/entities';
import { VoxelWorld } from '../src/world/World';

function platform(world: VoxelWorld, y = 40): void {
  world.getChunk(0, 0);
  for (let x = 2; x <= 12; x += 1) {
    for (let z = 2; z <= 12; z += 1) {
      world.setBlock(x, y, z, BlockId.Stone);
      for (let above = y + 1; above < WORLD_HEIGHT && above <= y + 4; above += 1) {
        world.setBlock(x, above, z, BlockId.Air);
      }
    }
  }
}

function firstLitMesh(root: THREE.Object3D): THREE.Mesh | undefined {
  let found: THREE.Mesh | undefined;
  root.traverse((object) => {
    if (found || !(object instanceof THREE.Mesh)) return;
    found = object;
  });
  return found;
}

describe('mob hurt flash', () => {
  it('starts a red tint only after successful damage, not miss or zero damage', () => {
    const world = new VoxelWorld('mob-flash');
    platform(world);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const cow = manager.spawn('cow', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    expect(cow.hurtFlashSeconds).toBe(0);
    expect(manager.damage(cow, 0, { source: 'player' })).toBe(false);
    expect(cow.hurtFlashSeconds).toBe(0);
    const miss = manager.attackTarget(new THREE.Vector3(20, 50, 20), new THREE.Vector3(0, 1, 0), 4);
    expect(miss).toBeUndefined();
    expect(cow.hurtFlashSeconds).toBe(0);
    expect(manager.damage(cow, 2, { source: 'player' })).toBe(true);
    expect(cow.hurtFlashSeconds).toBe(MOB_HURT_FLASH_SECONDS);
    expect(mobHurtFlashIntensity(cow.hurtFlashSeconds)).toBe(1);
    const light = cow.visual.userData.entityLight as THREE.Vector3;
    expect(light.x).toBeGreaterThan(light.y);
    expect(light.x).toBeGreaterThan(light.z);
    manager.dispose();
  });

  it('decays with elapsed time and restarts on a repeated hit without stacking', () => {
    expect(MOB_HURT_FLASH_SECONDS).toBeGreaterThanOrEqual(0.15);
    expect(MOB_HURT_FLASH_SECONDS).toBeLessThanOrEqual(0.25);
    const world = new VoxelWorld('mob-flash-decay');
    platform(world);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const zombie = manager.spawn('zombie', new THREE.Vector3(6.5, 41, 6.5), { force: true })!;
    manager.damage(zombie, 1, { source: 'player' });
    manager.update(0.05, { daylight: 0.2, playerPosition: new THREE.Vector3(8, 41, 8) });
    expect(zombie.hurtFlashSeconds).toBeGreaterThan(0);
    expect(zombie.hurtFlashSeconds).toBeLessThan(MOB_HURT_FLASH_SECONDS);
    manager.damage(zombie, 1, { source: 'player' });
    expect(zombie.hurtFlashSeconds).toBe(MOB_HURT_FLASH_SECONDS);
    for (let step = 0; step < 12; step += 1) {
      manager.update(0.05, { daylight: 0.2, playerPosition: new THREE.Vector3(8, 41, 8) });
    }
    expect(zombie.hurtFlashSeconds).toBe(0);
    expect(mobHurtFlashIntensity(zombie.hurtFlashSeconds)).toBe(0);
    manager.dispose();
  });

  it('tints only the damaged mob and does not mutate the shared material', () => {
    const world = new VoxelWorld('mob-flash-shared');
    platform(world);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const hit = manager.spawn('cow', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    const other = manager.spawn('cow', new THREE.Vector3(8.5, 41, 8.5), { force: true })!;
    const meshA = firstLitMesh(hit.visual)!;
    const meshB = firstLitMesh(other.visual)!;
    expect(meshA.material).toBe(meshB.material);
    const colorBefore = (meshA.material as THREE.MeshBasicMaterial).color?.clone();
    manager.damage(hit, 3, { source: 'player' });
    manager.update(0.05, { daylight: 0.2 });
    expect(hit.hurtFlashSeconds).toBeGreaterThan(0);
    expect(other.hurtFlashSeconds).toBe(0);
    const lightA = hit.visual.userData.entityLight as THREE.Vector3;
    const lightB = other.visual.userData.entityLight as THREE.Vector3;
    expect(lightA.x - lightA.y).toBeGreaterThan(lightB.x - lightB.y);
    if (colorBefore && 'color' in (meshA.material as THREE.MeshBasicMaterial)) {
      expect((meshA.material as THREE.MeshBasicMaterial).color.equals(colorBefore)).toBe(true);
    }
    manager.dispose();
  });

  it('keeps a burning overlay after the hurt flash and cleans up on death', () => {
    const world = new VoxelWorld('mob-flash-fire');
    platform(world);
    world.setBlock(5, 41, 5, BlockId.Fire);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const zombie = manager.spawn('zombie', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    zombie.fireTicks = 40;
    manager.update(0.05, { daylight: 0.2 });
    manager.interpolateVisuals(1);
    expect(zombie.isOnFire).toBe(true);
    expect(zombie.fireOverlay?.visible).toBe(true);
    const overlay = zombie.fireOverlay;
    manager.damage(zombie, 2, { source: 'player' });
    manager.interpolateVisuals(1);
    expect(zombie.hurtFlashSeconds).toBeGreaterThan(0);
    expect(zombie.fireOverlay).toBe(overlay);
    expect(zombie.fireOverlay?.visible).toBe(true);
    manager.damage(zombie, 100, { source: 'player' });
    expect(zombie.alive).toBe(false);
    for (let step = 0; step < 20; step += 1) manager.update(0.05, { daylight: 0.2 });
    expect(manager.count).toBe(0);
    manager.dispose();
  });

  it('does not flash on fire DOT and uses a bounded red multiply', () => {
    const tinted = applyMobHurtTint([0.5, 0.5, 0.5], 1);
    expect(tinted[0]).toBeGreaterThan(tinted[1]);
    expect(tinted[0]).toBeLessThan(1.21);
    expect(tinted[1]).toBeGreaterThan(0);
    const world = new VoxelWorld('mob-flash-dot');
    platform(world);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const pig = manager.spawn('pig', new THREE.Vector3(6.5, 41, 6.5), { force: true })!;
    manager.damage(pig, 1, { source: 'fire' });
    expect(pig.hurtFlashSeconds).toBe(0);
    manager.dispose();
  });
});
