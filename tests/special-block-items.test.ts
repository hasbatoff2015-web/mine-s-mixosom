import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BlockId,
  getBlockDefinition,
  ladderPlacementFromHit,
  occupiedDoorFacing,
} from '../src/blocks';
import { CRAFTING_RECIPES } from '../src/crafting';
import {
  FIRST_PERSON_SPRITE_POSE,
  ITEMS,
  ItemId,
  classifyItemForRendering,
  generatedHeldTexturePath,
  isItemObtainable,
  itemHeldMeshKind,
  itemRenderProfile,
  obtainableItems,
} from '../src/items';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import {
  DOOR_THICKNESS,
  LADDER_DEPTH,
  doorFaceTextureUv,
  doorHalfTexture,
  ladderPlaneLocal,
  selectionBoxesForBlock,
} from '../src/rendering/specialBlockGeometry';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
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
}

function quadUSpans(geometry: THREE.BufferGeometry): number[] {
  const uv = geometry.getAttribute('uv');
  const spans: number[] = [];
  for (let vertex = 0; vertex < uv.count; vertex += 4) {
    const values = [uv.getX(vertex), uv.getX(vertex + 1), uv.getX(vertex + 2), uv.getX(vertex + 3)];
    spans.push(Math.max(...values) - Math.min(...values));
  }
  return spans;
}

function geometryBounds(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone();
}

describe('special item held routing', () => {
  it('routes lever, ladder and oak door off the block cube mesh', () => {
    expect(itemHeldMeshKind('lever')).toBe('generated');
    expect(itemHeldMeshKind('ladder')).toBe('generated');
    expect(itemHeldMeshKind('oak_door')).toBe('generated');
    expect(itemHeldMeshKind('torch')).toBe('generated');
    expect(itemHeldMeshKind('stone')).toBe('block_cube');
    expect(itemHeldMeshKind('stone_button')).toBe('special_model');
    expect(itemHeldMeshKind('oak_pressure_plate')).toBe('special_model');
    expect(generatedHeldTexturePath('oak_door')).toBe('generated/oak_door_item');
    expect(generatedHeldTexturePath('lever')).toBe('block/lever');
    expect(generatedHeldTexturePath('ladder')).toBe('block/ladder');

    const factory = new ItemVisualFactory();
    for (const id of ['lever', 'ladder', 'oak_door']) {
      const model = factory.createItemModel(id);
      expect(model.userData.heldMeshKind, id).toBe('generated');
      expect((model.children[0] as THREE.Mesh).name, id).toContain(':generated');
      expect((model.children[0] as THREE.Mesh).name, id).not.toContain(':block');
      expect((model.children[0] as THREE.Mesh).geometry.userData.generatedItem, id).toBeDefined();
    }
    const stone = factory.createItemModel('stone');
    expect(stone.userData.heldMeshKind).toBe('block_cube');
    expect((stone.children[0] as THREE.Mesh).name).toContain(':block');
    expect((stone.children[0] as THREE.Mesh).geometry.getAttribute('position').count).toBe(24);

    const button = factory.createItemModel('stone_button');
    expect(button.userData.heldMeshKind).toBe('special_model');
    expect((button.children[0] as THREE.Mesh).name).toContain(':special');
    const buttonBox = geometryBounds((button.children[0] as THREE.Mesh).geometry);
    expect(buttonBox.max.x - buttonBox.min.x).toBeCloseTo(6 / 16, 6);
    expect(buttonBox.max.y - buttonBox.min.y).toBeCloseTo(4 / 16, 6);

    factory.dispose();
  });

  it('keeps the finalized generated/handheld first-person pose', () => {
    const shared = itemRenderProfile('coal').transforms.firstPersonRightHand;
    expect(itemRenderProfile('lever').transforms.firstPersonRightHand).toBe(shared);
    expect(itemRenderProfile('ladder').transforms.firstPersonRightHand).toBe(shared);
    expect(itemRenderProfile('oak_door').transforms.firstPersonRightHand).toBe(shared);
    expect(itemRenderProfile('torch').transforms.firstPersonRightHand).toBe(shared);
    expect(shared.position).toEqual(FIRST_PERSON_SPRITE_POSE.position);
    expect(FIRST_PERSON_SPRITE_POSE.rotationDeg).toEqual([1, -90, 34]);
    expect(FIRST_PERSON_SPRITE_POSE.scale).toBe(0.60);
    expect(classifyItemForRendering('stone_button')).toBe('block');
    expect(itemRenderProfile('stone_button').transforms.firstPersonRightHand).not.toBe(shared);
  });
});

describe('placed lever', () => {
  it('still meshes the stone base plus pivoted handle', () => {
    const { world, chunk } = emptyChunkWorld('lever-placed');
    writeBlock(world, 4, 40, 4, BlockId.Lever);
    world.setBlockState(4, 40, 4, { attachment: 'floor', facing: 'north', powered: false });
    const meshed = new ChunkMesher(atlasStub, (x, y, z) => world.getBlockState(x, y, z)).build(chunk!, world);
    expect(meshed.cutout.getAttribute('position').count).toBe(48);
    expect(getBlockDefinition(BlockId.Lever).renderShape).toBe('lever');
    const boxes = selectionBoxesForBlock({ renderShape: 'lever' }, { attachment: 'floor', facing: 'north' });
    expect(boxes).toHaveLength(2);
    disposeMeshed(meshed);
  });
});

describe('ladder world geometry and placement', () => {
  it('rejects floor and ceiling hits and keeps N/S/E/W wall facing', () => {
    expect(ladderPlacementFromHit(0, 1, 0)).toBeUndefined();
    expect(ladderPlacementFromHit(0, -1, 0)).toBeUndefined();
    expect(ladderPlacementFromHit(1, 0, 0)).toEqual({ attachment: 'wall', facing: 'east' });
    expect(ladderPlacementFromHit(-1, 0, 0)).toEqual({ attachment: 'wall', facing: 'west' });
    expect(ladderPlacementFromHit(0, 0, 1)).toEqual({ attachment: 'wall', facing: 'south' });
    expect(ladderPlacementFromHit(0, 0, -1)).toEqual({ attachment: 'wall', facing: 'north' });
  });

  it('meshes a thin plane per facing instead of a full cube', () => {
    for (const facing of ['north', 'south', 'east', 'west'] as const) {
      const { world, chunk } = emptyChunkWorld(`ladder-${facing}`);
      writeBlock(world, 3, 40, 3, BlockId.Ladder);
      world.setBlockState(3, 40, 3, { facing });
      const meshed = new ChunkMesher(atlasStub, (x, y, z) => world.getBlockState(x, y, z)).build(chunk!, world);
      expect(meshed.cutout.getAttribute('position').count, facing).toBe(8);
      const box = geometryBounds(meshed.cutout);
      const sizeX = box.max.x - box.min.x;
      const sizeZ = box.max.z - box.min.z;
      const plane = ladderPlaneLocal(facing);
      if (plane.axis === 'x') {
        expect(sizeX, facing).toBeLessThan(0.05);
        expect(sizeZ, facing).toBeCloseTo(1, 5);
        expect(box.min.x).toBeCloseTo(3 + plane.plane, 5);
      } else {
        expect(sizeZ, facing).toBeLessThan(0.05);
        expect(sizeX, facing).toBeCloseTo(1, 5);
        expect(box.min.z).toBeCloseTo(3 + plane.plane, 5);
      }
      const boxes = selectionBoxesForBlock({ renderShape: 'ladder' }, { facing });
      expect(boxes).toHaveLength(1);
      const thin = Math.min(...boxes[0]!.size);
      expect(thin).toBeCloseTo(LADDER_DEPTH, 6);
      expect(thin).toBeLessThan(0.5);
      if (plane.axis === 'x') expect(boxes[0]!.size[0]).toBeCloseTo(LADDER_DEPTH, 6);
      else expect(boxes[0]!.size[2]).toBeCloseTo(LADDER_DEPTH, 6);
      disposeMeshed(meshed);
    }
  });
});

describe('oak door world model', () => {
  it('uses upper/lower textures, hinge UV flip and a 3/16 cuboid rather than full-cube UV', () => {
    expect(doorHalfTexture('lower', { all: 'block/oak_door', bottom: 'block/oak_door', top: 'block/oak_door_upper' }))
      .toBe('block/oak_door');
    expect(doorHalfTexture('upper', { all: 'block/oak_door', bottom: 'block/oak_door', top: 'block/oak_door_upper' }))
      .toBe('block/oak_door_upper');
    expect(doorFaceTextureUv('outer', 'left')).toEqual([0, 0, 1, 1]);
    expect(doorFaceTextureUv('inner', 'left')).toEqual([1, 0, 0, 1]);
    expect(doorFaceTextureUv('outer', 'right')).toEqual([1, 0, 0, 1]);
    expect(doorFaceTextureUv('edge', 'left')[2] - doorFaceTextureUv('edge', 'left')[0]).toBeCloseTo(3 / 16, 6);

    expect(occupiedDoorFacing('south', false, 'left')).toBe('south');
    expect(occupiedDoorFacing('south', true, 'left')).toBe('east');
    expect(occupiedDoorFacing('south', true, 'right')).toBe('west');

    const keys: string[] = [];
    const atlas = {
      tile: (key: string) => {
        keys.push(key);
        return { u0: 0, v0: 0, u1: 1, v1: 1 };
      },
    } as unknown as TextureAtlas;
    const { world, chunk } = emptyChunkWorld('door-uv');
    writeBlock(world, 5, 40, 5, BlockId.OakDoor);
    writeBlock(world, 5, 41, 5, BlockId.OakDoor);
    world.setBlockState(5, 40, 5, { facing: 'south', hinge: 'left', open: false, half: 'lower' });
    world.setBlockState(5, 41, 5, { facing: 'south', hinge: 'left', open: false, half: 'upper' });
    const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk!, world);
    expect(keys).toContain('block/oak_door');
    expect(keys).toContain('block/oak_door_upper');
    expect(meshed.cutout.getAttribute('position').count).toBe(48);
    const spans = quadUSpans(meshed.cutout);
    expect(spans.some((span) => Math.abs(span - 1) < 1e-6)).toBe(true);
    expect(spans.some((span) => Math.abs(span - 3 / 16) < 1e-6)).toBe(true);
    expect(spans.every((span) => span > 0.99)).toBe(false);

    world.setBlockState(5, 40, 5, { facing: 'west', hinge: 'right', open: true, half: 'lower' });
    const opened = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk!, world);
    expect(opened.cutout.getAttribute('position').count).toBeGreaterThan(0);
    const boxes = selectionBoxesForBlock(
      { renderShape: 'door' },
      { facing: 'south', hinge: 'left', open: false, half: 'lower' },
    );
    expect(Math.min(...boxes[0]!.size)).toBeCloseTo(DOOR_THICKNESS, 6);
    disposeMeshed(meshed);
    disposeMeshed(opened);
  });
});

describe('shield gameplay hide', () => {
  it('keeps the internal item but removes obtainable UI/recipe paths', () => {
    expect(ITEMS.some((item) => item.id === ItemId.Shield)).toBe(true);
    expect(isItemObtainable(ItemId.Shield)).toBe(false);
    expect(obtainableItems().some((item) => item.id === ItemId.Shield)).toBe(false);
    expect(CRAFTING_RECIPES.some((recipe) => recipe.output.item === ItemId.Shield)).toBe(false);
    expect(itemHeldMeshKind('shield')).toBe('generated');
  });
});
