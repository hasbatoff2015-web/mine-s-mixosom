import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARROW_FORWARD, ArrowVisualFactory } from '../src/rendering/ArrowVisualFactory';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import type { VoxelWorld } from '../src/world/World';
import type { MobManager } from '../src/entities/MobManager';
import { MinecartVisualFactory, minecartFloorMesh } from '../src/rendering/minecartGeometry';

describe('canonical thin arrow visual', () => {
  it('has a thin finite shaft, small head and tail-only fins with bounded sheet UVs', () => {
    const factory = new ArrowVisualFactory(), mesh = factory.create();
    const geometry = mesh.geometry, position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    expect(geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual([
      expect.closeTo(0.17), expect.closeTo(0.17), expect.closeTo(0.885),
    ]);
    for (let i = 0; i < position.count; i++) {
      expect(Number.isFinite(position.getZ(i))).toBe(true);
      if (Math.max(Math.abs(position.getX(i)), Math.abs(position.getY(i))) > 0.036) expect(position.getZ(i)).toBeLessThanOrEqual(-0.599);
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThan(0.5);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(54 / 64);
      const normal = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('normal'), i);
      expect(normal.length()).toBeCloseTo(1);
    }
    expect(geometry.index!.count / 3).toBe(18);
    factory.dispose();
  });

  it.each([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])('embeds the tip, leaving the shaft outside along %s %s %s', (x, y, z) => {
    const factory = new ArrowVisualFactory(), scene = new THREE.Scene();
    const direction = new THREE.Vector3(x, y, z), origin = new THREE.Vector3(5, 40, 5);
    const world = { raycast: () => ({ x: 5, y: 40, z: 5, distance: 0.6 }),
      chunks: new Map() } as unknown as VoxelWorld;
    const manager = new PlayerArrowManager(scene, world, { raycast: () => undefined } as unknown as MobManager,
      { visualFactory: factory, random: () => 1 });
    manager.spawn(origin, direction, 1, 2, false);
    manager.tick(0.05);
    const mesh = scene.children[0]!;
    mesh.updateMatrixWorld();
    expect(ARROW_FORWARD.clone().applyQuaternion(mesh.quaternion).dot(direction)).toBeCloseTo(1);
    const surface = origin.clone().addScaledVector(direction, 0.6);
    const tip = new THREE.Vector3(0, 0, 0.065).applyMatrix4(mesh.matrixWorld);
    const tail = new THREE.Vector3(0, 0, -0.82).applyMatrix4(mesh.matrixWorld);
    expect(tip.sub(surface).dot(direction)).toBeCloseTo(0.03, 3);
    expect(tail.sub(surface).dot(direction)).toBeLessThan(-0.8);
    const before = mesh.quaternion.clone();
    manager.tick(0.05); manager.interpolateVisuals(0.5);
    expect(mesh.quaternion.toArray()).toEqual(before.toArray());
    manager.dispose(); factory.dispose();
  });

  it('reuses one geometry/texture and two lit materials through 120+ shots and removal', () => {
    const factory = new ArrowVisualFactory(), scene = new THREE.Scene();
    const manager = new PlayerArrowManager(scene, {} as VoxelWorld, {} as MobManager,
      { visualFactory: factory, random: () => 0.5 });
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (let i = 0; i < 240; i++) {
      manager.spawn(new THREE.Vector3(), ARROW_FORWARD, 3, 6, false, i % 2 === 0);
      for (const object of scene.children) {
        const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
        geometries.add(mesh.geometry); materials.add(mesh.material); textures.add(mesh.material.map);
        expect(mesh.material.onBeforeCompile).not.toBe(THREE.Material.prototype.onBeforeCompile);
      }
    }
    expect(manager.count).toBe(48);
    expect([geometries.size, materials.size, textures.size]).toEqual([1, 2, 1]);
    manager.dispose(); expect(scene.children).toHaveLength(0);
    factory.dispose();
  });
});

describe('authored minecart panel adapter', () => {
  it('uses bounded panel UVs and reuses geometry across repeated cart creation', () => {
    const factory = new MinecartVisualFactory();
    const first = factory.create(), second = factory.create();
    const geometries = new Set<THREE.BufferGeometry>();
    const inspect = (root: THREE.Object3D) => root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const uv = object.geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
    });
    inspect(first); const initialCount = geometries.size;
    inspect(second); expect(geometries.size).toBe(initialCount);
    expect(minecartFloorMesh(first)?.geometry).toBe(minecartFloorMesh(second)?.geometry);
    const exterior = first.children[1] as THREE.Mesh;
    const uv = exterior.geometry.getAttribute('uv');
    expect(Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)))).toBeLessThan(0.75);
    expect(Math.min(...Array.from({ length: uv.count }, (_, i) => uv.getY(i)))).toBeGreaterThan(0.65);
    factory.dispose();
  });
});
