import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { MobKind } from '../src/entities/mobDefinitions';
import {
  CHICKEN_MODEL,
  COW_MODEL,
  createMobModel,
  MOB_MODEL_DESCRIPTORS,
  SHEEP_BASE_MODEL,
  SHEEP_WOOL_MODEL,
  SPIDER_MODEL,
  WOLF_MODEL,
  WOLF_COLLAR_MODEL,
  CAT_MODEL,
  ZOMBIE_MODEL,
} from '../src/entities/mobModels';
import {
  applyCatVisualPose,
  applyWolfVisualPose,
  wolfTailLegacyRotation,
  WOLF_TAIL_ANGRY_PITCH,
  WOLF_TAIL_WILD_PITCH,
} from '../src/entities/petPoses';
import {
  legacyBoxCenterToLocal,
  legacyRotationPointToWorld,
  legacyRotationToThree,
} from '../src/entities/LegacyModel';
import { VoxelVisualFactory } from '../src/entities/voxelVisuals';
import { asObject3D } from './asObject3D';
import {
  createTexturedCuboidGeometry,
  cuboidUvRects,
  logicalUvToNormalized,
} from '../src/rendering/TexturedCuboid';
import { ATLAS_GUTTER, ATLAS_TILE_SIZE, calculateAtlasLayout } from '../src/rendering/TextureAtlas';
// @ts-expect-error untyped ESM PNG decoder shared with pet-textures.test.mjs
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

const MOB_KINDS: readonly MobKind[] = [
  'cow', 'pig', 'chicken', 'sheep', 'wolf', 'cat', 'zombie', 'skeleton', 'creeper', 'spider',
];
const ENTITY_TEXTURE_MODULES = import.meta.glob('../public/textures/entity/**/*.png');

describe('legacy textured mob models', () => {
  it('reserves mip-safe atlas gutters around content tiles', () => {
    const layout = calculateAtlasLayout(70);
    expect(layout.gutter).toBe(ATLAS_GUTTER);
    expect(layout.cellSize).toBe(ATLAS_TILE_SIZE + ATLAS_GUTTER * 2);
    expect(layout.width & (layout.width - 1)).toBe(0);
    expect(layout.height & (layout.height - 1)).toBe(0);
  });
  it('declares every requested mob and every selected local sheet exists', () => {
    expect(Object.keys(MOB_MODEL_DESCRIPTORS).sort()).toEqual([...MOB_KINDS].sort());
    for (const descriptor of Object.values(MOB_MODEL_DESCRIPTORS)) {
      const paths = [descriptor.texturePath, ...(descriptor.overlayTexturePaths ?? [])];
      for (const texturePath of paths) {
        expect(
          Object.keys(ENTITY_TEXTURE_MODULES).some((path) => path.replace(/\\/g, '/').endsWith(`/${texturePath}.png`)),
          texturePath,
        ).toBe(true);
      }
    }
    expect(MOB_MODEL_DESCRIPTORS.sheep.overlayTexturePaths).toContain('entity/sheep_fur');
    expect(MOB_MODEL_DESCRIPTORS.spider.overlayTexturePaths).toContain('entity/spider_eyes');
  });

  it('normalizes legacy UVs identically for 1x and 2x source sheets', () => {
    expect(logicalUvToNormalized([32, 8], [64, 32])).toEqual([0.5, 0.75]);
    expect(logicalUvToNormalized([32, 8], [64, 32], [128, 64])).toEqual([0.5, 0.75]);
    const rects = cuboidUvRects({
      size: [8, 12, 4], textureOffset: [16, 16], logicalTextureSize: [64, 64],
    });
    expect(rects.front).toEqual({ u: 20, v: 20, width: 8, height: 12 });
  });

  it('keeps legacy pivots, addBox origins and reflected rotations as separate transforms', () => {
    expect(legacyRotationPointToWorld([0, 4, -8])).toEqual([0, 1.25, -0.5]);
    const center = legacyBoxCenterToLocal({ origin: [-4, -4, -6], size: [8, 8, 6] });
    expect(center[0]).toBeCloseTo(0);
    expect(center[1]).toBeCloseTo(0);
    expect(center[2]).toBeCloseTo(-0.1875);
    expect(legacyRotationToThree([Math.PI / 2, 0.2, -0.3]))
      .toEqual([-Math.PI / 2, 0.2, 0.3]);

    const cowHead = COW_MODEL.parts.find((part) => part.name === 'head')!;
    expect(cowHead.rotationPoint).toEqual([0, 4, -8]);
    expect(cowHead.boxes[0]?.origin).toEqual([-4, -4, -6]);
  });

  it('keeps sheep skin and wool as separate definitions sharing articulated pivots', () => {
    expect(SHEEP_BASE_MODEL.texturePath).toBe('entity/sheep');
    expect(SHEEP_WOOL_MODEL.texturePath).toBe('entity/sheep_fur');
    expect(SHEEP_BASE_MODEL.parts.map((part) => part.name))
      .toEqual(SHEEP_WOOL_MODEL.parts.map((part) => part.name));
    expect(SHEEP_WOOL_MODEL.parts.flatMap((part) => part.boxes).some((entry) => (entry.inflate ?? 0) > 1))
      .toBe(true);
    expect(SHEEP_BASE_MODEL.parts.find((part) => part.name === 'leg1')?.boxes[0]?.size[1]).toBe(12);
    expect(SHEEP_WOOL_MODEL.parts.find((part) => part.name === 'leg1')?.boxes[0]?.size[1]).toBe(6);
  });

  it('preserves the eight asymmetric legacy spider leg pivots and base angles', () => {
    const legs = SPIDER_MODEL.parts.filter((part) => part.name.startsWith('leg'));
    expect(legs).toHaveLength(8);
    expect(legs.map((part) => part.rotationPoint)).toEqual([
      [-4, 15, 2], [4, 15, 2], [-4, 15, 1], [4, 15, 1],
      [-4, 15, 0], [4, 15, 0], [-4, 15, -1], [4, 15, -1],
    ]);
    expect(legs[0]?.rotation).toEqual([0, Math.PI / 4, -Math.PI / 4]);
    expect(legs[7]?.rotation).toEqual([0, Math.PI / 4, Math.PI / 4]);
  });

  it('keeps chicken 1.8 leg boxes and samples the authored yellow island, not the transparent 26,0 slot', () => {
    const rightLeg = CHICKEN_MODEL.parts.find((part) => part.name === 'rightLeg')!;
    const leftLeg = CHICKEN_MODEL.parts.find((part) => part.name === 'leftLeg')!;
    expect(rightLeg.rotationPoint).toEqual([-2, 19, 1]);
    expect(leftLeg.rotationPoint).toEqual([1, 19, 1]);
    expect(rightLeg.boxes[0]).toMatchObject({ origin: [-1, 0, -3], size: [3, 5, 3], textureOffset: [29, 0] });
    expect(leftLeg.boxes[0]).toMatchObject({ origin: [-1, 0, -3], size: [3, 5, 3], textureOffset: [29, 0], mirror: true });
    expect(rightLeg.boxes[0]?.textureOffset).not.toEqual([26, 0]);
    const model = createMobModel(new VoxelVisualFactory(), 'chicken');
    expect(model.legs).toHaveLength(2);
    expect(model.legSwingSigns).toEqual([1, -1]);
    const pivotY = legacyRotationPointToWorld(rightLeg.rotationPoint)[1];
    const localCenterY = legacyBoxCenterToLocal(rightLeg.boxes[0]!)[1];
    expect(pivotY + localCenterY - rightLeg.boxes[0]!.size[1] / 32).toBeCloseTo(0, 8);
    expect(COW_MODEL.parts.filter((part) => part.name.startsWith('leg'))).toHaveLength(4);
  });

  it('uses classic 64x32 biped UV slots for zombie limbs instead of empty 64x64 player overlays', () => {
    const leftArm = ZOMBIE_MODEL.parts.find((part) => part.name === 'leftArm')?.boxes[0];
    const leftLeg = ZOMBIE_MODEL.parts.find((part) => part.name === 'leftLeg')?.boxes[0];
    const rightArm = ZOMBIE_MODEL.parts.find((part) => part.name === 'rightArm')?.boxes[0];
    const rightLeg = ZOMBIE_MODEL.parts.find((part) => part.name === 'rightLeg')?.boxes[0];
    expect(leftArm).toMatchObject({ textureOffset: [40, 16], mirror: true });
    expect(leftLeg).toMatchObject({ textureOffset: [0, 16], mirror: true });
    expect(rightArm?.textureOffset).toEqual([40, 16]);
    expect(rightLeg?.textureOffset).toEqual([0, 16]);
    expect(leftArm?.textureOffset).not.toEqual([32, 48]);
    expect(leftLeg?.textureOffset).not.toEqual([16, 48]);
  });

  it('keeps all generated UV coordinates normalized and creates six independent faces', () => {
    const geometry = createTexturedCuboidGeometry({
      size: [12, 18, 10], textureOffset: [18, 4], logicalTextureSize: [64, 32],
    });
    const uv = geometry.getAttribute('uv');
    expect(geometry.getAttribute('position').count).toBe(24);
    expect(geometry.getIndex()?.count).toBe(36);
    for (let index = 0; index < uv.count; index += 1) {
      expect(uv.getX(index)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(index)).toBeLessThanOrEqual(1);
      expect(uv.getY(index)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(index)).toBeLessThanOrEqual(1);
    }
    geometry.dispose();
  });

  it('builds every mob as an articulated textured hierarchy', () => {
    const visuals = new VoxelVisualFactory();
    for (const kind of MOB_KINDS) {
      const model = createMobModel(visuals, kind);
      expect(model.root).toBeInstanceOf(THREE.Group);
      expect(model.root.name).toBe(`mob:${kind}`);
      expect(model.legs.length, kind).toBeGreaterThan(0);
      for (const limb of [...model.legs, ...model.arms]) expect(limb).toBeInstanceOf(THREE.Group);
      const meshes: THREE.Mesh[] = [];
      const root = asObject3D(model.root)!;
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) meshes.push(object);
      });
      expect(meshes.length, kind).toBeGreaterThan(2);
      expect(meshes.every((mesh) => {
        const material = mesh.material;
        return !Array.isArray(material) && 'map' in material && material.map instanceof THREE.Texture;
      }), kind).toBe(true);
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      expect(bounds.isEmpty(), kind).toBe(false);
      expect(bounds.min.y, `${kind} model must not float far above its origin`).toBeLessThan(0.55);
      expect(bounds.getSize(new THREE.Vector3()).y, `${kind} model height`).toBeGreaterThan(0.4);
    }
    visuals.dispose();
  });

  it('uses a targeted double-sided material only for the skeleton torso cutout', () => {
    const visuals = new VoxelVisualFactory();
    const skeleton = createMobModel(visuals, 'skeleton');
    const zombie = createMobModel(visuals, 'zombie');
    const skeletonBody = skeleton.parts.get('body')?.children[0] as THREE.Mesh;
    const zombieBody = zombie.parts.get('body')?.children[0] as THREE.Mesh;
    expect((skeletonBody.material as THREE.Material).side).toBe(THREE.DoubleSide);
    expect((zombieBody.material as THREE.Material).side).toBe(THREE.FrontSide);
    visuals.dispose();
  });

  it('keeps the wolf legacy pivots, four legs, mane and tail grounded', () => {
    expect(WOLF_MODEL.logicalTextureSize).toEqual([64, 32]);
    expect(WOLF_MODEL.parts.map((part) => part.name)).toEqual([
      'head', 'body', 'mane', 'leg1', 'leg2', 'leg3', 'leg4', 'tail',
    ]);
    expect(WOLF_MODEL.parts.find((part) => part.name === 'head')?.rotationPoint).toEqual([-1, 13.5, -7]);
    expect(WOLF_MODEL.parts.find((part) => part.name === 'body')).toMatchObject({
      rotationPoint: [0, 14, 2],
      rotation: [Math.PI / 2, 0, 0],
      boxes: [{
        origin: [-4, -2, -3],
        size: [6, 9, 6],
        textureOffset: [18, 14],
        faceUvRects: { top: { u: 30, v: 14, width: 6, height: 6 } },
      }],
    });
    expect(WOLF_MODEL.parts.find((part) => part.name === 'mane')?.rotationPoint).toEqual([-1, 14, -3]);
    expect(WOLF_COLLAR_MODEL.parts[0]?.rotationPoint).toEqual([-1, 14, -3]);
    expect(WOLF_MODEL.parts.find((part) => part.name === 'mane')?.boxes[0]).toMatchObject({
      origin: [-4, -3, -3], size: [8, 6, 7], textureOffset: [21, 0],
    });
    const legs = WOLF_MODEL.parts.filter((part) => part.name.startsWith('leg'));
    expect(legs).toHaveLength(4);
    expect(legs.map((part) => part.rotationPoint)).toEqual([
      [-2.5, 16, 7], [0.5, 16, 7], [-2.5, 16, -4], [0.5, 16, -4],
    ]);
    expect(WOLF_MODEL.parts.find((part) => part.name === 'tail')?.rotationPoint).toEqual([-1, 12, 8]);
    const visuals = new VoxelVisualFactory();
    const model = createMobModel(visuals, 'wolf');
    expect(model.legs).toHaveLength(4);
    expect(model.tail).toBeDefined();
    expect(model.mane).toBeDefined();
    const root = asObject3D(model.root)!;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    expect(bounds.min.y).toBeLessThan(0.2);
    expect(bounds.min.y).toBeGreaterThan(-0.15);
    visuals.dispose();
  });

  it('keeps the cat/ocelot legacy pivots, split tail and grounded legs', () => {
    expect(CAT_MODEL.logicalTextureSize).toEqual([64, 32]);
    expect(CAT_MODEL.parts.map((part) => part.name)).toEqual([
      'head', 'body', 'tail1', 'tail2', 'backLeftLeg', 'backRightLeg', 'frontLeftLeg', 'frontRightLeg',
    ]);
    expect(CAT_MODEL.parts.find((part) => part.name === 'head')?.rotationPoint).toEqual([0, 15, -9]);
    expect(CAT_MODEL.parts.find((part) => part.name === 'body')).toMatchObject({
      rotationPoint: [0, 12, -10],
      rotation: [Math.PI / 2, 0, 0],
      boxes: [{ origin: [-2, 3, -8], size: [4, 16, 6], textureOffset: [20, 0] }],
    });
    const visuals = new VoxelVisualFactory();
    const model = createMobModel(visuals, 'cat');
    expect(model.legs).toHaveLength(4);
    expect(model.tail).toBeDefined();
    expect(model.tail2).toBeDefined();
    const root = asObject3D(model.root)!;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    expect(bounds.min.y).toBeLessThan(0.2);
    expect(bounds.min.y).toBeGreaterThan(-0.3);
    visuals.dispose();
  });

  it('applies sitting poses without accumulating offsets across stand/sit cycles', () => {
    const visuals = new VoxelVisualFactory();
    const wolf = createMobModel(visuals, 'wolf');
    const cat = createMobModel(visuals, 'cat');
    const snapshot = (model: typeof wolf) => [...model.parts.entries()].map(([name, part]) => ({
      name,
      x: part.position.x, y: part.position.y, z: part.position.z,
      rx: part.rotation.x, ry: part.rotation.y, rz: part.rotation.z,
    }));
    applyWolfVisualPose(wolf, false, 0, 0);
    const wolfIdle = snapshot(wolf);
    const catBase = snapshot(cat);
    applyWolfVisualPose(wolf, true, 12, 2);
    applyCatVisualPose(cat, true, 12, 2);
    expect(snapshot(wolf)).not.toEqual(wolfIdle);
    expect(snapshot(cat)).not.toEqual(catBase);
    applyWolfVisualPose(wolf, false, 0, 0);
    applyCatVisualPose(cat, false, 0, 0);
    expect(snapshot(wolf)).toEqual(wolfIdle);
    expect(snapshot(cat)).toEqual(catBase);
    applyWolfVisualPose(wolf, true, 4, 1);
    applyWolfVisualPose(wolf, false, 0, 0);
    applyWolfVisualPose(wolf, true, 9, 3);
    applyWolfVisualPose(wolf, false, 0, 0);
    expect(snapshot(wolf)).toEqual(wolfIdle);
    visuals.dispose();
  });

  it('places wolf mane and collar at the neck, not the middle of the torso', async () => {
    const visuals = new VoxelVisualFactory();
    const model = createMobModel(visuals, 'wolf');
    const root = asObject3D(model.root)!;
    root.traverse((object) => {
      if ((object as { userData?: { petLayer?: string } }).userData?.petLayer === 'collar') {
        object.visible = true;
      }
    });
    root.updateMatrixWorld(true);
    const body = asObject3D(model.parts.get('body')!)!;
    const mane = asObject3D(model.mane ?? model.parts.get('mane')!)!;
    const head = asObject3D(model.head)!;
    const tail = asObject3D(model.tail ?? model.parts.get('tail')!)!;
    const bodyBox = new THREE.Box3().setFromObject(body);
    const maneBox = new THREE.Box3().setFromObject(mane);
    const headBox = new THREE.Box3().setFromObject(head);
    const tailBox = new THREE.Box3().setFromObject(tail);
    const collarBox = new THREE.Box3();
    let hasCollar = false;
    mane.traverse((object) => {
      if ((object as { userData?: { petLayer?: string } }).userData?.petLayer !== 'collar') return;
      const mesh = object as THREE.Mesh;
      if (!mesh.geometry) return;
      hasCollar = true;
      collarBox.expandByObject(mesh);
    });
    expect(hasCollar).toBe(true);
    const maneCenterZ = (maneBox.min.z + maneBox.max.z) * 0.5;
    const bodyCenterZ = (bodyBox.min.z + bodyBox.max.z) * 0.5;
    const collarCenterZ = (collarBox.min.z + collarBox.max.z) * 0.5;
    expect(maneBox.min.z - headBox.max.z).toBeLessThan(0.08);
    expect(headBox.max.z + 1e-6).toBeGreaterThanOrEqual(maneBox.min.z - 0.02);
    expect(bodyBox.min.z - maneBox.max.z).toBeLessThan(0.08);
    expect(maneCenterZ).toBeLessThan(bodyCenterZ);
    expect(maneCenterZ).toBeLessThan((headBox.max.z + bodyCenterZ) * 0.5);
    expect(Math.abs(collarCenterZ - maneCenterZ)).toBeLessThan(0.08);
    expect(collarCenterZ).toBeLessThan(bodyCenterZ);
    expect(bodyBox.max.z).toBeGreaterThan(maneBox.max.z + 0.08);
    expect(tailBox.min.z).toBeGreaterThan(bodyCenterZ);
    visuals.dispose();

    const decoded = decodeRgbaPng(await readFile('public/textures/entity/wolf/wolf.png'));
    const bodyBoxDef = WOLF_MODEL.parts.find((part) => part.name === 'body')!.boxes[0]!;
    const legacyTop = cuboidUvRects({
      size: bodyBoxDef.size, textureOffset: bodyBoxDef.textureOffset, logicalTextureSize: [64, 32],
    }).top;
    const mapped = cuboidUvRects({
      size: bodyBoxDef.size,
      textureOffset: bodyBoxDef.textureOffset,
      logicalTextureSize: [64, 32],
      faceUvRects: bodyBoxDef.faceUvRects,
    });
    expect(sheetOpaqueRatio(decoded, legacyTop)).toBe(0);
    expect(sheetOpaqueRatio(decoded, mapped.top)).toBeGreaterThan(0.9);
    expect(sheetOpaqueRatio(decoded, mapped.front)).toBeGreaterThan(0.9);
    expect(sheetOpaqueRatio(decoded, mapped.back)).toBeGreaterThan(0.9);
    expect(sheetOpaqueRatio(decoded, mapped.left)).toBeGreaterThan(0.9);
    expect(sheetOpaqueRatio(decoded, mapped.right)).toBeGreaterThan(0.9);
  });

  it('keeps cat legs attached under a grounded torso in stand, walk extremes and sitting', () => {
    const visuals = new VoxelVisualFactory();
    const model = createMobModel(visuals, 'cat');
    const root = asObject3D(model.root)!;
    const body = asObject3D(model.parts.get('body')!)!;
    const tail1 = asObject3D(model.tail ?? model.parts.get('tail1')!)!;
    const tail2 = asObject3D(model.tail2 ?? model.parts.get('tail2')!)!;
    const legs = model.legs.map((leg) => asObject3D(leg)!);
    const assertStandingAttachment = (label: string): void => {
      root.updateMatrixWorld(true);
      const torso = new THREE.Box3().setFromObject(body);
      expect(torso.min.y, `${label} torso height`).toBeLessThan(0.4);
      expect(torso.min.y, `${label} torso grounded`).toBeGreaterThan(0.12);
      for (const [index, leg] of legs.entries()) {
        const box = new THREE.Box3().setFromObject(leg);
        const rear = index < 2;
        expect(torso.min.y - box.max.y, `${label} leg ${index} gap`).toBeLessThan(0.05);
        expect(box.max.y, `${label} leg ${index} through spine`).toBeLessThanOrEqual(torso.max.y + (rear ? 0.04 : 0.09));
        expect(box.min.y, `${label} foot`).toBeGreaterThan(-0.08);
        expect(box.min.y, `${label} foot`).toBeLessThan(0.2);
      }
    };
    applyCatVisualPose(model, false, 0, 0);
    assertStandingAttachment('stand');
    applyCatVisualPose(model, false, Math.PI / 2, 4);
    assertStandingAttachment('+walk');
    applyCatVisualPose(model, false, (3 * Math.PI) / 2, 4);
    assertStandingAttachment('-walk');
    applyCatVisualPose(model, true, 0, 0);
    root.updateMatrixWorld(true);
    const sitting = new THREE.Box3().setFromObject(root);
    expect(sitting.min.y).toBeGreaterThan(-0.25);
    expect(sitting.min.y).toBeLessThan(0.2);
    const sitBody = new THREE.Box3().setFromObject(body);
    const sitTail1 = new THREE.Box3().setFromObject(tail1);
    const sitTail2 = new THREE.Box3().setFromObject(tail2);
    expect(sitTail1.min.z).toBeLessThanOrEqual(sitBody.max.z + 0.08);
    expect(sitTail2.min.z).toBeLessThanOrEqual(sitTail1.max.z + 0.08);
    for (const [index, leg] of legs.entries()) {
      const box = new THREE.Box3().setFromObject(leg);
      expect(box.max.y, `sit leg ${index}`).toBeLessThanOrEqual(sitBody.max.y + 0.06);
      expect(box.min.y, `sit foot ${index}`).toBeGreaterThan(-0.2);
      if (index >= 2) {
        expect(sitBody.min.y - box.max.y, `sit front gap ${index}`).toBeLessThan(0.08);
      }
    }
    applyCatVisualPose(model, false, 0, 0);
    visuals.dispose();
  });

  it('poses the wolf tail behind the rump instead of hanging between the rear legs', () => {
    const visuals = new VoxelVisualFactory();
    const model = createMobModel(visuals, 'wolf');
    const root = asObject3D(model.root)!;
    const body = asObject3D(model.parts.get('body')!)!;
    const tail = asObject3D(model.tail ?? model.parts.get('tail')!)!;
    const rearLeft = asObject3D(model.legs[0]!)!;
    const rearRight = asObject3D(model.legs[1]!)!;
    const tailAxis = () => {
      root.updateMatrixWorld(true);
      const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(tail.getWorldQuaternion(new THREE.Quaternion()));
      const origin = new THREE.Vector3();
      tail.getWorldPosition(origin);
      return { origin, dir, tip: origin.clone().addScaledVector(dir, 0.5) };
    };

    const wildLegacy = wolfTailLegacyRotation({ walkPhase: 0, locomotionSpeed: 0 });
    expect(wildLegacy[0]).toBeCloseTo(WOLF_TAIL_WILD_PITCH, 5);
    applyWolfVisualPose(model, false, 0, 0);
    const wildThree = legacyRotationToThree(wildLegacy);
    expect(tail.rotation.x).toBeCloseTo(wildThree[0], 5);
    expect(tail.rotation.y).toBeCloseTo(wildThree[1], 5);
    const wild = tailAxis();
    const bodyBox = new THREE.Box3().setFromObject(body);
    const bodyCenterZ = (bodyBox.min.z + bodyBox.max.z) * 0.5;
    expect(wild.origin.z).toBeGreaterThan(bodyCenterZ);
    expect(wild.tip.z).toBeGreaterThan(wild.origin.z);
    expect(wild.dir.z).toBeGreaterThan(0.35);
    const rearVolume = new THREE.Box3().setFromObject(rearLeft).union(new THREE.Box3().setFromObject(rearRight));
    expect(wild.tip.z).toBeGreaterThan(rearVolume.max.z - 0.05);

    applyWolfVisualPose(model, false, 0.4, 1);
    const walkA = tail.rotation.y;
    const walkAAxis = tailAxis();
    applyWolfVisualPose(model, false, 0.4 + Math.PI, 1);
    const walkB = tail.rotation.y;
    const walkBAxis = tailAxis();
    expect(Math.abs(walkA - walkB)).toBeGreaterThan(0.5);
    expect(walkAAxis.dir.z).toBeGreaterThan(0.2);
    expect(walkBAxis.dir.z).toBeGreaterThan(0.2);
    expect(Math.abs(walkAAxis.dir.y - walkBAxis.dir.y)).toBeLessThan(0.45);

    applyWolfVisualPose(model, false, 0.4, 1, { ownerId: 'owner', health: 8, maxHealth: 8 });
    const tamed = tailAxis();
    expect(tamed.dir.y).toBeGreaterThan(wild.dir.y);
    expect(tamed.dir.z).toBeGreaterThan(0.4);

    applyWolfVisualPose(model, false, 0.4, 1, { angry: true });
    const angry = tailAxis();
    const angryLegacy = wolfTailLegacyRotation({ walkPhase: 0.4, locomotionSpeed: 1, angry: true });
    expect(angryLegacy[0]).toBeCloseTo(WOLF_TAIL_ANGRY_PITCH, 5);
    expect(angryLegacy[1]).toBe(0);
    expect(Math.abs(tail.rotation.y)).toBeLessThan(1e-6);
    expect(angry.dir.z).toBeGreaterThan(0.85);

    applyWolfVisualPose(model, true, 0, 0, { ownerId: 'owner', health: 8, maxHealth: 8 });
    const sitting = tailAxis();
    root.updateMatrixWorld(true);
    const sitRear = new THREE.Box3().setFromObject(rearLeft).union(new THREE.Box3().setFromObject(rearRight));
    const sitBody = new THREE.Box3().setFromObject(body);
    expect(sitting.tip.z).toBeGreaterThan(sitBody.min.z);
    expect(sitting.origin.distanceTo(sitRear.getCenter(new THREE.Vector3()))).toBeGreaterThan(0.12);
    visuals.dispose();
  });
});

function sheetOpaqueRatio(
  decoded: { readonly width: number; readonly height: number; readonly data: Uint8Array | Uint8ClampedArray },
  rect: { readonly u: number; readonly v: number; readonly width: number; readonly height: number },
  logical: readonly [number, number] = [64, 32],
): number {
  const scaleX = decoded.width / logical[0];
  const scaleY = decoded.height / logical[1];
  const u0 = Math.floor(rect.u * scaleX);
  const v0 = Math.floor(rect.v * scaleY);
  const u1 = Math.ceil((rect.u + rect.width) * scaleX);
  const v1 = Math.ceil((rect.v + rect.height) * scaleY);
  let opaque = 0;
  let total = 0;
  for (let y = v0; y < v1; y += 1) {
    for (let x = u0; x < u1; x += 1) {
      if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) continue;
      total += 1;
      if (decoded.data[(y * decoded.width + x) * 4 + 3]! > 8) opaque += 1;
    }
  }
  return total === 0 ? 0 : opaque / total;
}
