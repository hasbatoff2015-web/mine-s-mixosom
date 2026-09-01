import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { RedstoneSystem } from '../src/redstone';
import { ExplosionQueue } from '../src/world/ExplosionQueue';
import { lightEngineStats, resetLightEngineStats } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

function writeRaw(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function fillSolidCube(world: VoxelWorld, originX: number, originY: number, originZ: number, size: number, block: BlockId): void {
  for (let y = 0; y < size; y += 1) {
    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        writeRaw(world, originX + x, originY + y, originZ + z, block);
      }
    }
  }
}

describe('explosion batch pipeline', () => {
  it('relights a 50-block batch with one sky recompute per affected chunk, not per block', () => {
    const world = new VoxelWorld('batch-sky');
    world.getChunk(0, 0);
    fillSolidCube(world, 0, 40, 0, 1, BlockId.Stone); // ensure chunk exists
    const mutations = [];
    for (let index = 0; index < 50; index += 1) {
      const x = index % 10;
      const z = Math.floor(index / 10);
      writeRaw(world, x, 40, z, BlockId.Stone);
      mutations.push({ x, y: 40, z, block: BlockId.Air });
    }

    resetLightEngineStats();
    const sequentialStart = lightEngineStats.skyRecomputes;
    for (const mutation of mutations) world.setBlock(mutation.x, mutation.y, mutation.z, BlockId.Air);
    const sequentialSky = lightEngineStats.skyRecomputes - sequentialStart;
    expect(world.getBlock(0, 40, 0, false)).toBe(BlockId.Air);

    for (const mutation of mutations) writeRaw(world, mutation.x, mutation.y, mutation.z, BlockId.Stone);
    resetLightEngineStats();
    const batch = world.applyBlockBatch(mutations);
    expect(batch.applied).toBe(50);
    expect(batch.skyRecomputes).toBeLessThanOrEqual(9);
    expect(batch.skyRecomputes).toBeGreaterThan(0);
    expect(sequentialSky).toBeGreaterThan(batch.skyRecomputes * 8);
    expect(world.getBlock(0, 40, 0, false)).toBe(BlockId.Air);
    expect(world.getBlock(9, 40, 4, false)).toBe(BlockId.Air);
  });

  it('dedupes redstone notifications for fifty neighbouring changes', () => {
    const world = new VoxelWorld('batch-redstone');
    world.getChunk(0, 0);
    const redstone = new RedstoneSystem(world);
    const changes = [];
    for (let index = 0; index < 50; index += 1) {
      changes.push({ x: index % 10, y: 40, z: Math.floor(index / 10) });
    }
    redstone.notifyBlocksChanged(changes);
    expect(redstone.pendingPropagation).toBeLessThan(50 * 7);
    expect(redstone.pendingPropagation).toBeGreaterThan(50);
    const again = redstone.pendingPropagation;
    redstone.notifyBlocksChanged(changes);
    expect(redstone.pendingPropagation).toBe(again);
    const focused = new RedstoneSystem(world);
    for (let index = 0; index < 50; index += 1) focused.notifyBlockChanged(5, 40, 5);
    expect(focused.pendingPropagation).toBe(7);
    focused.dispose();
    redstone.dispose();
  });

  it('chains TNT once without a second single-block relight per primed cell', () => {
    const world = new VoxelWorld('chain-tnt');
    const scene = new THREE.Scene();
    fillSolidCube(world, 4, 38, 4, 6, BlockId.Dirt);
    world.setBlock(6, 40, 6, BlockId.Tnt);
    world.setBlock(7, 40, 6, BlockId.Tnt);
    world.setBlock(6, 40, 7, BlockId.Tnt);
    const redstone = new RedstoneSystem(world, { maxPrimedTnt: 64 });
    const primedIds = new Set<string>();
    const queue = new ExplosionQueue();
    queue.enqueue({ x: 6.5, y: 40.5, z: 6.5, radius: 4, power: 4 });
    resetLightEngineStats();
    const stats = queue.process(world, {
      budgetMs: 20,
      maxJobs: 8,
      maxVoxels: 512,
      remainingPrimedCapacity: redstone.primedCapacityRemaining,
      random: () => 0,
      onChainedTnt: (tnt) => {
        const primed = redstone.primeTnt(tnt.x, tnt.y, tnt.z, tnt.fuseSeconds, { blockAlreadyRemoved: true });
        if (primed) primedIds.add(primed.id);
      },
    });
    expect(stats.chainedTnt).toBeGreaterThanOrEqual(2);
    expect(primedIds.size).toBe(stats.chainedTnt);
    expect(world.getBlock(6, 40, 6, false)).toBe(BlockId.Air);
    expect(world.getBlock(7, 40, 6, false)).toBe(BlockId.Air);
    expect(redstone.primedTntCount).toBe(primedIds.size);
    expect(stats.skyRecomputes).toBeLessThanOrEqual(16);
    expect(redstone.primedTnt.every((entity) => entity.fuseSeconds >= 0.5 && entity.fuseSeconds < 1.5)).toBe(true);
    redstone.dispose();
  });

  it('spreads a 32-explosion queue across ticks under a tight time/voxel budget', () => {
    const world = new VoxelWorld('queue-budget');
    fillSolidCube(world, 0, 36, 0, 12, BlockId.Stone);
    const queue = new ExplosionQueue();
    for (let index = 0; index < 32; index += 1) {
      queue.enqueue({ x: 4.5, y: 40.5, z: 4.5, radius: 4, power: 4 });
    }
    let ticks = 0;
    let maxCpu = 0;
    while (queue.pendingCount > 0 && ticks < 40) {
      const stats = queue.process(world, {
        budgetMs: 2,
        maxJobs: 4,
        maxVoxels: 120,
        remainingPrimedCapacity: 64,
        random: () => 0,
      });
      maxCpu = Math.max(maxCpu, stats.cpuMs);
      ticks += 1;
    }
    expect(queue.pendingCount).toBe(0);
    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeLessThan(40);
    expect(maxCpu).toBeLessThan(250);
    expect(world.getBlock(4, 40, 4, false)).toBe(BlockId.Air);
  });

  it('keeps a single TNT-sized blast inside one budget slice', () => {
    const world = new VoxelWorld('single-tnt');
    fillSolidCube(world, 5, 38, 5, 5, BlockId.Dirt);
    const queue = new ExplosionQueue();
    queue.enqueue({ x: 7.5, y: 40.5, z: 7.5, radius: 4, power: 4 });
    const stats = queue.process(world, {
      budgetMs: 3.5,
      maxJobs: 12,
      maxVoxels: 512,
      remainingPrimedCapacity: 64,
      random: () => 0,
    });
    expect(stats.processed).toBe(1);
    expect(queue.pendingCount).toBe(0);
    expect(stats.destroyed).toBeGreaterThan(10);
    expect(stats.cpuMs).toBeLessThan(100);
  });
});
