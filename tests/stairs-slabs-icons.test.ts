import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BlockId,
  BLOCK_FAMILIES,
  existingPlankFamilies,
  getBlockDefinition,
  isPressurePlateBlock,
  isSlabBlock,
  obtainableStairFamilies,
  slabTypeFromHit,
  slabsCanMerge,
  stairPlacementFromHit,
} from '../src/blocks';
import { CRAFTING_RECIPES } from '../src/crafting';
import {
  FIRST_PERSON_SPRITE_POSE,
  classifyItemForRendering,
  isItemObtainable,
  itemHeldMeshKind,
  itemIconDescriptor,
  itemRenderProfile,
  obtainableItems,
  specialIconCategory,
} from '../src/items';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import {
  defaultSlabType,
  resolveStairShape,
  selectionBoxesForBlock,
  slabLocalBoxes,
  stairLocalBoxes,
} from '../src/rendering/specialBlockGeometry';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { blockCollisionBoxes } from '../src/world/collision';
import { VoxelWorld } from '../src/world/World';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function emptyChunkWorld(seed: string): { world: VoxelWorld; chunk: ReturnType<VoxelWorld['getChunk']> } {
  const world = new VoxelWorld(seed);
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  return { world, chunk };
}

function disposeMeshed(meshed: ReturnType<ChunkMesher['build']>): void {
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  meshed.fire.dispose();
}

function geometryBounds(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone();
}

function maxHeight(boxes: readonly { minY: number; maxY: number }[]): number {
  return Math.max(...boxes.map((box) => box.maxY - Math.floor(box.minY)));
}

describe('stair and slab families', () => {
  it('covers every existing plank family plus cobble/brick/stone brick stairs', () => {
    expect(existingPlankFamilies().map((family) => family.key).sort()).toEqual(['birch', 'oak', 'spruce']);
    for (const family of existingPlankFamilies()) {
      expect(family.stairId, family.key).toBeDefined();
      expect(getBlockDefinition(family.stairId!).renderShape).toBe('stairs');
      expect(getBlockDefinition(family.stairId!).renderShape).not.toBe('cube');
    }
    expect(getBlockDefinition(BlockId.OakStairs).renderShape).toBe('stairs');
    expect(getBlockDefinition(BlockId.CobblestoneStairs).renderShape).toBe('stairs');
    expect(getBlockDefinition(BlockId.BrickStairs).renderShape).toBe('stairs');
    expect(getBlockDefinition(BlockId.StoneBrickStairs).renderShape).toBe('stairs');
    expect(obtainableStairFamilies().some((family) => family.key === 'stone')).toBe(false);
  });

  it('keeps stone_stairs as a hidden legacy id', () => {
    expect(getBlockDefinition(BlockId.StoneStairs).key).toBe('stone_stairs');
    expect(getBlockDefinition(BlockId.StoneStairs).hiddenFromGameplay).toBe(true);
    expect(getBlockDefinition(BlockId.StoneStairs).renderShape).toBe('stairs');
    expect(isItemObtainable('stone_stairs')).toBe(false);
    expect(obtainableItems().some((item) => item.id === 'stone_stairs')).toBe(false);
    expect(CRAFTING_RECIPES.some((recipe) => recipe.output.item === 'stone_stairs')).toBe(false);
  });

  it('does not invent jungle/acacia/dark oak families', () => {
    const keys = BLOCK_FAMILIES.map((family) => family.key);
    expect(keys).not.toContain('jungle');
    expect(keys).not.toContain('acacia');
    expect(keys).not.toContain('dark_oak');
  });
});

describe('stair geometry, state and collision', () => {
  it('uses two boxes for straight stairs instead of a full cube', () => {
    const bottom = stairLocalBoxes('north', 'bottom', 'straight');
    expect(bottom).toHaveLength(2);
    expect(Math.max(...bottom.map((box) => box.maxY))).toBe(1);
    expect(bottom.some((box) => box.maxY <= 0.5 + 1e-9)).toBe(true);
    expect(bottom.every((box) => box.maxX - box.minX < 1 || box.maxY <= 0.5 + 1e-9 || box.maxZ - box.minZ < 1
      || (box.maxX - box.minX === 1 && box.maxY <= 0.5 + 1e-9))).toBe(true);
    const northUpper = bottom.find((box) => box.minY >= 0.5 - 1e-9)!;
    expect(northUpper.maxZ - northUpper.minZ).toBeCloseTo(0.5, 6);

    const east = stairLocalBoxes('east', 'bottom', 'straight');
    const eastUpper = east.find((box) => box.minY >= 0.5 - 1e-9)!;
    expect(eastUpper.minX).toBeCloseTo(0.5, 6);
    expect(eastUpper.maxX).toBeCloseTo(1, 6);
  });

  it('flips to a ceiling stair when half is top', () => {
    const top = stairLocalBoxes('east', 'top', 'straight');
    const full = top.find((box) => box.maxY - box.minY >= 0.5 - 1e-9 && box.maxX - box.minX === 1)!;
    expect(full.minY).toBeCloseTo(0.5, 6);
    expect(full.maxY).toBeCloseTo(1, 6);
  });

  it('resolves inner/outer corners from neighbouring stairs without storing shape', () => {
    const world = new VoxelWorld('stair-corners');
    writeBlock(world, 4, 40, 4, BlockId.OakStairs);
    writeBlock(world, 5, 40, 4, BlockId.OakStairs);
    world.setBlockState(4, 40, 4, { facing: 'east', stairHalf: 'bottom' });
    world.setBlockState(5, 40, 4, { facing: 'south', stairHalf: 'bottom' });
    expect(resolveStairShape(world, 4, 40, 4, world.getBlockState(4, 40, 4))).toBe('outer_right');
  });

  it('keeps collision and selection matching the stair boxes for each facing', () => {
    const world = new VoxelWorld('stair-collision');
    for (const facing of ['north', 'south', 'east', 'west'] as const) {
      writeBlock(world, 3, 41, 3, BlockId.CobblestoneStairs);
      world.setBlockState(3, 41, 3, { facing, stairHalf: 'bottom' });
      const boxes = blockCollisionBoxes(world, 3, 41, 3);
      expect(boxes.length, facing).toBeGreaterThanOrEqual(2);
      expect(maxHeight(boxes), facing).toBeLessThan(1.01);
      expect(boxes.some((box) => box.maxY <= 41.5 + 1e-6), facing).toBe(true);
      const selection = selectionBoxesForBlock(
        getBlockDefinition(BlockId.CobblestoneStairs),
        { facing, stairHalf: 'bottom' },
        0, 0, 0, undefined, 'straight',
      );
      expect(selection.length, facing).toBe(2);
      expect(selection.some((box) => box.size[1] < 0.9), facing).toBe(true);
    }
  });

  it('meshes stairs as partial cuboids, not a full cube', () => {
    const { world, chunk } = emptyChunkWorld('stair-mesh');
    writeBlock(world, 4, 40, 4, BlockId.OakStairs);
    world.setBlockState(4, 40, 4, { facing: 'east', stairHalf: 'bottom' });
    const meshed = new ChunkMesher(atlasStub, (x, y, z) => world.getBlockState(x, y, z)).build(chunk!, world);
    const count = meshed.opaque.getAttribute('position').count;
    expect(count).toBeGreaterThan(24);
    expect(count).toBeLessThan(24 * 4);
    const bounds = geometryBounds(meshed.opaque);
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(1.001);
    expect(bounds.max.y - bounds.min.y).toBeLessThanOrEqual(1.001);
    disposeMeshed(meshed);
  });

  it('routes held stairs through special_model and not GeneratedItemGeometry', () => {
    expect(itemHeldMeshKind('oak_stairs')).toBe('special_model');
    expect(itemHeldMeshKind('cobblestone_stairs')).toBe('special_model');
    expect(classifyItemForRendering('oak_stairs')).toBe('block');
    const factory = new ItemVisualFactory();
    const model = factory.createItemModel('oak_stairs');
    expect(model.userData.heldMeshKind).toBe('special_model');
    const box = geometryBounds((model.children[0] as THREE.Mesh).geometry);
    expect(box.max.y - box.min.y).toBeCloseTo(1, 5);
    expect((model.children[0] as THREE.Mesh).geometry.userData.specialHeldBoxes).toBe(2);
    expect((model.children[0] as THREE.Mesh).geometry.userData.generatedItem).toBeUndefined();
    factory.dispose();
  });

  it('derives placement facing from look and half from hit', () => {
    expect(stairPlacementFromHit(0, 1, 0, 0.2, 1, 0)).toEqual({ facing: 'east', stairHalf: 'bottom' });
    expect(stairPlacementFromHit(0, -1, 0, 0.8, 0, 1)).toEqual({ facing: 'south', stairHalf: 'top' });
    expect(stairPlacementFromHit(1, 0, 0, 0.7, -1, 0)).toEqual({ facing: 'west', stairHalf: 'top' });
  });
});

describe('slab geometry, merge and collision', () => {
  it('uses half-height boxes for bottom/top and a full box for double', () => {
    const bottom = slabLocalBoxes('bottom');
    expect(bottom).toEqual([{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 }]);
    const top = slabLocalBoxes('top');
    expect(top).toEqual([{ minX: 0, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }]);
    const double = slabLocalBoxes('double');
    expect(double).toEqual([{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }]);
    expect(defaultSlabType(undefined)).toBe('bottom');
  });

  it('matches collision to slabType including double-full', () => {
    const world = new VoxelWorld('slab-boxes');
    writeBlock(world, 2, 40, 2, BlockId.OakSlab);
    expect(blockCollisionBoxes(world, 2, 40, 2)[0]).toMatchObject({ minY: 40, maxY: 40.5 });
    world.setBlockState(2, 40, 2, { slabType: 'top' });
    expect(blockCollisionBoxes(world, 2, 40, 2)[0]).toMatchObject({ minY: 40.5, maxY: 41 });
    world.setBlockState(2, 40, 2, { slabType: 'double' });
    expect(blockCollisionBoxes(world, 2, 40, 2)[0]).toMatchObject({ minY: 40, maxY: 41 });
  });

  it('lets a ray pass through the empty half of a bottom slab', () => {
    const { world } = emptyChunkWorld('slab-ray');
    writeBlock(world, 4, 40, 4, BlockId.OakSlab);
    world.setBlockState(4, 40, 4, { slabType: 'bottom' });
    const miss = world.raycast(new THREE.Vector3(4.5, 40.75, 3.2), new THREE.Vector3(0, 0, 1), 3);
    expect(miss?.block === BlockId.OakSlab && miss.x === 4 && miss.y === 40 && miss.z === 4).toBe(false);
    const hit = world.raycast(new THREE.Vector3(4.5, 40.25, 3.2), new THREE.Vector3(0, 0, 1), 3);
    expect(hit).toMatchObject({ x: 4, y: 40, z: 4, block: BlockId.OakSlab });
  });

  it('merges only matching slab ids', () => {
    expect(slabsCanMerge(BlockId.OakSlab, BlockId.OakSlab)).toBe(true);
    expect(slabsCanMerge(BlockId.OakSlab, BlockId.CobblestoneSlab)).toBe(false);
    expect(isSlabBlock(BlockId.OakSlab)).toBe(true);
    expect(isSlabBlock(BlockId.Stone)).toBe(false);
  });

  it('chooses bottom/top from the clicked face and hit height', () => {
    expect(slabTypeFromHit(0, 1, 0, 0.9)).toBe('bottom');
    expect(slabTypeFromHit(0, -1, 0, 0.1)).toBe('top');
    expect(slabTypeFromHit(1, 0, 0, 0.2)).toBe('bottom');
    expect(slabTypeFromHit(1, 0, 0, 0.8)).toBe('top');
  });

  it('meshes a single slab shorter than a cube and a double as a full cube', () => {
    const { world, chunk } = emptyChunkWorld('slab-mesh');
    writeBlock(world, 4, 40, 4, BlockId.StoneSlab);
    world.setBlockState(4, 40, 4, { slabType: 'bottom' });
    const single = new ChunkMesher(atlasStub, (x, y, z) => world.getBlockState(x, y, z)).build(chunk!, world);
    const singleBounds = geometryBounds(single.opaque);
    expect(singleBounds.max.y - singleBounds.min.y).toBeCloseTo(0.5, 5);
    disposeMeshed(single);

    world.setBlockState(4, 40, 4, { slabType: 'double' });
    const doubled = new ChunkMesher(atlasStub, (x, y, z) => world.getBlockState(x, y, z)).build(chunk!, world);
    const doubleBounds = geometryBounds(doubled.opaque);
    expect(doubleBounds.max.y - doubleBounds.min.y).toBeCloseTo(1, 5);
    disposeMeshed(doubled);
  });

  it('uses a half-slab special held model', () => {
    expect(itemHeldMeshKind('oak_slab')).toBe('special_model');
    const factory = new ItemVisualFactory();
    const model = factory.createItemModel('oak_slab');
    const box = geometryBounds((model.children[0] as THREE.Mesh).geometry);
    expect(box.max.y - box.min.y).toBeCloseTo(0.5, 5);
    factory.dispose();
  });

  it('keeps selection half-height for singles and full for doubles', () => {
    const half = selectionBoxesForBlock({ renderShape: 'slab' }, { slabType: 'bottom' });
    expect(half[0]?.size[1]).toBeCloseTo(0.5 + 0.008, 5);
    const full = selectionBoxesForBlock({ renderShape: 'slab' }, { slabType: 'double' });
    expect(full[0]?.size[1]).toBeCloseTo(1 + 0.008, 5);
  });
});

describe('stone pressure plate', () => {
  it('exists, is obtainable, and shares the pressure_plate shape', () => {
    expect(getBlockDefinition(BlockId.StonePressurePlate).renderShape).toBe('pressure_plate');
    expect(getBlockDefinition(BlockId.StonePressurePlate).pressurePlateTrigger).toBe('living');
    expect(getBlockDefinition(BlockId.OakPressurePlate).pressurePlateTrigger).toBe('all');
    expect(isPressurePlateBlock(BlockId.StonePressurePlate)).toBe(true);
    expect(isItemObtainable('stone_pressure_plate')).toBe(true);
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id === 'stone_pressure_plate')).toBe(true);
    expect(itemHeldMeshKind('stone_pressure_plate')).toBe('special_model');
    expect(itemHeldMeshKind('oak_pressure_plate')).toBe('special_model');
    const factory = new ItemVisualFactory();
    const stone = geometryBounds((factory.createItemModel('stone_pressure_plate').children[0] as THREE.Mesh).geometry);
    const wood = geometryBounds((factory.createItemModel('oak_pressure_plate').children[0] as THREE.Mesh).geometry);
    expect(stone.max.y - stone.min.y).toBeCloseTo(1 / 16, 6);
    expect(wood.max.y - wood.min.y).toBeCloseTo(1 / 16, 6);
    factory.dispose();
  });
});

describe('special item icons', () => {
  it('uses special preview categories instead of full-cube textures', () => {
    expect(itemIconDescriptor('stone_button')).toEqual({ kind: 'special_preview', category: 'button' });
    expect(itemIconDescriptor('oak_stairs')).toEqual({ kind: 'special_preview', category: 'stairs' });
    expect(itemIconDescriptor('birch_stairs').category).toBe('stairs');
    expect(itemIconDescriptor('oak_slab')).toEqual({ kind: 'special_preview', category: 'slab' });
    expect(itemIconDescriptor('oak_pressure_plate')).toEqual({ kind: 'special_preview', category: 'pressure_plate' });
    expect(itemIconDescriptor('stone_pressure_plate').category).toBe('pressure_plate');
    expect(specialIconCategory('oak_stairs')).toBe(specialIconCategory('cobblestone_stairs'));
    expect(itemIconDescriptor('stone')).toEqual({ kind: 'special_preview', category: 'generic' });
    expect(itemIconDescriptor('oak_planks').kind).toBe('special_preview');
    expect(itemIconDescriptor('stone_button').kind).toBe('special_preview');
    for (const id of [
      'oak_stairs', 'birch_stairs', 'spruce_stairs', 'cobblestone_stairs', 'brick_stairs', 'stone_brick_stairs',
      'oak_slab', 'birch_slab', 'spruce_slab', 'stone_slab', 'cobblestone_slab', 'brick_slab', 'stone_brick_slab',
      'stone_button', 'oak_pressure_plate', 'stone_pressure_plate',
    ]) {
      expect(itemIconDescriptor(id).kind, id).toBe('special_preview');
    }
  });

  it('keeps the locked generated/handheld first-person pose', () => {
    expect(FIRST_PERSON_SPRITE_POSE).toEqual({
      position: [0.67, -0.29, -0.70],
      rotationDeg: [1, -90, 34],
      scale: 0.60,
    });
    expect(itemRenderProfile('coal').transforms.firstPersonRightHand.position).toEqual(FIRST_PERSON_SPRITE_POSE.position);
  });
});

describe('stair recipes', () => {
  it('crafts 4 stairs from 6 source blocks and 6 slabs from 3', () => {
    const oakStairs = CRAFTING_RECIPES.find((recipe) => recipe.id === 'oak_stairs')!;
    expect(oakStairs.output).toEqual({ item: 'oak_stairs', count: 4 });
    const oakSlab = CRAFTING_RECIPES.find((recipe) => recipe.id === 'oak_slab')!;
    expect(oakSlab.output).toEqual({ item: 'oak_slab', count: 6 });
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id === 'birch_stairs')).toBe(true);
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id === 'spruce_stairs')).toBe(true);
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id === 'brick_stairs')).toBe(true);
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id === 'stone_brick_stairs')).toBe(true);
  });
});
