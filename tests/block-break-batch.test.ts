import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { lightEngineStats, resetLightEngineStats } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

function prepareSurface(world: VoxelWorld): number {
  world.ensureChunks(8, 8, 1);
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  for (const chunk of world.chunks.values()) chunk.dirty = false;
  world.pendingMesh.clear();
  return world.surfaceY(8, 8);
}

describe('rapid block-break batching', () => {
  it('keeps 30 interior breaks on one pending mesh job', () => {
    const world = new VoxelWorld('break-30');
    prepareSurface(world);
    resetLightEngineStats();
    const marksBefore = world.meshDirtyMarks;
    for (let index = 0; index < 30; index += 1) {
      const x = 4 + (index % 8);
      const z = 4 + Math.floor(index / 8);
      world.applyBlockBatch([{ x, y: 40, z, block: BlockId.Stone }]);
      world.applyBlockBatch([{ x, y: 40, z, block: BlockId.Air }]);
    }
    expect(world.pendingMeshJobs).toBe(1);
    expect(world.dirtyChunkCount).toBe(1);
    expect(world.meshDirtyMarks - marksBefore).toBeGreaterThanOrEqual(30);
  });

  it('merges deferred lighting for a 100-edit creative burst', () => {
    const world = new VoxelWorld('break-100');
    prepareSurface(world);
    const mutations = [];
    for (let index = 0; index < 100; index += 1) {
      const x = 3 + (index % 10);
      const z = 3 + Math.floor(index / 10);
      world.setBlock(x, 42, z, BlockId.Stone);
      mutations.push({ x, y: 42, z, block: BlockId.Air });
    }
    for (const chunk of world.chunks.values()) chunk.dirty = false;
    world.pendingMesh.clear();
    const lightMarks = world.lightQueueMarks;
    for (const mutation of mutations) {
      world.applyBlockBatch([mutation], { deferLighting: true });
    }
    expect(world.pendingLightJobs).toBe(1);
    expect(world.lightQueueMarks - lightMarks).toBe(100);
    expect(world.pendingMeshJobs).toBeGreaterThan(0);
    expect(world.pendingMeshJobs).toBeLessThanOrEqual(4);
    const lightMs = world.flushLighting();
    expect(world.pendingLightJobs).toBe(0);
    expect(lightMs).toBeLessThan(80);
  });

  it('relights a 30-break batch once per affected chunk, not per block', () => {
    const world = new VoxelWorld('break-sky');
    prepareSurface(world);
    const mutations = [];
    for (let index = 0; index < 30; index += 1) {
      const x = 4 + (index % 6);
      const z = 4 + Math.floor(index / 6);
      world.setBlock(x, 42, z, BlockId.Stone);
      mutations.push({ x, y: 42, z, block: BlockId.Air });
    }
    resetLightEngineStats();
    const batch = world.applyBlockBatch(mutations);
    expect(batch.applied).toBe(30);
    expect(batch.skyRecomputes).toBeGreaterThan(0);
    expect(batch.skyRecomputes).toBeLessThanOrEqual(2);
    expect(world.dirtyChunkCount).toBeLessThanOrEqual(2);
  });
});
