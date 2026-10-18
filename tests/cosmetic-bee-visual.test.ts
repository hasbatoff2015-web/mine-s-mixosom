import * as THREE from 'three';
import { createHash } from 'node:crypto';
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

  it('maps the committed bee sheet onto the bedrock face islands', () => {
    const bytes = readFileSync(new URL('../public/textures/entity/bee.png', import.meta.url));
    const blob = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    expect(blob).toBe('41cfe1ab85aa0cbc7ad824c742085fa248cef270');
    const png = decodeRgbaPng(bytes);
    expect(png.width).toBe(64);
    expect(png.height).toBe(64);
    const sample = (u: number, v: number) => {
      const index = (v * png.width + u) * 4;
      return [png.data[index], png.data[index + 1], png.data[index + 2], png.data[index + 3]] as const;
    };
    const body = cuboidUvRects({ size: [7, 7, 10], textureOffset: [0, 0], logicalTextureSize: [64, 64] });
    const eye = sample(body.front.u + 1, body.front.v + 1);
    const cheek = sample(body.front.u + 3, body.front.v + 2);
    expect(eye[3]).toBe(255);
    expect(eye[0]).toBeLessThan(cheek[0]);
    expect(cheek[3]).toBe(255);
    expect(cheek[0]).toBeGreaterThan(180);
    const back = sample(body.back.u + 3, body.back.v + 3);
    expect(back[3]).toBe(255);
    expect(back[0]).toBeLessThan(cheek[0]);
    const headSide = sample(body.left.u + body.left.width - 1, body.left.v + 2);
    const rearSide = sample(body.left.u, body.left.v + 2);
    expect(headSide[0]).toBeGreaterThan(rearSide[0]);
    const rightWing = cuboidUvRects({ size: [9, 0, 6], textureOffset: [0, 18], logicalTextureSize: [64, 64] });
    const leftWing = cuboidUvRects({ size: [9, 0, 6], textureOffset: [9, 24], logicalTextureSize: [64, 64] });
    expect(sample(rightWing.top.u, rightWing.top.v)[3]).toBe(0);
    expect(sample(rightWing.top.u + 3, rightWing.top.v)[3]).toBe(255);
    expect(sample(leftWing.top.u, leftWing.top.v)[3]).toBe(0);
    expect(sample(leftWing.top.u + 3, leftWing.top.v)[3]).toBe(255);
    const stinger = cuboidUvRects({ size: [0, 1, 2], textureOffset: [26, 7], logicalTextureSize: [64, 64] });
    expect(sample(stinger.left.u, stinger.left.v)[3]).toBe(255);
    expect(sample(stinger.left.u, stinger.left.v)[0]).toBeLessThan(80);
    const bodyPart = BEE_MODEL.parts.find((part) => part.name === 'body')!;
    const bodyBox = bodyPart.boxes[0]!;
    expect(bodyBox.faceUvFlipU).toEqual({ left: true, right: true });
    expect(bodyBox.faceUvFlipV).toEqual({ top: true });
    expect(bodyPart.boxes[1]?.faceUvFlipU).toBeUndefined();
    expect(bodyPart.boxes[2]?.faceUvFlipV).toBeUndefined();
    expect(BEE_MODEL.parts.find((part) => part.name === 'rightwing_bone')?.boxes[0]?.faceUvFlipU).toEqual({ top: true });
    expect(BEE_MODEL.parts.find((part) => part.name === 'leftwing_bone')?.boxes[0]?.faceUvFlipU).toEqual({ top: true });
    expect(BEE_MODEL.parts.find((part) => part.name === 'stinger')?.boxes[0]?.faceUvFlipU).toBeUndefined();
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
    expect(right.rotation.x).toBeLessThan(-0.2);
    expect(left.rotation.x).toBeLessThan(-0.2);
    const outerTip = (wing: THREE.Object3D) => {
      const mesh = wing.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      let best = new THREE.Vector3();
      let bestAbs = 0;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const world = mesh.localToWorld(new THREE.Vector3(x, y, z));
            if (Math.abs(world.x) >= bestAbs) {
              bestAbs = Math.abs(world.x);
              best = world;
            }
          }
        }
      }
      return best;
    };
    (created.visual as THREE.Object3D).updateMatrixWorld(true);
    const bodyMesh = (created.model.parts.get('body') as THREE.Object3D).children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    const bodyCenter = bodyMesh.getWorldPosition(new THREE.Vector3());
    const raisedRight = outerTip(right);
    const raisedLeft = outerTip(left);
    expect(raisedRight.x).toBeLessThan(bodyCenter.x - 0.15);
    expect(raisedLeft.x).toBeGreaterThan(bodyCenter.x + 0.15);
    expect(raisedRight.y).toBeGreaterThan(bodyCenter.y + 0.08);
    expect(raisedLeft.y).toBeGreaterThan(bodyCenter.y + 0.08);
    expect(Math.abs(Math.abs(raisedRight.x) - Math.abs(raisedLeft.x))).toBeLessThan(0.08);
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

  it('maps yellow head texels to -Z and the wing tip outward', () => {
    const png = decodeRgbaPng(readFileSync(new URL('../public/textures/entity/bee.png', import.meta.url)));
    const texel = (u: number, v: number) => {
      const x = Math.min(63, Math.max(0, Math.floor(u)));
      const y = Math.min(63, Math.max(0, Math.floor(v)));
      const index = (y * 64 + x) * 4;
      return [png.data[index], png.data[index + 1], png.data[index + 2], png.data[index + 3]] as const;
    };
    const scene = new THREE.Scene();
    const host = new ThreeEntityHost(scene);
    const created = host.createMob('pet_bee')!;
    host.syncMob({ ...state('pet_bee', created.model, 0), yaw: 0 });
    const root = created.visual as THREE.Object3D;
    root.updateMatrixWorld(true);
    expect(root.rotation.y).toBeCloseTo(0, 5);
    expect(root.scale.x).toBeCloseTo(PET_BEE_MODEL_SCALE, 5);

    const body = created.model.parts.get('body') as THREE.Object3D;
    const bodyMesh = [...body.children].filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      .map((mesh) => {
        mesh.geometry.computeBoundingBox();
        return mesh;
      })
      .sort((a, b) => b.geometry.boundingBox!.getSize(new THREE.Vector3()).z
        - a.geometry.boundingBox!.getSize(new THREE.Vector3()).z)[0]!;

    type Corner = { world: THREE.Vector3; u: number; v: number };
    const faceCorners = (mesh: THREE.Mesh, normal: readonly [number, number, number]): Corner[] => {
      const position = mesh.geometry.getAttribute('position');
      const normals = mesh.geometry.getAttribute('normal');
      const uv = mesh.geometry.getAttribute('uv');
      const corners: Corner[] = [];
      for (let index = 0; index < position.count; index += 1) {
        if (normals.getX(index) !== normal[0] || normals.getY(index) !== normal[1] || normals.getZ(index) !== normal[2]) continue;
        corners.push({
          world: mesh.localToWorld(new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index))),
          u: uv.getX(index) * 64,
          v: (1 - uv.getY(index)) * 64,
        });
      }
      expect(corners).toHaveLength(4);
      return corners;
    };
    const bilerp = (corners: readonly Corner[], s: number, t: number) => {
      const weights = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t];
      const world = new THREE.Vector3();
      let u = 0;
      let v = 0;
      corners.forEach((corner, index) => {
        world.addScaledVector(corner.world, weights[index]!);
        u += corner.u * weights[index]!;
        v += corner.v * weights[index]!;
      });
      return { world, u, v };
    };
    const depthRed = (mesh: THREE.Mesh, normal: readonly [number, number, number], upperOnly: boolean) => {
      const corners = faceCorners(mesh, normal);
      const samples: { z: number; y: number; r: number; u: number; v: number }[] = [];
      for (const along of [0.08, 0.92]) {
        for (const across of [0.3, 0.5, 0.7]) {
          for (const point of [bilerp(corners, along, across), bilerp(corners, across, along)]) {
            const pixel = texel(point.u, point.v);
            if (pixel[3] < 200) continue;
            samples.push({
              z: Number(point.world.z.toFixed(3)),
              y: Number(point.world.y.toFixed(3)),
              r: pixel[0],
              u: Number(point.u.toFixed(2)),
              v: Number(point.v.toFixed(2)),
            });
          }
        }
      }
      const ys = samples.map((sample) => sample.y);
      const yCut = (Math.min(...ys) + Math.max(...ys)) / 2;
      const band = upperOnly ? samples.filter((sample) => sample.y >= yCut - 1e-4) : samples;
      const minZ = Math.min(...band.map((sample) => sample.z));
      const maxZ = Math.max(...band.map((sample) => sample.z));
      const span = maxZ - minZ;
      const front = band.filter((sample) => sample.z < minZ + span * 0.25);
      const back = band.filter((sample) => sample.z > maxZ - span * 0.25);
      expect(front.length).toBeGreaterThan(1);
      expect(back.length).toBeGreaterThan(1);
      const mean = (points: readonly { r: number }[]) => points.reduce((sum, sample) => sum + sample.r, 0) / points.length;
      return { front: mean(front), back: mean(back), frontPixels: front, backPixels: back };
    };

    const left = depthRed(bodyMesh, [-1, 0, 0], true);
    const right = depthRed(bodyMesh, [1, 0, 0], true);
    const top = depthRed(bodyMesh, [0, 1, 0], false);
    const bottom = depthRed(bodyMesh, [0, -1, 0], false);
    expect(left.front).toBeGreaterThan(left.back + 40);
    expect(right.front).toBeGreaterThan(right.back + 40);
    expect(top.front).toBeGreaterThan(top.back + 40);
    expect(bottom.front).toBeGreaterThan(bottom.back + 20);
    for (const side of [left, right]) {
      expect(Math.max(...side.frontPixels.map((pixel) => pixel.r))).toBeGreaterThan(180);
      expect(Math.max(...side.backPixels.map((pixel) => pixel.r))).toBeLessThan(120);
      expect(Math.min(...side.frontPixels.map((pixel) => pixel.r))).toBeLessThan(80);
    }

    const frontCorners = faceCorners(bodyMesh, [0, 0, -1]);
    const backCorners = faceCorners(bodyMesh, [0, 0, 1]);
    const frontZ = frontCorners.reduce((sum, corner) => sum + corner.world.z, 0) / 4;
    const backZ = backCorners.reduce((sum, corner) => sum + corner.world.z, 0) / 4;
    expect(frontZ).toBeLessThan(-0.1);
    expect(backZ).toBeGreaterThan(0.1);
    const frontPixels = [1, 2, 3].flatMap((s) => [1, 2, 3].map((t) => {
      const point = bilerp(frontCorners, s / 4, t / 4);
      return texel(point.u, point.v);
    }));
    expect(Math.min(...frontPixels.map((pixel) => pixel[0]))).toBeLessThan(80);
    expect(Math.max(...frontPixels.map((pixel) => pixel[0]))).toBeGreaterThan(180);

    const bodyCenter = bodyMesh.getWorldPosition(new THREE.Vector3());
    const antennae = body.children.filter((child) => child instanceof THREE.Mesh && child !== bodyMesh);
    expect(antennae).toHaveLength(2);
    for (const antenna of antennae) {
      expect((antenna as THREE.Mesh).getWorldPosition(new THREE.Vector3()).z).toBeLessThan(bodyCenter.z);
    }
    const stinger = created.model.parts.get('stinger') as THREE.Object3D;
    expect(stinger.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(bodyCenter.z);

    const membrane = (wing: THREE.Object3D) => {
      const mesh = wing.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
      const corners = faceCorners(mesh, [0, 1, 0]);
      const u0 = corners[0]!.u;
      const v0 = corners[0]!.v;
      const us = corners[1]!.u - u0;
      const vs = corners[1]!.v - v0;
      const ut = corners[3]!.u - u0;
      const vt = corners[3]!.v - v0;
      const det = us * vt - vs * ut;
      const minU = Math.min(...corners.map((corner) => corner.u));
      const maxU = Math.max(...corners.map((corner) => corner.u));
      const minV = Math.min(...corners.map((corner) => corner.v));
      const maxV = Math.max(...corners.map((corner) => corner.v));
      let tip = new THREE.Vector3();
      let root = new THREE.Vector3();
      let tipAbs = -1;
      let rootAbs = Number.POSITIVE_INFINITY;
      let count = 0;
      for (let v = Math.floor(minV); v < maxV; v += 1) {
        for (let u = Math.floor(minU); u < maxU; u += 1) {
          if (texel(u + 0.5, v + 0.5)[3] < 128) continue;
          const du = u + 0.5 - u0;
          const dv = v + 0.5 - v0;
          const s = (du * vt - dv * ut) / det;
          const t = (us * dv - vs * du) / det;
          if (s < -0.02 || s > 1.02 || t < -0.02 || t > 1.02) continue;
          const world = bilerp(corners, s, t).world;
          const absX = Math.abs(world.x);
          if (absX > tipAbs) {
            tipAbs = absX;
            tip = world;
          }
          if (absX < rootAbs) {
            rootAbs = absX;
            root = world;
          }
          count += 1;
        }
      }
      expect(count).toBeGreaterThan(8);
      return { tip, root };
    };

    const poseWings = (age: number) => {
      host.syncMob({ ...state('pet_bee', created.model, age), yaw: 0 });
      root.updateMatrixWorld(true);
      const rightWing = membrane(created.model.wings[0] as THREE.Object3D);
      const leftWing = membrane(created.model.wings[1] as THREE.Object3D);
      expect(rightWing.tip.x).toBeLessThan(-0.2);
      expect(leftWing.tip.x).toBeGreaterThan(0.2);
      expect(rightWing.tip.z).toBeGreaterThan(rightWing.root.z);
      expect(leftWing.tip.z).toBeGreaterThan(leftWing.root.z);
      expect(rightWing.tip.z).toBeGreaterThan(frontZ);
      expect(leftWing.tip.z).toBeGreaterThan(frontZ);
      expect(rightWing.tip.y).toBeGreaterThan(bodyCenter.y);
      expect(leftWing.tip.y).toBeGreaterThan(bodyCenter.y);
      expect(Math.abs(Math.abs(rightWing.tip.x) - Math.abs(leftWing.tip.x))).toBeLessThan(0.05);
      expect(Math.abs(rightWing.tip.z - leftWing.tip.z)).toBeLessThan(0.05);
      return { rightWing, leftWing };
    };
    const rest = poseWings(0);
    const raised = poseWings(1 / (4 * 6.5));
    const lowered = poseWings(3 / (4 * 6.5));
    expect(raised.rightWing.tip.y).toBeGreaterThan(rest.rightWing.tip.y);
    expect(lowered.rightWing.tip.y).toBeLessThan(rest.rightWing.tip.y);
    expect(raised.leftWing.tip.y).toBeGreaterThan(lowered.leftWing.tip.y);
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
