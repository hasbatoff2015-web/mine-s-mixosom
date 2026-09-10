import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { MobKind } from '../src/entities/mobDefinitions';
import {
  CHICKEN_LEG_FACE_UVS,
  CHICKEN_MODEL,
  COW_MODEL,
  createMobModel,
  MOB_MODEL_DESCRIPTORS,
  SHEEP_BASE_MODEL,
  SHEEP_WOOL_MODEL,
  SPIDER_MODEL,
  ZOMBIE_MODEL,
} from '../src/entities/mobModels';
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

function decodeIndexedPngAlpha(path: URL): { width: number; height: number; alpha: Uint8Array } {
  const png = readFileSync(path);
  let width = 0;
  let height = 0;
  let transparency = Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(3);
      expect(data[12]).toBe(0);
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'tRNS') transparency = data;
    offset += length + 12;
    if (type === 'IEND') break;
  }
  const filtered = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(width * height);
  for (let y = 0, source = 0; y < height; y += 1) {
    const filter = filtered[source++]!;
    for (let x = 0; x < width; x += 1) {
      const raw = filtered[source++]!;
      const left = x > 0 ? pixels[y * width + x - 1]! : 0;
      const above = y > 0 ? pixels[(y - 1) * width + x]! : 0;
      const upperLeft = x > 0 && y > 0 ? pixels[(y - 1) * width + x - 1]! : 0;
      const estimate = left + above - upperLeft;
      const paeth = Math.abs(estimate - left) <= Math.abs(estimate - above)
        && Math.abs(estimate - left) <= Math.abs(estimate - upperLeft)
        ? left
        : Math.abs(estimate - above) <= Math.abs(estimate - upperLeft) ? above : upperLeft;
      const value = filter === 0 ? raw
        : filter === 1 ? raw + left
          : filter === 2 ? raw + above
            : filter === 3 ? raw + Math.floor((left + above) / 2)
              : raw + paeth;
      pixels[y * width + x] = value & 0xff;
    }
  }
  return {
    width,
    height,
    alpha: Uint8Array.from(pixels, (paletteIndex) => transparency[paletteIndex] ?? 255),
  };
}

function opaquePixelsInLogicalRect(
  image: ReturnType<typeof decodeIndexedPngAlpha>,
  rect: { readonly u: number; readonly v: number; readonly width: number; readonly height: number },
): number {
  const scaleX = image.width / 64;
  const scaleY = image.height / 32;
  let opaque = 0;
  for (let y = rect.v * scaleY; y < (rect.v + rect.height) * scaleY; y += 1) {
    for (let x = rect.u * scaleX; x < (rect.u + rect.width) * scaleX; x += 1) {
      if (image.alpha[y * image.width + x]! > 0) opaque += 1;
    }
  }
  return opaque;
}

const MOB_KINDS: readonly MobKind[] = [
  'cow', 'pig', 'chicken', 'sheep', 'zombie', 'skeleton', 'creeper', 'spider',
];
const ENTITY_TEXTURE_MODULES = import.meta.glob('../public/textures/entity/*.png');

describe('legacy textured mob models', () => {
  it('reserves mip-safe atlas gutters around content tiles', () => {
    const layout = calculateAtlasLayout(70);
    expect(layout.gutter).toBe(ATLAS_GUTTER);
    expect(layout.cellSize).toBe(ATLAS_TILE_SIZE + ATLAS_GUTTER * 2);
    expect(layout.width & (layout.width - 1)).toBe(0);
    expect(layout.height & (layout.height - 1)).toBe(0);
  });
  it('declares all eight requested mobs and every selected local sheet exists', () => {
    expect(Object.keys(MOB_MODEL_DESCRIPTORS).sort()).toEqual([...MOB_KINDS].sort());
    for (const descriptor of Object.values(MOB_MODEL_DESCRIPTORS)) {
      const paths = [descriptor.texturePath, ...(descriptor.overlayTexturePaths ?? [])];
      for (const texturePath of paths) {
        expect(
          Object.keys(ENTITY_TEXTURE_MODULES).some((path) => path.endsWith(`/entity/${texturePath.split('/').at(-1)}.png`)),
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

  it('keeps exactly two grounded chicken legs with opposite gait phases', () => {
    const rightLeg = CHICKEN_MODEL.parts.find((part) => part.name === 'rightLeg')!;
    const leftLeg = CHICKEN_MODEL.parts.find((part) => part.name === 'leftLeg')!;
    expect(rightLeg.rotationPoint).toEqual([-2, 19, 1]);
    expect(leftLeg.rotationPoint).toEqual([1, 19, 1]);
    expect(rightLeg.boxes[0]).toMatchObject({
      origin: [-1, 0, -3], size: [3, 5, 3], physicalSize: [1, 5, 1],
      textureOffset: [26, 0], faceUvRects: CHICKEN_LEG_FACE_UVS,
    });
    expect(leftLeg.boxes[0]).toMatchObject({
      origin: [-1, 0, -3], size: [3, 5, 3], physicalSize: [1, 5, 1], textureOffset: [26, 0], mirror: true,
      faceUvRects: CHICKEN_LEG_FACE_UVS,
    });
    const model = createMobModel(new VoxelVisualFactory(), 'chicken');
    expect(model.legs).toHaveLength(2);
    expect(model.legSwingSigns).toEqual([1, -1]);
    const pivotY = legacyRotationPointToWorld(rightLeg.rotationPoint)[1];
    const localCenterY = legacyBoxCenterToLocal(rightLeg.boxes[0]!)[1];
    expect(pivotY + localCenterY - rightLeg.boxes[0]!.size[1] / 32).toBeCloseTo(0, 8);
    expect(COW_MODEL.parts.filter((part) => part.name.startsWith('leg'))).toHaveLength(4);
  });

  it('reuses the authored 128x64 foot/shin islands on every visible leg face', () => {
    const image = decodeIndexedPngAlpha(new URL('../public/textures/entity/chicken.png', import.meta.url));
    expect([image.width, image.height]).toEqual([128, 64]);
    const rawFaces = cuboidUvRects({
      size: [3, 5, 3], textureOffset: [26, 0], logicalTextureSize: [64, 32],
    });
    expect(opaquePixelsInLogicalRect(image, rawFaces.bottom)).toBeGreaterThan(0);
    expect(opaquePixelsInLogicalRect(image, rawFaces.back)).toBeGreaterThan(0);
    for (const face of ['top', 'left', 'front', 'right'] as const) {
      expect(opaquePixelsInLogicalRect(image, rawFaces[face]), face).toBe(0);
    }
    const visibleFaces = cuboidUvRects({
      size: [3, 5, 3], textureOffset: [26, 0], logicalTextureSize: [64, 32],
      faceUvRects: CHICKEN_LEG_FACE_UVS,
    });
    for (const face of ['top', 'bottom', 'left', 'front', 'right', 'back'] as const) {
      expect(opaquePixelsInLogicalRect(image, visibleFaces[face]), face).toBeGreaterThan(0);
    }
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
});
