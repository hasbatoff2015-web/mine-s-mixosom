import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../src/blocks';
import {
  CHUNK_SIZE,
  MAX_GENERATED_SURFACE,
  MAX_WORLD_Y,
  MIN_WORLD_Y,
  WORLD_HEIGHT,
  isValidWorldY,
} from '../src/core/constants';
import { PlayerController } from '../src/player';
import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator } from '../src/world/Generator';
import { VoxelWorld } from '../src/world/World';
import { processChunkLighting } from '../src/world/LightEngine';
import { processFluidQueue } from '../src/world/fluids';

describe('world height 256', () => {
  it('exposes Y 0..255 as the inclusive block range', () => {
    expect(WORLD_HEIGHT).toBe(256);
    expect(MIN_WORLD_Y).toBe(0);
    expect(MAX_WORLD_Y).toBe(255);
    expect(isValidWorldY(0)).toBe(true);
    expect(isValidWorldY(255)).toBe(true);
    expect(isValidWorldY(-1)).toBe(false);
    expect(isValidWorldY(256)).toBe(false);
    expect(isValidWorldY(1.5)).toBe(false);
  });

  it('sizes chunk storage for Y=255 and rejects Y=256 writes', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.blocks.length).toBe(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
    chunk.set(0, 255, 0, BlockId.Stone);
    expect(chunk.get(0, 255, 0)).toBe(BlockId.Stone);
    expect(chunk.occupancyTop).toBe(255);
    chunk.set(0, 256, 0, BlockId.Stone);
    expect(chunk.get(0, 256, 0)).toBe(0);
    const world = new VoxelWorld('height-bounds');
    expect(world.setBlock(4, 255, 4, BlockId.Stone)).toBe(true);
    expect(world.getBlock(4, 255, 4)).toBe(BlockId.Stone);
    expect(world.setBlock(4, 256, 4, BlockId.Stone)).toBe(false);
    expect(world.getBlock(4, 256, 4)).toBe(BlockId.Air);
    expect(world.getBlock(4, -1, 4)).toBe(BlockId.Bedrock);
  });

  it('keeps generated terrain in the historical surface band', () => {
    const generator = new TerrainGenerator('height-surface-pin');
    let max = 0;
    let min = 999;
    for (let z = -64; z <= 64; z += 8) {
      for (let x = -64; x <= 64; x += 8) {
        const height = generator.columnAt(x, z).height;
        max = Math.max(max, height);
        min = Math.min(min, height);
      }
    }
    expect(max).toBeLessThanOrEqual(MAX_GENERATED_SURFACE);
    expect(min).toBeGreaterThanOrEqual(50);
    const chunk = new Chunk(0, 0);
    generator.generate(chunk);
    expect(chunk.occupancyTop).toBeLessThan(120);
    expect(chunk.get(8, 200, 8)).toBe(BlockId.Air);
  });

  it('round-trips a block at Y=255 through save/load', () => {
    const original = new VoxelWorld('high-save');
    original.setBlock(3, 255, 9, BlockId.Glowstone);
    original.setBlockState(3, 255, 9, { attachment: 'floor' });
    const snapshot = {
      timeOfDay: original.timeOfDay,
      modifications: original.serializeModifications(),
      chests: {},
      furnaces: {},
      blockStates: original.serializeBlockStates(),
    };
    const restored = new VoxelWorld('high-save');
    restored.restore(snapshot);
    expect(restored.getBlock(3, 255, 9)).toBe(BlockId.Glowstone);
    expect(restored.getBlockState(3, 255, 9)).toEqual({ attachment: 'floor' });
  });

  it('lights and fluids at high Y without throwing', () => {
    const world = new VoxelWorld('high-light-fluid');
    expect(world.setBlock(8, 255, 8, BlockId.Glowstone)).toBe(true);
    const chunk = world.getChunk(0, 0)!;
    expect(() => processChunkLighting(world, chunk)).not.toThrow();
    expect(world.skyLightAt(8, 255, 8)).toBeGreaterThanOrEqual(0);
    expect(world.blockLightAt(8, 255, 8)).toBe(15);
    expect(world.setBlock(10, 254, 10, BlockId.Water)).toBe(true);
    expect(() => processFluidQueue(world)).not.toThrow();
    expect(world.getBlock(10, 254, 10)).toBe(BlockId.Water);
  });

  it('raycasts a high block and lets the player stand on Y=255', () => {
    const world = new VoxelWorld('high-ray');
    world.setBlock(8, 250, 8, BlockId.Stone);
    const hit = world.raycast(
      new THREE.Vector3(8.5, 254.2, 8.5),
      new THREE.Vector3(0, -1, 0),
      8,
    );
    expect(hit?.y).toBe(250);
    expect(hit?.block).toBe(BlockId.Stone);
    world.setBlock(2, 255, 2, BlockId.Stone);
    const player = new PlayerController({ position: [2.5, 255.2, 2.5] });
    expect(player.intersectsBlock(2, 255, 2)).toBe(true);
    expect(getBlockDefinition(world.getBlock(2, 256, 2)).solid).toBe(false);
  });
});
