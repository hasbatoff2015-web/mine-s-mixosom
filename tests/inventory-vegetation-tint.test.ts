import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { prepareSpecialIconPreview, specialIconFaceShade } from '../src/rendering/itemIconPreview';
import { biomeGrassTint, vegetationTextureTint, WHITE_TINT } from '../src/rendering/vegetationTint';

function meshOf(model: THREE.Object3D): THREE.Mesh {
  const mesh = model.children[0];
  if (!(mesh instanceof THREE.Mesh)) throw new Error('block model has no mesh');
  return mesh;
}

function expectVertex(
  color: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  rgb: readonly [number, number, number],
): void {
  expect(color.getX(index)).toBeCloseTo(rgb[0]);
  expect(color.getY(index)).toBeCloseTo(rgb[1]);
  expect(color.getZ(index)).toBeCloseTo(rgb[2]);
}

describe('inventory vegetation tint', () => {
  it('uses the plains grass tint only on leaf faces and the grass-block top', () => {
    const plains = biomeGrassTint(0);
    expect(vegetationTextureTint(undefined, 'block/oak_leaves')).toEqual(plains);
    expect(vegetationTextureTint(undefined, 'block/birch_leaves')).toEqual(plains);
    expect(vegetationTextureTint(undefined, 'block/spruce_leaves')).toEqual(plains);
    expect(vegetationTextureTint(undefined, 'block/grass_block_top')).toEqual(plains);
    expect(vegetationTextureTint(undefined, 'block/grass_block_side')).toBe(WHITE_TINT);
    expect(vegetationTextureTint(undefined, 'block/dirt')).toBe(WHITE_TINT);
    expect(vegetationTextureTint(undefined, 'block/stone')).toBe(WHITE_TINT);
    expect(vegetationTextureTint('grass', 'block/tall_grass', 1)).toEqual(biomeGrassTint(1));
    expect(plains[1]).toBeGreaterThan(plains[0]);
  });

  it('tints cached cube vertices without sharing that material with ordinary blocks', () => {
    const grassFirst = new ItemVisualFactory();
    const grass = meshOf(grassFirst.createItemModel('grass_block'));
    const stone = meshOf(grassFirst.createItemModel('stone'));
    const dirt = meshOf(grassFirst.createItemModel('dirt'));
    const oak = meshOf(grassFirst.createItemModel('oak_leaves'));
    const birch = meshOf(grassFirst.createItemModel('birch_leaves'));
    const spruce = meshOf(grassFirst.createItemModel('spruce_leaves'));
    const plains = biomeGrassTint(0);

    const grassColor = grass.geometry.getAttribute('color');
    expect(grassColor).toBeDefined();
    expectVertex(grassColor!, 8, plains);
    expectVertex(grassColor!, 0, [1, 1, 1]);
    expectVertex(grassColor!, 12, [1, 1, 1]);
    expectVertex(grassColor!, 20, [1, 1, 1]);

    for (const leaves of [oak, birch, spruce]) {
      const color = leaves.geometry.getAttribute('color');
      expect(color).toBeDefined();
      expectVertex(color!, 0, plains);
      expectVertex(color!, 8, plains);
      expectVertex(color!, 12, plains);
    }

    expect(stone.geometry.getAttribute('color')).toBeUndefined();
    expect(dirt.geometry.getAttribute('color')).toBeUndefined();

    const grassMaterial = grass.material as THREE.MeshBasicMaterial;
    const stoneMaterial = stone.material as THREE.MeshBasicMaterial;
    const oakMaterial = oak.material as THREE.MeshBasicMaterial;
    expect(grassMaterial.vertexColors).toBe(true);
    expect(oakMaterial.vertexColors).toBe(true);
    expect(stoneMaterial.vertexColors).toBe(false);
    expect(grassMaterial.color.getHex()).toBe(0xffffff);
    expect(stoneMaterial.color.getHex()).toBe(0xffffff);
    expect(oakMaterial.color.getHex()).toBe(0xffffff);
    expect(grassMaterial).not.toBe(stoneMaterial);
    expect(oakMaterial).not.toBe(grassMaterial);
    expect(oakMaterial).not.toBe(stoneMaterial);
    expect(dirt.material).toBe(stoneMaterial);
    expect((birch.material as THREE.Material)).toBe(oakMaterial);
    expect((spruce.material as THREE.Material)).toBe(oakMaterial);

    const stoneFirst = new ItemVisualFactory();
    const stoneBefore = meshOf(stoneFirst.createItemModel('stone'));
    const grassAfter = meshOf(stoneFirst.createItemModel('grass_block'));
    expect((stoneBefore.material as THREE.MeshBasicMaterial).vertexColors).toBe(false);
    expect((grassAfter.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
    expect(grassAfter.material).not.toBe(stoneBefore.material);
    expect(stoneBefore.geometry.getAttribute('color')).toBeUndefined();

    grassFirst.dispose();
    stoneFirst.dispose();
  });

  it('keeps the icon preview green on leaves and only the grass top', () => {
    const factory = new ItemVisualFactory();
    const plains = biomeGrassTint(0);
    const grassModel = factory.createItemModel('grass_block');
    const oakModel = factory.createItemModel('oak_leaves');
    const stoneModel = factory.createItemModel('stone');
    const grass = meshOf(grassModel);
    const oak = meshOf(oakModel);
    const stone = meshOf(stoneModel);
    const grassSource = grass.geometry;
    const stoneMaterial = stone.material as THREE.MeshBasicMaterial;

    prepareSpecialIconPreview(grass);
    prepareSpecialIconPreview(oak);
    prepareSpecialIconPreview(stone);

    const sideShade = specialIconFaceShade(1, 0, 0);
    const topShade = specialIconFaceShade(0, 1, 0);
    const bottomShade = specialIconFaceShade(0, -1, 0);
    const grassPreview = grass.geometry.getAttribute('color');
    const oakPreview = oak.geometry.getAttribute('color');
    const stonePreview = stone.geometry.getAttribute('color');
    expectVertex(grassPreview!, 8, [plains[0] * topShade, plains[1] * topShade, plains[2] * topShade]);
    expectVertex(grassPreview!, 0, [sideShade, sideShade, sideShade]);
    expectVertex(grassPreview!, 12, [bottomShade, bottomShade, bottomShade]);
    expect(grassPreview!.getY(8)).toBeGreaterThan(grassPreview!.getX(8));
    expect(grassPreview!.getX(0)).toBeCloseTo(grassPreview!.getY(0));

    expectVertex(oakPreview!, 0, [plains[0] * sideShade, plains[1] * sideShade, plains[2] * sideShade]);
    expectVertex(oakPreview!, 8, [plains[0] * topShade, plains[1] * topShade, plains[2] * topShade]);
    expect(oakPreview!.getY(0)).toBeGreaterThan(oakPreview!.getX(0));

    expectVertex(stonePreview!, 0, [sideShade, sideShade, sideShade]);
    expectVertex(stonePreview!, 8, [topShade, topShade, topShade]);
    expect(stoneMaterial.vertexColors).toBe(false);
    expect(grassSource.getAttribute('color')?.getY(8)).toBeCloseTo(plains[1]);
    expect(grass.material).not.toBe(stoneMaterial);

    factory.dispose();
    grass.geometry.dispose();
    oak.geometry.dispose();
    stone.geometry.dispose();
    (grass.material as THREE.Material).dispose();
    (oak.material as THREE.Material).dispose();
    (stone.material as THREE.Material).dispose();
  });
});
