import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import {
  breakingOverlayBoxes,
  breakingOverlayShapeKey,
  breakingStage,
  breakingTextureKey,
  createBreakingOverlayGeometry,
} from '../src/rendering/BlockBreakingOverlay';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';
import type { VoxelHit } from '../src/world/World';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function hitAt(x: number, y: number, z: number, block: BlockId): VoxelHit {
  return {
    x, y, z, block, distance: 1,
    normal: new THREE.Vector3(0, 1, 0),
    point: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5),
  };
}

describe('block breaking overlay stage mapping', () => {
  it('hides at and below zero, and at completed/broken progress', () => {
    expect(breakingStage(Number.NaN)).toBeNull();
    expect(breakingStage(-1)).toBeNull();
    expect(breakingStage(0)).toBeNull();
    expect(breakingStage(1)).toBeNull();
    expect(breakingStage(1.2)).toBeNull();
  });

  it('maps open progress onto destroy stages 0..9', () => {
    expect(breakingStage(0.01)).toBe(0);
    expect(breakingStage(0.099)).toBe(0);
    expect(breakingStage(0.1)).toBe(1);
    expect(breakingStage(0.5)).toBe(5);
    expect(breakingStage(0.899)).toBe(8);
    expect(breakingStage(0.9)).toBe(9);
    expect(breakingStage(0.999)).toBe(9);
  });

  it('keeps the production texture contract at gui/destroy/destroy_stage_N', () => {
    expect(breakingTextureKey(0)).toBe('gui/destroy/destroy_stage_0');
    expect(breakingTextureKey(9)).toBe('gui/destroy/destroy_stage_9');
    expect(breakingTextureKey(12)).toBe('gui/destroy/destroy_stage_9');
    for (let stage = 0; stage <= 9; stage += 1) {
      const bytes = readFileSync(`public/textures/gui/destroy/destroy_stage_${stage}.png`);
      expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      expect(bytes.readUInt32BE(16)).toBe(32);
      expect(bytes.readUInt32BE(20)).toBe(32);
    }
  });
});

describe('block breaking overlay geometry', () => {
  it('covers each cube face with full 0..1 crack UVs', () => {
    const geometry = createBreakingOverlayGeometry(
      breakingOverlayBoxes({ renderShape: 'cube' }, undefined),
    );
    const uv = geometry.getAttribute('uv');
    expect(uv.count).toBe(24);
    let minU = 1;
    let maxU = 0;
    let minV = 1;
    let maxV = 0;
    for (let index = 0; index < uv.count; index += 1) {
      minU = Math.min(minU, uv.getX(index));
      maxU = Math.max(maxU, uv.getX(index));
      minV = Math.min(minV, uv.getY(index));
      maxV = Math.max(maxV, uv.getY(index));
    }
    expect(minU).toBe(0);
    expect(maxU).toBe(1);
    expect(minV).toBe(0);
    expect(maxV).toBe(1);
    geometry.dispose();
  });

  it('builds distinct cached keys for slab, stairs, fence connections and door', () => {
    const cube = breakingOverlayShapeKey({ renderShape: 'cube' }, undefined);
    const slab = breakingOverlayShapeKey({ renderShape: 'slab' }, { slabType: 'bottom' });
    const stairs = breakingOverlayShapeKey({ renderShape: 'stairs' }, { facing: 'south' }, 'straight');
    const fence = breakingOverlayShapeKey(
      { renderShape: 'fence' },
      undefined,
      '',
      { north: false, south: true, east: false, west: false },
    );
    const isolatedFence = breakingOverlayShapeKey(
      { renderShape: 'fence' },
      undefined,
      '',
      { north: false, south: false, east: false, west: false },
    );
    const door = breakingOverlayShapeKey({ renderShape: 'door' }, { facing: 'south', half: 'lower' });
    expect(new Set([cube, slab, stairs, fence, isolatedFence, door]).size).toBe(6);
    expect(breakingOverlayBoxes({ renderShape: 'slab' }, { slabType: 'bottom' }).length).toBeGreaterThan(0);
    expect(breakingOverlayBoxes({ renderShape: 'stairs' }, { facing: 'east' }, 'straight').length).toBeGreaterThan(1);
    expect(breakingOverlayBoxes(
      { renderShape: 'fence' },
      undefined,
      '',
      { north: false, south: true, east: false, west: false },
    ).length).toBeGreaterThan(1);
    expect(breakingOverlayBoxes({ renderShape: 'door' }, { facing: 'south', half: 'lower' }).length).toBe(1);
  });
});

describe('WorldRenderer breaking overlay', () => {
  it('hides when the hit is missing and when the target block vanishes', () => {
    const world = new VoxelWorld('breaking-hide');
    writeBlock(world, 4, 40, 4, BlockId.Stone);
    const renderer = new WorldRenderer(world, atlasStub);
    renderer.setBreakingProgress(hitAt(4, 40, 4, BlockId.Stone), 0.45);
    expect(renderer.debugBreakingOverlay().visible).toBe(true);
    expect(renderer.debugBreakingOverlay().stage).toBe(4);
    renderer.setBreakingProgress(undefined, 0.45);
    expect(renderer.debugBreakingOverlay().visible).toBe(false);
    renderer.setBreakingProgress(hitAt(4, 40, 4, BlockId.Stone), 0.45);
    writeBlock(world, 4, 40, 4, BlockId.Air);
    renderer.setBreakingProgress(hitAt(4, 40, 4, BlockId.Stone), 0.45);
    expect(renderer.debugBreakingOverlay().visible).toBe(false);
    renderer.dispose();
  });

  it('starts the new target at stage 0 after a mid-break target change', () => {
    const world = new VoxelWorld('breaking-retarget');
    writeBlock(world, 3, 40, 3, BlockId.Stone);
    writeBlock(world, 5, 40, 5, BlockId.Dirt);
    const renderer = new WorldRenderer(world, atlasStub);
    renderer.setBreakingProgress(hitAt(3, 40, 3, BlockId.Stone), 0.65);
    expect(renderer.debugBreakingOverlay().stage).toBe(6);
    renderer.setBreakingProgress(hitAt(5, 40, 5, BlockId.Dirt), 0.05);
    const overlay = renderer.debugBreakingOverlay();
    expect(overlay.visible).toBe(true);
    expect(overlay.stage).toBe(0);
    expect(overlay.x).toBe(5);
    expect(overlay.y).toBe(40);
    expect(overlay.z).toBe(5);
    renderer.dispose();
  });

  it('reuses material and texture for the same stage and geometry for the same shape', () => {
    const world = new VoxelWorld('breaking-reuse');
    writeBlock(world, 1, 40, 1, BlockId.Stone);
    writeBlock(world, 2, 40, 2, BlockId.Stone);
    const renderer = new WorldRenderer(world, atlasStub);
    renderer.setBreakingProgress(hitAt(1, 40, 1, BlockId.Stone), 0.22);
    const first = renderer.debugBreakingOverlay();
    renderer.setBreakingProgress(hitAt(1, 40, 1, BlockId.Stone), 0.29);
    const sameStage = renderer.debugBreakingOverlay();
    expect(sameStage.material).toBe(first.material);
    expect(sameStage.map).toBe(first.map);
    expect(sameStage.geometry).toBe(first.geometry);
    expect(sameStage.stage).toBe(2);
    renderer.setBreakingProgress(hitAt(1, 40, 1, BlockId.Stone), 0.35);
    const nextStage = renderer.debugBreakingOverlay();
    expect(nextStage.material).toBe(first.material);
    expect(nextStage.map).not.toBe(first.map);
    expect(nextStage.geometry).toBe(first.geometry);
    renderer.setBreakingProgress(hitAt(2, 40, 2, BlockId.Stone), 0.35);
    const moved = renderer.debugBreakingOverlay();
    expect(moved.geometry).toBe(first.geometry);
    expect(moved.geometryCacheSize).toBe(1);
    renderer.dispose();
  });

  it('does not dirty or remesh the chunk when mining progress changes', () => {
    const world = new VoxelWorld('breaking-noremsh');
    writeBlock(world, 7, 40, 7, BlockId.Stone);
    const chunk = world.getChunk(0, 0)!;
    chunk.dirty = false;
    const renderer = new WorldRenderer(world, atlasStub);
    const facesBefore = renderer.faceCount;
    renderer.setBreakingProgress(hitAt(7, 40, 7, BlockId.Stone), 0.4);
    renderer.setBreakingProgress(hitAt(7, 40, 7, BlockId.Stone), 0.8);
    expect(chunk.dirty).toBe(false);
    expect(renderer.faceCount).toBe(facesBefore);
    renderer.dispose();
  });

  it('places overlay geometry in world coordinates across a chunk border', () => {
    const world = new VoxelWorld('breaking-border');
    writeBlock(world, 15, 40, 15, BlockId.Stone);
    writeBlock(world, 16, 40, 16, BlockId.Stone);
    const renderer = new WorldRenderer(world, atlasStub);
    renderer.setBreakingProgress(hitAt(15, 40, 15, BlockId.Stone), 0.2);
    expect(renderer.debugBreakingOverlay()).toMatchObject({ visible: true, x: 15, z: 15 });
    renderer.setBreakingProgress(hitAt(16, 40, 16, BlockId.Stone), 0.2);
    expect(renderer.debugBreakingOverlay()).toMatchObject({ visible: true, x: 16, z: 16 });
    renderer.dispose();
  });

  it('uses special-shape overlay boxes for slab stairs fence and door', () => {
    const world = new VoxelWorld('breaking-shapes');
    const renderer = new WorldRenderer(world, atlasStub, (x, y, z) => world.getBlockState(x, y, z));
    writeBlock(world, 4, 40, 4, BlockId.OakSlab);
    world.setBlockState(4, 40, 4, { slabType: 'bottom' });
    renderer.setBreakingProgress(hitAt(4, 40, 4, BlockId.OakSlab), 0.3);
    const slabKey = renderer.debugBreakingOverlay().shapeKey;
    writeBlock(world, 5, 40, 5, BlockId.OakStairs);
    world.setBlockState(5, 40, 5, { facing: 'east', stairHalf: 'bottom' });
    renderer.setBreakingProgress(hitAt(5, 40, 5, BlockId.OakStairs), 0.3);
    const stairKey = renderer.debugBreakingOverlay().shapeKey;
    writeBlock(world, 6, 40, 6, BlockId.OakFence);
    writeBlock(world, 6, 40, 7, BlockId.OakFence);
    renderer.setBreakingProgress(hitAt(6, 40, 6, BlockId.OakFence), 0.3);
    const fenceKey = renderer.debugBreakingOverlay().shapeKey;
    writeBlock(world, 8, 40, 8, BlockId.OakDoor);
    world.setBlockState(8, 40, 8, { facing: 'south', half: 'lower', hinge: 'left', open: false });
    renderer.setBreakingProgress(hitAt(8, 40, 8, BlockId.OakDoor), 0.3);
    const doorKey = renderer.debugBreakingOverlay().shapeKey;
    expect(new Set([slabKey, stairKey, fenceKey, doorKey]).size).toBe(4);
    expect(getBlockDefinition(BlockId.OakSlab).renderShape).toBe('slab');
    renderer.dispose();
  });

  it('disposes overlay resources and detaches the mesh group', () => {
    const world = new VoxelWorld('breaking-dispose');
    writeBlock(world, 1, 40, 1, BlockId.Stone);
    const renderer = new WorldRenderer(world, atlasStub);
    renderer.setBreakingProgress(hitAt(1, 40, 1, BlockId.Stone), 0.5);
    expect(renderer.debugBreakingOverlay().geometryCacheSize).toBe(1);
    renderer.dispose();
    expect(renderer.breaking.group.parent).toBeNull();
    expect(renderer.breaking.isDisposed).toBe(true);
    expect(renderer.debugBreakingOverlay().geometryCacheSize).toBe(0);
    renderer.setBreakingProgress(hitAt(1, 40, 1, BlockId.Stone), 0.5);
    expect(renderer.debugBreakingOverlay().visible).toBe(false);
  });
});
