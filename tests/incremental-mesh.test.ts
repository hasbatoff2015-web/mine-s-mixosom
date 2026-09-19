import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { chunkKey, MESH_SECTION_HEIGHT } from '../src/core/constants';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function readyChunk(seed: string): { world: VoxelWorld; renderer: WorldRenderer } {
  const world = new VoxelWorld(seed);
  world.deferredLighting = true;
  const chunk = world.getChunk(0, 0)!;
  for (let z = 0; z < 16; z += 1) {
    for (let x = 0; x < 16; x += 1) chunk.set(x, 70, z, BlockId.Stone);
  }
  chunk.noteMeshDirtyAllY();
  chunk.skyReady = true;
  chunk.skyLateralReady = true;
  chunk.blockLightReady = true;
  chunk.dirty = true;
  const renderer = new WorldRenderer(world, atlasStub);
  return { world, renderer };
}

describe('incremental section meshing', () => {
  it('stops after the budgeted section and keeps the chunk dirty until the range is done', () => {
    const { world, renderer } = readyChunk('mesh-incremental');
    const chunk = world.getChunk(0, 0, false)!;
    const range = chunk.meshSectionRange(chunk.scanMaxY());
    expect(range.maxSection - range.minSection).toBeGreaterThan(0);

    let t = 0;
    const rebuilt = renderer.rebuildDirty(2, 4, 8, 8, {
      requireNeighborLight: false,
      allowPendingLighting: true,
      now: () => t,
      onSectionWork: () => { t += 10; },
    });
    expect(rebuilt).toBe(0);
    expect(chunk.dirty).toBe(true);
    const job = renderer.meshJobDebug(chunkKey(0, 0));
    expect(job).toBeDefined();
    expect(job!.nextSection).toBe(job!.minSection + 1);
    expect(renderer.sectionCount(chunkKey(0, 0))).toBe(1);

    let frames = 0;
    while (chunk.dirty && frames < 32) {
      t = 0;
      renderer.rebuildDirty(2, 4, 8, 8, {
        requireNeighborLight: false,
        allowPendingLighting: true,
        now: () => t,
        onSectionWork: () => { t += 10; },
      });
      frames += 1;
    }
    expect(chunk.dirty).toBe(false);
    expect(renderer.meshJobDebug(chunkKey(0, 0))).toBeUndefined();
    expect(renderer.sectionCount(chunkKey(0, 0))).toBeGreaterThanOrEqual(
      Math.floor(70 / MESH_SECTION_HEIGHT) + 1,
    );
    expect(frames).toBeGreaterThan(1);
  });

  it('cancels a stale in-progress job when the player leaves the mesh radius', () => {
    const { world, renderer } = readyChunk('mesh-stale');
    const chunk = world.getChunk(0, 0, false)!;
    let t = 0;
    renderer.rebuildDirty(1, 4, 8, 8, {
      meshRadius: 2,
      requireNeighborLight: false,
      allowPendingLighting: true,
      now: () => t,
      onSectionWork: () => { t += 10; },
    });
    expect(renderer.meshJobDebug(chunkKey(0, 0))).toBeDefined();
    expect(renderer.cancelObsoleteMeshJobs(40, 40, 2)).toBeGreaterThan(0);
    expect(renderer.meshJobDebug(chunkKey(0, 0))).toBeUndefined();
    expect(chunk.dirty).toBe(true);
  });

  it('does not start a second section when the fake clock is already over budget', () => {
    const { renderer } = readyChunk('mesh-budget');
    let t = 0;
    renderer.rebuildDirty(4, 4, 8, 8, {
      requireNeighborLight: false,
      allowPendingLighting: true,
      now: () => t,
      onSectionWork: () => { t += 10; },
    });
    const job = renderer.meshJobDebug(chunkKey(0, 0))!;
    expect(job.nextSection - job.minSection).toBe(1);
  });

  it('rebuilds a mutated already-meshed section instead of finishing the stale job as clean', () => {
    const { world, renderer } = readyChunk('mesh-stale-section');
    const chunk = world.getChunk(0, 0, false)!;
    const neighbor = world.getChunk(-1, 0)!;
    neighbor.skyReady = true;
    neighbor.skyLateralReady = true;
    neighbor.blockLightReady = true;
    neighbor.dirty = false;
    neighbor.clearMeshDirtyRange();
    const key = chunkKey(0, 0);
    const dirtyMin = chunk.meshDirtyMinY;
    const dirtyMax = chunk.meshDirtyMaxY;
    const dirtyAll = chunk.meshDirtyAllY;
    expect(dirtyAll).toBe(true);

    rebuildOneSection(renderer);
    const afterFirst = renderer.meshJobDebug(key);
    expect(afterFirst).toBeDefined();
    expect(afterFirst!.nextSection).toBe(afterFirst!.minSection + 1);
    expect(chunk.dirty).toBe(true);
    expect(renderer.sectionChests(key, 0)).toEqual([]);

    const versionBefore = chunk.meshContentVersion;
    world.setBlock(8, 8, 8, BlockId.Chest);
    world.setBlockState(8, 8, 8, { facing: 'east' });
    expect(chunk.meshContentVersion).toBeGreaterThan(versionBefore);
    expect(chunk.meshDirtyAllY).toBe(dirtyAll);
    expect(chunk.meshDirtyMinY).toBe(dirtyMin);
    expect(chunk.meshDirtyMaxY).toBe(dirtyMax);
    expect(chunk.dirty).toBe(true);
    const afterMutate = renderer.meshJobDebug(key);
    expect(afterMutate?.nextSection).toBe(afterFirst!.nextSection);
    expect(chunk.meshContentVersion).toBeGreaterThan(afterMutate!.contentVersion);

    const neighborVersion = neighbor.meshContentVersion;
    world.setBlock(0, 8, 8, BlockId.GoldBlock);
    expect(neighbor.dirty).toBe(true);
    expect(neighbor.meshContentVersion).toBeGreaterThan(neighborVersion);

    rebuildOneSection(renderer);
    expect(renderer.meshJobDebug(key)?.stale).toBe(true);

    let keptDirtyAfterFirstPass = false;
    let frames = 0;
    while (chunk.dirty && frames < 64) {
      rebuildOneSection(renderer);
      const job = renderer.meshJobDebug(key);
      if (!job && chunk.dirty) keptDirtyAfterFirstPass = true;
      frames += 1;
    }
    expect(keptDirtyAfterFirstPass).toBe(true);
    expect(chunk.dirty).toBe(false);
    expect(renderer.sectionChests(key, 0)).toEqual(expect.arrayContaining([{ x: 8, y: 8, z: 8 }]));
    expect(world.getBlock(8, 8, 8)).toBe(BlockId.Chest);
    expect(world.getBlockState(8, 8, 8)).toEqual({ facing: 'east' });
  });
});

function rebuildOneSection(renderer: WorldRenderer): void {
  let t = 0;
  renderer.rebuildDirty(2, 4, 8, 8, {
    requireNeighborLight: false,
    allowPendingLighting: true,
    now: () => t,
    onSectionWork: () => { t += 10; },
  });
}
