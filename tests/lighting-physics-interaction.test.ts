import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BlockId,
  buttonPlacementFromHit,
  doorFacingFromYaw,
  getBlockDefinition,
  torchPlacementFromHit,
} from '../src/blocks';
import { FallingBlockManager } from '../src/entities/FallingBlockManager';
import { moveVoxelBody } from '../src/entities/voxelPhysics';
import { DESKTOP_SNEAK_CODE, DESKTOP_SPRINT_CODES } from '../src/input/InputManager';
import { classifyItemForRendering } from '../src/items/itemRenderProfiles';
import { RedstoneSystem } from '../src/redstone';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { doorCollisionBox } from '../src/world/collision';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { recomputeChunkSky, seedChunkBlockLight } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

const visualStub = {
  createItemModel: () => new THREE.Object3D(),
} as unknown as ItemVisualFactory;

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function clearColumn(world: VoxelWorld, x: number, z: number): void {
  for (let y = 1; y < 79; y += 1) writeBlock(world, x, y, z, BlockId.Air);
}

function refreshLight(world: VoxelWorld, x: number, z: number): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  recomputeChunkSky(world, chunk);
  seedChunkBlockLight(world, chunk);
}

describe('lighting, physics and interaction polish', () => {
  it('maps desktop sprint to Shift and sneak to C', () => {
    expect(DESKTOP_SPRINT_CODES).toEqual(['ShiftLeft', 'ShiftRight']);
    expect(DESKTOP_SNEAK_CODE).toBe('KeyC');
  });

  it('propagates torch block light to neighbouring air and keeps occluded cells dark', () => {
    const world = new VoxelWorld('block-light');
    for (let x = 4; x <= 8; x += 1) clearColumn(world, x, 4);
    refreshLight(world, 4, 4);
    expect(world.setBlock(4, 40, 4, BlockId.Torch)).toBe(true);
    expect(world.blockLightAt(4, 40, 4)).toBe(14);
    expect(world.blockLightAt(5, 40, 4)).toBeGreaterThanOrEqual(13);
    expect(world.blockLightAt(8, 40, 4)).toBeGreaterThan(0);
    expect(world.blockLightAt(8, 40, 4)).toBeLessThan(world.blockLightAt(5, 40, 4));

    world.setBlock(4, 60, 4, BlockId.Stone);
    expect(world.skyLightAt(4, 60, 4)).toBe(0);
  });

  it('lets a grounded mob body climb a one-block step without teleporting', () => {
    const world = new VoxelWorld('mob-step');
    for (let x = 0; x <= 4; x += 1) {
      for (let y = 39; y <= 45; y += 1) writeBlock(world, x, y, 2, BlockId.Air);
      writeBlock(world, x, 40, 2, BlockId.Stone);
    }
    writeBlock(world, 2, 41, 2, BlockId.Stone);
    const position = new THREE.Vector3(1.55, 41, 2.5);
    let stepped = false;
    for (let tick = 0; tick < 12; tick += 1) {
      const result = moveVoxelBody(
        world,
        position,
        new THREE.Vector3(6, 0, 0),
        0.05,
        { width: 0.6, height: 1.8 },
        { stepHeight: 1.05 },
      );
      if (result.stepped) stepped = true;
    }
    expect(stepped).toBe(true);
    expect(position.x).toBeGreaterThan(1.7);
    expect(position.y).toBeGreaterThan(41.9);
    expect(position.y).toBeLessThan(42.2);
  });

  it('spawns a falling-block entity after sand loses support and lands it back into the grid', () => {
    const world = new VoxelWorld('falling-sand');
    const scene = new THREE.Scene();
    clearColumn(world, 6, 6);
    writeBlock(world, 6, 50, 6, BlockId.Stone);
    expect(world.setBlock(6, 54, 6, BlockId.Sand)).toBe(true);
    const spawned = [];
    for (let tick = 0; tick < 8; tick += 1) {
      world.tick();
      spawned.push(...world.consumeFallingBlocks());
    }
    expect(spawned).toContainEqual({ x: 6, y: 54, z: 6, block: BlockId.Sand });
    expect(world.getBlock(6, 54, 6, false)).toBe(BlockId.Air);

    const falling = new FallingBlockManager(scene, world, visualStub);
    falling.spawn(BlockId.Sand, 6, 54, 6);
    expect(falling.count).toBe(1);
    for (let tick = 0; tick < 80; tick += 1) falling.update(0.05);
    expect(falling.count).toBe(0);
    expect(world.getBlock(6, 51, 6, false)).toBe(BlockId.Sand);
    falling.dispose();
  });

  it('applies gravity to primed TNT and keeps the fuse', () => {
    const world = new VoxelWorld('primed-fall');
    const scene = new THREE.Scene();
    clearColumn(world, 3, 3);
    writeBlock(world, 3, 40, 3, BlockId.Stone);
    writeBlock(world, 3, 48, 3, BlockId.Tnt);
    const redstone = new RedstoneSystem(world, { root: scene });
    expect(redstone.primeTnt(3, 48, 3)).toBeDefined();
    const startY = redstone.primedTnt[0]!.position.y;
    for (let tick = 0; tick < 20; tick += 1) redstone.update(0.05);
    expect(redstone.primedTntCount).toBe(1);
    expect(redstone.primedTnt[0]!.position.y).toBeLessThan(startY - 1);
    expect(redstone.primedTnt[0]!.fuseSeconds).toBeGreaterThan(2);
    redstone.dispose();
  }, 15_000);

  it('places torches on floor/wall and buttons on floor/wall/ceiling', () => {
    expect(torchPlacementFromHit(0, -1, 0, 0, -1)).toBeUndefined();
    expect(torchPlacementFromHit(0, 1, 0, 0, -1)).toMatchObject({ attachment: 'floor' });
    expect(torchPlacementFromHit(1, 0, 0, 0, -1)).toMatchObject({ attachment: 'wall', facing: 'east' });
    expect(buttonPlacementFromHit(0, 1, 0, 1, 0)).toMatchObject({ attachment: 'floor', facing: 'east' });
    expect(buttonPlacementFromHit(0, -1, 0, 0, 1)).toMatchObject({ attachment: 'ceiling', facing: 'south' });
    expect(buttonPlacementFromHit(0, 0, -1, 0, 1)).toMatchObject({ attachment: 'wall', facing: 'north' });
    expect(doorFacingFromYaw(0)).toBe('north');
  });

  it('builds thin two-block door geometry and rotates collision when opened', () => {
    const world = new VoxelWorld('door-state');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    world.setBlock(8, 40, 8, BlockId.OakDoor);
    world.setBlock(8, 41, 8, BlockId.OakDoor);
    world.setBlockState(8, 40, 8, { facing: 'south', hinge: 'left', open: false, half: 'lower' });
    world.setBlockState(8, 41, 8, { facing: 'south', hinge: 'left', open: false, half: 'upper' });
    const closed = doorCollisionBox(8, 40, 8, world.getBlockState(8, 40, 8));
    expect(closed.maxZ - closed.minZ).toBeCloseTo(3 / 16, 6);
    expect(closed.minZ).toBeCloseTo(8 + 1 - 3 / 16, 6);

    world.setBlockState(8, 40, 8, { facing: 'south', hinge: 'left', open: true, half: 'lower' });
    const opened = doorCollisionBox(8, 40, 8, world.getBlockState(8, 40, 8));
    expect(opened.maxX - opened.minX).toBeCloseTo(3 / 16, 6);

    const mesher = new ChunkMesher(atlasStub, (x, y, z) => world.getBlockState(x, y, z));
    const meshed = mesher.build(chunk, world);
    expect(meshed.cutout.getAttribute('position').count).toBeGreaterThan(0);
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
  });

  it('keeps torch/button/door items on generated special geometry instead of cubes', () => {
    expect(classifyItemForRendering('torch')).toBe('generated');
    expect(classifyItemForRendering('stone_button')).toBe('generated');
    expect(classifyItemForRendering('oak_door')).toBe('generated');
    expect(getBlockDefinition(BlockId.Torch).renderShape).toBe('torch');
    expect(getBlockDefinition(BlockId.StoneButton).renderShape).toBe('button');
    expect(getBlockDefinition(BlockId.OakDoor).renderShape).toBe('door');
    expect(getBlockDefinition(BlockId.OakDoor).occludesFaces).toBe(false);
  });
});
