import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ThreeEntityHost } from '../src/entities/ThreeEntityHost';
import { createMobModel } from '../src/entities/mobModels';
import {
  BEE_BEDROCK_BONES,
  BEE_MODEL,
  beeLegacyBoxOrigin,
  beeLegacyChildPivot,
} from '../src/entities/beeModel';
import { PET_BEE_MODEL_SCALE, PET_CREEPER_MODEL_SCALE } from '../src/entities/cosmeticPets';
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
  it('adapts the bedrock bee cubes, pivots, and UV islands', () => {
    const body = BEE_BEDROCK_BONES[0]!;
    expect(body.cubes[0]).toMatchObject({ origin: [-3, 2, -5], size: [7, 7, 10], uv: [0, 0] });
    expect(body.cubes[1]?.uv).toEqual([2, 0]);
    expect(body.cubes[2]?.uv).toEqual([2, 3]);
    const right = BEE_BEDROCK_BONES.find((bone) => bone.name === 'rightwing_bone')!;
    const left = BEE_BEDROCK_BONES.find((bone) => bone.name === 'leftwing_bone')!;
    expect(right.cubes[0]).toMatchObject({ size: [9, 0, 6], uv: [0, 18] });
    expect(left.cubes[0]).toMatchObject({ size: [9, 0, 6], uv: [9, 24] });
    expect(BEE_BEDROCK_BONES.find((bone) => bone.name === 'stinger')?.cubes[0]?.uv).toEqual([26, 7]);
    expect(BEE_BEDROCK_BONES.filter((bone) => bone.name.startsWith('leg_')).map((bone) => bone.cubes[0]?.uv)).toEqual([
      [26, 1], [26, 3], [26, 5],
    ]);
    const bodyPart = BEE_MODEL.parts.find((part) => part.name === 'body')!;
    expect(bodyPart.boxes[0]?.origin).toEqual(beeLegacyBoxOrigin([-3, 2, -5], [7, 7, 10], body.pivot));
    expect(bodyPart.boxes[0]?.textureOffset).toEqual([0, 0]);
    expect(BEE_MODEL.parts.find((part) => part.name === 'rightwing_bone')?.rotationPoint).toEqual(
      beeLegacyChildPivot(right.pivot, body.pivot),
    );
    expect(BEE_MODEL.parts.find((part) => part.name === 'leftwing_bone')?.boxes[0]?.textureOffset).toEqual([9, 24]);
    expect(BEE_MODEL.parts.filter((part) => part.name.startsWith('leg_'))).toHaveLength(3);
  });

  it('builds a bee with body, wings, antennae, legs, and a stinger', () => {
    const visuals = new VoxelVisualFactory();
    const model = createMobModel(visuals, 'pet_bee');
    const host = new ThreeEntityHost(new THREE.Scene());
    host.syncMob(state('pet_bee', model, 0));
    expect(model.parts.get('body')).toBeDefined();
    expect(model.parts.get('stinger')).toBeDefined();
    expect(model.wings.map((wing) => (wing as THREE.Object3D).name)).toEqual([
      'mob:pet_bee:rightwing_bone',
      'mob:pet_bee:leftwing_bone',
    ]);
    expect(model.legs).toHaveLength(3);
    expect((model.parts.get('body') as THREE.Object3D).children.filter((child) => child instanceof THREE.Mesh)).toHaveLength(3);
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
    const bodyMesh = (model.parts.get('body') as THREE.Object3D).children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    bodyMesh.geometry.computeBoundingBox();
    const bodySize = bodyMesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(PET_BEE_MODEL_SCALE);
    const previousBody = new THREE.Vector3(7 / 16, 7 / 16, 10 / 16);
    expect(bodySize.x / previousBody.x).toBeCloseTo(PET_BEE_MODEL_SCALE, 2);
    expect(bodySize.y / previousBody.y).toBeCloseTo(PET_BEE_MODEL_SCALE, 2);
    expect(bodySize.z / previousBody.z).toBeCloseTo(PET_BEE_MODEL_SCALE, 2);
    const wingSpan = bounds.getSize(new THREE.Vector3()).x;
    expect(wingSpan).toBeGreaterThan(0.5);
    expect(wingSpan).toBeLessThan(0.85);
    const positions = root.getObjectByProperty('type', 'Mesh') as THREE.Mesh | undefined;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const position = object.geometry.getAttribute('position');
      for (let index = 0; index < position.count; index += 1) {
        expect(Number.isFinite(position.getX(index))).toBe(true);
        expect(Number.isFinite(position.getY(index))).toBe(true);
        expect(Number.isFinite(position.getZ(index))).toBe(true);
      }
    });
    expect(positions).toBeDefined();
    expect((model.parts.get('stinger') as THREE.Object3D).position.z).toBeGreaterThan(0);
    const antenna = (model.parts.get('body') as THREE.Object3D).children.filter((child) => child instanceof THREE.Mesh)[1] as THREE.Mesh;
    expect(antenna.position.z).toBeLessThan(bodyMesh.position.z);
    visuals.dispose();
    host.dispose();
  });

  it('uses a 64×64 sheet whose painted islands stay inside the texture', () => {
    const png = decodeRgbaPng(readFileSync(new URL('../public/textures/entity/bee.png', import.meta.url)));
    expect(png.width).toBe(64);
    expect(png.height).toBe(64);
    const sample = (u: number, v: number) => {
      const index = (v * png.width + u) * 4;
      return [png.data[index], png.data[index + 1], png.data[index + 2], png.data[index + 3]] as const;
    };
    const pupil = sample(11, 12);
    expect(pupil[3]).toBe(255);
    expect(pupil[0]).toBeLessThan(40);
    const cheek = sample(13, 10);
    expect(cheek[3]).toBe(255);
    expect(cheek[0]).toBeGreaterThan(180);
    expect(cheek[1]).toBeGreaterThan(120);
    const back = sample(30, 13);
    expect(back[0]).toBeLessThan(140);
    const wingCorner = sample(6, 18);
    const wingCenter = sample(10, 21);
    const leftWing = sample(19, 27);
    expect(wingCorner[3]).toBe(0);
    expect(wingCenter[3]).toBeGreaterThan(40);
    expect(wingCenter[3]).toBeLessThan(255);
    expect(leftWing[3]).toBeGreaterThan(40);
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
    expect((created.visual as THREE.Object3D).scale.x).toBeCloseTo(PET_BEE_MODEL_SCALE, 5);
    const rightMesh = right.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    const leftMesh = left.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    (created.visual as THREE.Object3D).updateMatrixWorld(true);
    const rightRaised = rightMesh.getWorldPosition(new THREE.Vector3()).y;
    const leftRaised = leftMesh.getWorldPosition(new THREE.Vector3()).y;
    host.syncMob(state('pet_bee', created.model, 0));
    (created.visual as THREE.Object3D).updateMatrixWorld(true);
    const rightRest = rightMesh.getWorldPosition(new THREE.Vector3()).y;
    const leftRest = leftMesh.getWorldPosition(new THREE.Vector3()).y;
    expect(Math.abs(rightRaised - rightRest)).toBeGreaterThan(0.01);
    expect(Math.abs(leftRaised - leftRest)).toBeGreaterThan(0.01);
    expect((leftRaised - leftRest) * (rightRaised - rightRest)).toBeGreaterThan(0);
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
