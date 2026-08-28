import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { neighborMeshOffsets } from '../src/world/worldJobs';
import { VoxelWorld } from '../src/world/World';

function interiorStone(world: VoxelWorld, x: number, y: number, z: number): void {
  world.setBlock(x, y, z, BlockId.Stone);
}

describe('dirty mesh queue', () => {
  it('coalesces 20 edits of one chunk into a single pending mesh job', () => {
    const world = new VoxelWorld('dirty-20');
    world.ensureChunks(8, 8, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    for (const chunk of world.chunks.values()) {
      chunk.dirty = false;
    }
    world.pendingMesh.clear();
    const marksBefore = world.meshDirtyMarks;
    for (let index = 0; index < 20; index += 1) {
      interiorStone(world, 6, 40 + (index % 4), 6);
      world.setBlock(6, 40 + (index % 4), 6, BlockId.Air);
    }
    expect(world.pendingMeshJobs).toBe(1);
    expect(world.dirtyChunkCount).toBe(1);
    expect(world.meshDirtyMarks - marksBefore).toBeGreaterThanOrEqual(20);
  });

  it('dirties only the required neighbor for a boundary edit', () => {
    expect(neighborMeshOffsets(0, 8)).toEqual([[-1, 0]]);
    expect(neighborMeshOffsets(CHUNK_SIZE - 1, 8)).toEqual([[1, 0]]);
    expect(neighborMeshOffsets(8, 8)).toEqual([]);
    const world = new VoxelWorld('dirty-boundary');
    world.ensureChunks(0, 0, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    for (const chunk of world.chunks.values()) {
      chunk.dirty = false;
    }
    world.pendingMesh.clear();
    world.setBlock(0, 50, 8, BlockId.Stone);
    world.setBlock(0, 50, 8, BlockId.Air);
    const dirty = [...world.chunks.values()].filter((chunk) => chunk.dirty).map((chunk) => `${chunk.x},${chunk.z}`);
    expect(dirty).toContain('0,0');
    expect(dirty).toContain('-1,0');
    expect(dirty.some((key) => key === '0,1' || key === '0,-1' || key === '1,0')).toBe(false);
  });

  it('does not remesh neighbor chunks for an interior edit when lighting stays local', () => {
    const world = new VoxelWorld('dirty-interior');
    world.ensureChunks(8, 8, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    for (const chunk of world.chunks.values()) {
      chunk.dirty = false;
    }
    world.pendingMesh.clear();
    const surface = world.surfaceY(8, 8);
    world.setBlock(8, surface, 8, BlockId.Air);
    const dirty = [...world.chunks.values()].filter((chunk) => chunk.dirty);
    expect(dirty.length).toBe(1);
    expect(dirty[0]?.x).toBe(0);
    expect(dirty[0]?.z).toBe(0);
  });

  it('keeps a single pending job while dirty and allows a follow-up rebuild after clear', () => {
    const world = new VoxelWorld('dirty-version');
    world.ensureChunks(8, 8, 0);
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    chunk.dirty = false;
    world.pendingMesh.clear();
    world.setBlock(8, 40, 8, BlockId.Air);
    world.setBlock(8, 40, 8, BlockId.Stone);
    expect(world.pendingMeshJobs).toBe(1);
    world.setBlock(8, 41, 8, BlockId.Air);
    world.setBlock(8, 41, 8, BlockId.Stone);
    expect(world.pendingMeshJobs).toBe(1);
    chunk.dirty = false;
    world.acknowledgeMeshed(chunk);
    expect(world.pendingMeshJobs).toBe(0);
    world.setBlock(8, 42, 8, BlockId.Air);
    world.setBlock(8, 42, 8, BlockId.Stone);
    expect(world.pendingMeshJobs).toBe(1);
    expect(chunk.dirty).toBe(true);
  });
});
