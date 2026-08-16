import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MobKind } from '../src/entities/mobDefinitions';
import { createMobModel, MOB_MODEL_DESCRIPTORS } from '../src/entities/mobModels';
import { VoxelVisualFactory } from '../src/entities/voxelVisuals';
import {
  createTexturedCuboidGeometry,
  cuboidUvRects,
  logicalUvToNormalized,
} from '../src/rendering/TexturedCuboid';

const MOB_KINDS: readonly MobKind[] = [
  'cow', 'pig', 'chicken', 'sheep', 'zombie', 'skeleton', 'creeper', 'spider',
];
const ENTITY_TEXTURE_MODULES = import.meta.glob('../public/textures/entity/*.png');

describe('legacy textured mob models', () => {
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
    expect(logicalUvToNormalized([32, 16], [64, 32])).toEqual([0.5, 0.5]);
    expect(logicalUvToNormalized([32, 16], [64, 32], [128, 64])).toEqual([0.5, 0.5]);
    const rects = cuboidUvRects({
      size: [8, 12, 4], textureOffset: [16, 16], logicalTextureSize: [64, 64],
    });
    expect(rects.front).toEqual({ u: 20, v: 20, width: 8, height: 12 });
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
    }
    visuals.dispose();
  });
});
