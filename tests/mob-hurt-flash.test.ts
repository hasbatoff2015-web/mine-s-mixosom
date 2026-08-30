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
import { ENTITY_MATERIAL_OWNED } from '../src/rendering/worldLighting';
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

function ownedMeshes(root: THREE.Object3D | undefined): THREE.Mesh[] {
  if (!root) return [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (Array.isArray(material) || !material.userData?.[ENTITY_MATERIAL_OWNED]) return;
    if (typeof material.onBeforeCompile !== 'function') return;
    meshes.push(object);
  });
  return meshes;
}

function firstOwnedMesh(root: THREE.Object3D | undefined): THREE.Mesh {
  const mesh = ownedMeshes(root)[0];
  if (!mesh) throw new Error('expected an owned entity mesh');
  return mesh;
}

function compileEntityLightUniform(material: THREE.MeshBasicMaterial): { value: THREE.Vector3 } {
  const shader = {
    uniforms: {} as Record<string, { value: THREE.Vector3 }>,
    vertexShader: '#include <common>\n#include <begin_vertex>\n',
    fragmentShader: '#include <common>\n#include <color_fragment>\n',
  };
  material.onBeforeCompile?.(shader as never, undefined as never);
  return material.userData.uEntityLight as { value: THREE.Vector3 };
}

function bindAndReadLight(mesh: THREE.Mesh): THREE.Vector3 {
  const material = mesh.material as THREE.MeshBasicMaterial;
  if (!material.userData.uEntityLight) compileEntityLightUniform(material);
  mesh.onBeforeRender(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    material,
    undefined as never,
  );
  return (material.userData.uEntityLight as { value: THREE.Vector3 }).value.clone();
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
    const light = cow.visual!.userData.entityLight as THREE.Vector3;
    expect(light.x).toBeGreaterThan(light.y);
    expect(light.x).toBeGreaterThan(light.z);
    manager.dispose();
  });

  it('decays without restarting on ignored hits, then restarts at the half-window boundary', () => {
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
    const remainingFlash = zombie.hurtFlashSeconds;
    expect(manager.damage(zombie, 1, { source: 'player' })).toBe(false);
    expect(zombie.hurtFlashSeconds).toBe(remainingFlash);
    for (let step = 0; step < 9; step += 1) manager.update(0.05, { daylight: 0.2 });
    expect(manager.damage(zombie, 1, { source: 'player' })).toBe(true);
    expect(zombie.hurtFlashSeconds).toBe(MOB_HURT_FLASH_SECONDS);
    for (let step = 0; step < 12; step += 1) {
      manager.update(0.05, { daylight: 0.2, playerPosition: new THREE.Vector3(8, 41, 8) });
    }
    expect(zombie.hurtFlashSeconds).toBe(0);
    expect(mobHurtFlashIntensity(zombie.hurtFlashSeconds)).toBe(0);
    manager.dispose();
  });

  it('isolates hurt tint to the damaged entity while sharing geometry and textures', () => {
    const world = new VoxelWorld('mob-flash-shared');
    platform(world);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const hit = manager.spawn('zombie', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    const other = manager.spawn('zombie', new THREE.Vector3(8.5, 41, 8.5), { force: true })!;
    const meshA = firstOwnedMesh(hit.visual);
    const meshB = firstOwnedMesh(other.visual);
    const matA = meshA.material as THREE.MeshBasicMaterial;
    const matB = meshB.material as THREE.MeshBasicMaterial;
    expect(matA).not.toBe(matB);
    expect(meshA.geometry).toBe(meshB.geometry);
    expect(matA.map).toBe(matB.map);
    const uniformA = compileEntityLightUniform(matA);
    const uniformB = compileEntityLightUniform(matB);
    expect(uniformA).not.toBe(uniformB);
    const colorBefore = matA.color.clone();
    manager.damage(hit, 3, { source: 'player' });
    manager.update(0.05, { daylight: 0.2 });
    expect(hit.hurtFlashSeconds).toBeGreaterThan(0);
    expect(other.hurtFlashSeconds).toBe(0);
    expect(mobHurtFlashIntensity(other.hurtFlashSeconds)).toBe(0);
    const lightA = hit.visual!.userData.entityLight as THREE.Vector3;
    const lightB = other.visual!.userData.entityLight as THREE.Vector3;
    expect(lightA).not.toBe(lightB);
    expect(lightA.x - lightA.y).toBeGreaterThan(lightB.x - lightB.y);
    expect(bindAndReadLight(meshA).x).toBeGreaterThan(bindAndReadLight(meshB).x);
    expect(matA.color.equals(colorBefore)).toBe(true);
    expect(matB.color.equals(colorBefore)).toBe(true);
    manager.dispose();
  });

  it('flashes only the middle of three identical mobs', () => {
    const world = new VoxelWorld('mob-flash-three');
    platform(world);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const a = manager.spawn('spider', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    const b = manager.spawn('spider', new THREE.Vector3(7.5, 41, 7.5), { force: true })!;
    const c = manager.spawn('spider', new THREE.Vector3(9.5, 41, 9.5), { force: true })!;
    manager.damage(b, 2, { source: 'player' });
    manager.update(0.05, { daylight: 0.2 });
    expect(a.hurtFlashSeconds).toBe(0);
    expect(b.hurtFlashSeconds).toBeGreaterThan(0);
    expect(c.hurtFlashSeconds).toBe(0);
    expect(bindAndReadLight(firstOwnedMesh(b.visual)).x)
      .toBeGreaterThan(bindAndReadLight(firstOwnedMesh(a.visual)).x);
    expect(bindAndReadLight(firstOwnedMesh(c.visual)).x)
      .toBeCloseTo(bindAndReadLight(firstOwnedMesh(a.visual)).x, 5);
    manager.dispose();
  });

  it('does not flash a different species standing next to the target', () => {
    const world = new VoxelWorld('mob-flash-types');
    platform(world);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const zombie = manager.spawn('zombie', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    const spider = manager.spawn('spider', new THREE.Vector3(8.5, 41, 8.5), { force: true })!;
    manager.damage(zombie, 2, { source: 'player' });
    manager.update(0.05, { daylight: 0.2 });
    expect(zombie.hurtFlashSeconds).toBeGreaterThan(0);
    expect(spider.hurtFlashSeconds).toBe(0);
    manager.dispose();
  });

  it('shares one owned material across a single mob model and disposes it on death', () => {
    const world = new VoxelWorld('mob-flash-cleanup');
    platform(world);
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const zombie = manager.spawn('zombie', new THREE.Vector3(5.5, 41, 5.5), { force: true })!;
    const meshes = ownedMeshes(zombie.visual);
    expect(meshes.length).toBeGreaterThan(2);
    const unique = [...new Set(meshes.map((mesh) => mesh.material as THREE.MeshBasicMaterial))];
    expect(unique.length).toBeGreaterThan(0);
    expect(unique.length).toBeLessThan(meshes.length);
    for (const material of unique) expect(material.userData[ENTITY_MATERIAL_OWNED]).toBe(true);
    manager.damage(zombie, 100, { source: 'player' });
    expect(zombie.alive).toBe(false);
    for (let step = 0; step < 20; step += 1) manager.update(0.05, { daylight: 0.2 });
    expect(manager.count).toBe(0);
    for (const material of unique) expect(material.userData[ENTITY_MATERIAL_OWNED]).toBe(false);
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
