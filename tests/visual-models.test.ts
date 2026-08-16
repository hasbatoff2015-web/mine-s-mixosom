import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MobKind } from '../src/entities/mobDefinitions';
import {
  COW_MODEL,
  createMobModel,
  MOB_MODEL_DESCRIPTORS,
  SHEEP_BASE_MODEL,
  SHEEP_WOOL_MODEL,
  SPIDER_MODEL,
} from '../src/entities/mobModels';
import {
  legacyBoxCenterToLocal,
  legacyRotationPointToWorld,
  legacyRotationToThree,
} from '../src/entities/LegacyModel';
import { VoxelVisualFactory } from '../src/entities/voxelVisuals';
import {
  createTexturedCuboidGeometry,
  cuboidUvRects,
  logicalUvToNormalized,
} from '../src/rendering/TexturedCuboid';
import { ATLAS_GUTTER, ATLAS_TILE_SIZE, calculateAtlasLayout } from '../src/rendering/TextureAtlas';

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
      model.root.traverse((object) => {
        if (object instanceof THREE.Mesh) meshes.push(object);
      });
      expect(meshes.length, kind).toBeGreaterThan(2);
      expect(meshes.every((mesh) => {
        const material = mesh.material;
        return !Array.isArray(material) && 'map' in material && material.map instanceof THREE.Texture;
      }), kind).toBe(true);
      model.root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model.root);
      expect(bounds.isEmpty(), kind).toBe(false);
      expect(bounds.min.y, `${kind} model must not float far above its origin`).toBeLessThan(0.55);
      expect(bounds.getSize(new THREE.Vector3()).y, `${kind} model height`).toBeGreaterThan(0.4);
    }
    visuals.dispose();
  });
});
