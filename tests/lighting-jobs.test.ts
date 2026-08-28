import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { lightingFloodOwner, lightEngineStats, resetLightEngineStats } from '../src/world/LightEngine';
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
    const chamber = [];
    for (let x = 6; x <= 10; x += 1) {
      for (let z = 6; z <= 10; z += 1) {
        for (let y = 40; y <= 50; y += 1) chamber.push({ x, y, z, block: BlockId.Air });
      }
    }
    world.applyBlockBatch(chamber);
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

  it('settles lava emitter light without remesh churn after the flood completes', () => {
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
    const world = new VoxelWorld('lava-light-stable');
    world.setViewCenter(8, 8, 2);
    world.ensureChunks(8, 8, 2);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    const chamber = [];
    for (let x = 4; x <= 12; x += 1) {
      for (let z = 4; z <= 12; z += 1) {
        for (let y = 40; y <= 48; y += 1) chamber.push({ x, y, z, block: BlockId.Air });
      }
    }
    world.applyBlockBatch(chamber);
    world.setBlock(8, 40, 8, BlockId.Stone);
    world.applyBlockBatch([{ x: 8, y: 41, z: 8, block: BlockId.Lava }], { deferLighting: true, scheduleNeighbors: true });
    world.applyBlockBatch([{ x: 9, y: 41, z: 8, block: BlockId.Air }], { deferLighting: true, scheduleNeighbors: true });
    for (let tick = 0; tick < 240; tick += 1) {
      world.tick();
      world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
    }
    let idle = 0;
    for (let tick = 0; tick < 40; tick += 1) {
      world.tick();
      world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
      if (world.fluidWrites === 0 && world.pendingLightJobs === 0 && lightingFloodOwner() === '') idle += 1;
      else idle = 0;
    }
    expect(idle).toBeGreaterThan(5);
    const sample = world.blockLightAt(9, 41, 8);
    expect(sample).toBeGreaterThan(0);
    const versions = [...world.chunks.values()].map((chunk) => chunk.lightVersion);
    for (let step = 0; step < 30; step += 1) {
      world.setViewCenter(8 + (step % 2), 8, 2);
      world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
      world.tick();
      expect(world.blockLightAt(9, 41, 8)).toBe(sample);
    }
    expect([...world.chunks.values()].map((chunk) => chunk.lightVersion)).toEqual(versions);
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
  });
});
