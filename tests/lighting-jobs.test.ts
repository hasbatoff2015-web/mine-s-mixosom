import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { lightEngineStats, resetLightEngineStats } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

describe('localized lighting jobs', () => {
  it('skips heavy lighting when opacity and emission do not change', () => {
    const world = new VoxelWorld('light-skip');
    world.ensureChunks(8, 8, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    world.setBlock(8, 52, 8, BlockId.TallGrass);
    resetLightEngineStats();
    const skyBefore = lightEngineStats.skyRecomputes;
    const propBefore = lightEngineStats.blockPropagations;
    world.setBlock(8, 52, 8, BlockId.Air);
    expect(lightEngineStats.skyRecomputes).toBe(skyBefore);
    expect(lightEngineStats.blockPropagations).toBe(propBefore);
  });

  it('updates local block light when a torch is removed', () => {
    const world = new VoxelWorld('light-torch');
    world.ensureChunks(8, 8, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    for (let x = 6; x <= 10; x += 1) {
      for (let z = 6; z <= 10; z += 1) {
        for (let y = 40; y <= 50; y += 1) world.setBlock(x, y, z, BlockId.Air);
      }
    }
    expect(world.setBlock(8, 44, 8, BlockId.Torch)).toBe(true);
    expect(world.blockLightAt(8, 44, 8)).toBe(14);
    expect(world.blockLightAt(9, 44, 8)).toBeGreaterThan(0);
    world.setBlock(8, 44, 8, BlockId.Air);
    expect(world.blockLightAt(8, 44, 8)).toBeLessThan(14);
  });

  it('preserves furnace emission transitions', () => {
    const world = new VoxelWorld('light-furnace');
    world.ensureChunks(8, 8, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    world.setBlock(8, 50, 8, BlockId.Furnace);
    const furnace = world.getFurnace(8, 50, 8);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack(ItemId.Coal);
    world.tick();
    expect(world.blockEmissionAt(8, 50, 8)).toBeGreaterThan(0);
    furnace.burnTime = 1;
    world.tick();
    expect(world.blockEmissionAt(8, 50, 8)).toBe(0);
  });

  it('dedupes deferred lighting jobs across rapid edits', () => {
    const world = new VoxelWorld('light-dedupe');
    world.ensureChunks(8, 8, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    const before = world.lightQueueMarks;
    for (let index = 0; index < 12; index += 1) {
      world.applyBlockBatch([{ x: 5 + (index % 3), y: 45, z: 5, block: BlockId.Stone }], { deferLighting: true });
      world.applyBlockBatch([{ x: 5 + (index % 3), y: 45, z: 5, block: BlockId.Air }], { deferLighting: true });
    }
    expect(world.pendingLightJobs).toBeLessThanOrEqual(1);
    expect(world.lightQueueMarks - before).toBeGreaterThan(1);
    world.flushLighting();
    expect(world.pendingLightJobs).toBe(0);
  });

  it('does not full-recompute every overlapping chunk sky for one interior break', () => {
    const world = new VoxelWorld('light-local');
    world.ensureChunks(8, 8, 2);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    for (const chunk of world.chunks.values()) chunk.dirty = false;
    world.pendingMesh.clear();
    resetLightEngineStats();
    const surface = world.surfaceY(8, 8);
    world.setBlock(8, surface, 8, BlockId.Air);
    expect(lightEngineStats.skyRecomputes).toBeLessThanOrEqual(2);
    expect(world.dirtyChunkCount).toBeLessThanOrEqual(2);
  });
});
