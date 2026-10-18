import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ThreeEntityHost } from '../src/entities/ThreeEntityHost';
import { createMobModel } from '../src/entities/mobModels';
import { BEE_MODEL } from '../src/entities/beeModel';
import { PET_CREEPER_MODEL_SCALE } from '../src/entities/cosmeticPets';
import { VoxelVisualFactory } from '../src/entities/voxelVisuals';
import type { MobKind } from '../src/entities/mobDefinitions';
import type { MobModel, MobVisualState } from '../src/entities/EntityHost';
import { cuboidUvRects } from '../src/rendering/TexturedCuboid';
import { MobManager } from '../src/entities/MobManager';
import { VoxelWorld } from '../src/world/World';
import { BEE_WING_AMPLITUDE } from '../src/entities/beeVisual';
// @ts-expect-error untyped ESM PNG decoder shared with pet-textures.test.mjs
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

function state(kind: MobKind, model: MobModel, visualAge: number, fuseSeconds = 0): MobVisualState {
  return {
    kind,
    model,
    visual: model.root,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0.4,
    walkPhase: 0,
    visualAge,
    locomotionSpeed: 0,
    state: 'idle',
    stateSeconds: 0,
    deathSeconds: 0,
    fuseSeconds,
    onFire: false,
    width: 0.5,
    height: kind === 'pet_creeper' ? 0.8 : 1.7,
    hurtFlashSeconds: 0,
    health: 20,
    maxHealth: 20,
  };
}

describe('bee and mini creeper visuals', () => {
  it('builds a bee with body, wings, antennae, legs, and a stinger', () => {
    const visuals = new VoxelVisualFactory();
    const model = createMobModel(visuals, 'pet_bee');
    expect(model.parts.get('body')).toBeDefined();
    expect(model.parts.get('antennaLeft')).toBeDefined();
    expect(model.parts.get('antennaRight')).toBeDefined();
    expect(model.parts.get('stinger')).toBeDefined();
    expect(model.wings).toHaveLength(2);
    expect(model.legs).toHaveLength(6);
    const root = model.root as THREE.Object3D;
    const wingMeshes: THREE.Mesh[] = [];
    for (const wing of model.wings) {
      (wing as THREE.Object3D).traverse((object) => {
        if (object instanceof THREE.Mesh) wingMeshes.push(object);
      });
    }
    expect(wingMeshes.length).toBeGreaterThanOrEqual(2);
    for (const mesh of wingMeshes) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.alphaTest).toBeGreaterThan(0);
      expect(material.transparent || material.alphaTest > 0).toBe(true);
    }
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    expect(bounds.isEmpty()).toBe(false);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(0.9);
    expect(size.z).toBeGreaterThan(0.5);
    expect(size.y).toBeGreaterThan(0.4);
    expect(size.y).toBeLessThan(1.3);
    visuals.dispose();
  });

  it('uses a 64×64 sheet whose painted islands stay inside the texture', () => {
    const png = decodeRgbaPng(readFileSync(new URL('../public/textures/entity/bee.png', import.meta.url)));
    expect(png.width).toBe(64);
    expect(png.height).toBe(64);
    const sample = (u: number, v: number) => {
      const index = (v * png.width + u) * 4;
      return [png.data[index], png.data[index + 1], png.data[index + 2], png.data[index + 3]] as const;
    };
    const eye = sample(12, 13);
    expect(eye[3]).toBe(255);
    expect(eye[0]).toBeLessThan(40);
    const cheek = sample(13, 11);
    expect(cheek[3]).toBe(255);
    expect(cheek[0]).toBeGreaterThan(180);
    expect(cheek[1]).toBeGreaterThan(120);
    const wingCorner = sample(7, 32);
    const wingCenter = sample(12, 35);
    expect(wingCorner[3]).toBe(0);
    expect(wingCenter[3]).toBeGreaterThan(40);
    expect(wingCenter[3]).toBeLessThan(255);
    for (const part of BEE_MODEL.parts) {
      for (const box of part.boxes) {
        const rects = cuboidUvRects({
          size: box.size,
          textureOffset: box.textureOffset,
          logicalTextureSize: [64, 64],
        });
        for (const rect of Object.values(rects)) {
          expect(rect.u).toBeGreaterThanOrEqual(0);
          expect(rect.v).toBeGreaterThanOrEqual(0);
          expect(rect.u + rect.width).toBeLessThanOrEqual(64);
          expect(rect.v + rect.height).toBeLessThanOrEqual(64);
        }
      }
    }
  });

  it('flaps mirrored wings from render time and keeps the bob bounded', () => {
    const scene = new THREE.Scene();
    const host = new ThreeEntityHost(scene);
    const created = host.createMob('pet_bee')!;
    host.syncMob(state('pet_bee', created.model, 0));
    const right = created.model.wings[0] as THREE.Object3D;
    const left = created.model.wings[1] as THREE.Object3D;
    expect(right.rotation.z).toBeCloseTo(0, 4);
    expect(left.rotation.z).toBeCloseTo(0, 4);
    const quarter = 1 / (4 * 6.5);
    host.syncMob(state('pet_bee', created.model, quarter));
    expect(left.rotation.z).toBeCloseTo(BEE_WING_AMPLITUDE, 3);
    expect(right.rotation.z).toBeCloseTo(-BEE_WING_AMPLITUDE, 3);
    const yValues: number[] = [];
    for (let step = 0; step < 8; step += 1) {
      host.syncMob(state('pet_bee', created.model, step / 8));
      yValues.push((created.visual as THREE.Object3D).position.y);
      expect(created.model.wings.length).toBe(2);
    }
    const bob = Math.max(...yValues) - Math.min(...yValues);
    expect(bob).toBeGreaterThan(0.02);
    expect(bob).toBeLessThanOrEqual(0.12);
    const world = new VoxelWorld('bee-clock');
    const mobs = new MobManager(scene, world, { automaticSpawning: false });
    const bee = mobs.spawn('pet_bee', { x: 4, y: 72, z: 4 }, { ownerId: 'owner' })!;
    mobs.interpolateVisuals(1, 1_000);
    const first = (bee.model!.wings[0] as THREE.Object3D).rotation.z;
    mobs.interpolateVisuals(1, 1_000 + quarter * 1000);
    const second = (bee.model!.wings[0] as THREE.Object3D).rotation.z;
    expect(second).not.toBeCloseTo(first, 2);
    mobs.dispose();
    host.dispose();
  });

  it('keeps the mini creeper scaled after repeated syncs and leaves the hostile creeper full size', () => {
    const scene = new THREE.Scene();
    const host = new ThreeEntityHost(scene);
    const mini = host.createMob('pet_creeper')!;
    const hostile = host.createMob('creeper')!;
    for (let index = 0; index < 5; index += 1) {
      host.syncMob(state('pet_creeper', mini.model, index, 1.4));
      host.syncMob(state('creeper', hostile.model, index, 0));
    }
    const miniRoot = mini.visual as THREE.Object3D;
    const hostileRoot = hostile.visual as THREE.Object3D;
    expect(miniRoot.scale.x).toBeCloseTo(PET_CREEPER_MODEL_SCALE, 5);
    expect(miniRoot.scale.y).toBeCloseTo(PET_CREEPER_MODEL_SCALE, 5);
    expect(miniRoot.scale.z).toBeCloseTo(PET_CREEPER_MODEL_SCALE, 5);
    expect(hostileRoot.scale.x).toBeCloseTo(1, 5);
    expect(hostileRoot.scale.y).toBeCloseTo(1, 5);
    miniRoot.updateMatrixWorld(true);
    hostileRoot.updateMatrixWorld(true);
    const miniBounds = new THREE.Box3().setFromObject(miniRoot);
    const hostileBounds = new THREE.Box3().setFromObject(hostileRoot);
    const miniSize = miniBounds.getSize(new THREE.Vector3());
    const hostileSize = hostileBounds.getSize(new THREE.Vector3());
    expect(miniSize.y).toBeGreaterThanOrEqual(0.75);
    expect(miniSize.y).toBeLessThanOrEqual(0.85);
    expect(miniBounds.min.y).toBeGreaterThan(-0.02);
    expect(miniBounds.min.y).toBeLessThan(0.08);
    expect(hostileSize.y).toBeGreaterThan(1.4);
    expect(miniSize.y).toBeLessThan(hostileSize.y * 0.6);
    expect(mini.model.legs).toHaveLength(hostile.model.legs.length);
    host.dispose();
  });
});
