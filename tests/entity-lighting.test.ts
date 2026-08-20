import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { sampleEntityLight } from '../src/rendering/worldLighting';
import { recomputeChunkSky, seedChunkBlockLight } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function refreshLight(world: VoxelWorld, x: number, z: number): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  recomputeChunkSky(world, chunk);
  seedChunkBlockLight(world, chunk);
}

function luminance(rgb: readonly [number, number, number]): number {
  return (rgb[0] + rgb[1] + rgb[2]) / 3;
}

describe('entity voxel lighting', () => {
  it('keeps daylight mobs bright instead of Lambert-black', () => {
    const world = new VoxelWorld('entity-daylight');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    for (let x = 4; x <= 10; x += 1) {
      for (let z = 4; z <= 10; z += 1) writeBlock(world, x, 40, z, BlockId.GrassBlock);
    }
    refreshLight(world, 6, 6);
    const sample = sampleEntityLight(world, 6.5, 41, 6.5, 1.4, 1);
    expect(sample.sky).toBeGreaterThan(0.8);
    expect(luminance(sample.rgb)).toBeGreaterThan(0.7);
    expect(sample.rgb[0]).toBeCloseTo(sample.rgb[2], 1);
  });

  it('leaves cave mobs dark without a torch and does not invent a global ambient floor', () => {
    const world = new VoxelWorld('entity-cave-dark');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Stone);
    writeBlock(world, 6, 40, 6, BlockId.Air);
    writeBlock(world, 6, 41, 6, BlockId.Air);
    writeBlock(world, 6, 42, 6, BlockId.Air);
    refreshLight(world, 6, 6);
    const sample = sampleEntityLight(world, 6.5, 40, 6.5, 1.8, 1);
    expect(sample.sky).toBeLessThan(0.15);
    expect(sample.block).toBeLessThan(0.08);
    expect(luminance(sample.rgb)).toBeLessThan(0.2);
    expect(luminance(sample.rgb)).toBeGreaterThan(0);
  });

  it('lights a cave mob with a warm torch tint from multi-sample block light', () => {
    const world = new VoxelWorld('entity-cave-torch');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Stone);
    for (let y = 40; y <= 43; y += 1) {
      for (let x = 5; x <= 8; x += 1) {
        for (let z = 5; z <= 8; z += 1) writeBlock(world, x, y, z, BlockId.Air);
      }
    }
    writeBlock(world, 6, 40, 6, BlockId.Torch);
    refreshLight(world, 6, 6);
    const sample = sampleEntityLight(world, 7.5, 40, 6.5, 1.8, 1);
    expect(sample.block).toBeGreaterThan(0.4);
    expect(luminance(sample.rgb)).toBeGreaterThan(0.35);
    expect(sample.rgb[0]).toBeGreaterThan(sample.rgb[2] + 0.15);
  });

  it('averages feet, torso and head samples instead of using a single point', () => {
    const world = new VoxelWorld('entity-multisample');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Stone);
    for (let y = 40; y <= 44; y += 1) {
      writeBlock(world, 6, y, 6, BlockId.Air);
      writeBlock(world, 7, y, 6, BlockId.Air);
    }
    writeBlock(world, 6, 40, 6, BlockId.Torch);
    refreshLight(world, 6, 6);
    const averaged = sampleEntityLight(world, 6.5, 40, 6.5, 1.8, 1);
    const feet = sampleEntityLight(world, 6.5, 40, 6.5, 0.2, 1);
    const head = sampleEntityLight(world, 6.5, 41.5, 6.5, 0.2, 1);
    expect(averaged.block).toBeLessThan(feet.block);
    expect(averaged.block).toBeGreaterThan(head.block);
    expect(averaged.block).toBeGreaterThan((feet.block + head.block) / 2 - 0.2);
  });
});
