import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  CHUNK_SIZE,
  WORLD_HEIGHT,
  chunkKey,
  floorDiv,
  positiveMod,
} from '../src/core/constants';
import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator } from '../src/world/Generator';
import { VoxelWorld } from '../src/world/World';

function generatedChunk(seed: string, x: number, z: number): Chunk {
  const chunk = new Chunk(x, z);
  new TerrainGenerator(seed).generate(chunk);
  return chunk;
}

describe('chunk coordinates and seeded generation', () => {
  it('maps negative world coordinates to the correct chunk and positive local cell', () => {
    expect([
      [floorDiv(-1, CHUNK_SIZE), positiveMod(-1, CHUNK_SIZE)],
      [floorDiv(-16, CHUNK_SIZE), positiveMod(-16, CHUNK_SIZE)],
      [floorDiv(-17, CHUNK_SIZE), positiveMod(-17, CHUNK_SIZE)],
      [floorDiv(16, CHUNK_SIZE), positiveMod(16, CHUNK_SIZE)],
    ]).toEqual([
      [-1, 15],
      [-1, 0],
      [-2, 15],
      [1, 0],
    ]);

    const world = new VoxelWorld('negative-coordinate-test');
    expect(world.setBlock(-1, WORLD_HEIGHT - 1, -17, BlockId.Tnt)).toBe(true);
    expect(world.getBlock(-1, WORLD_HEIGHT - 1, -17)).toBe(BlockId.Tnt);
    const chunk = world.getChunk(-1, -2, false);
    expect(world.chunks.has(chunkKey(-1, -2))).toBe(true);
    expect(chunk?.get(15, WORLD_HEIGHT - 1, 15)).toBe(BlockId.Tnt);
  });

  it('produces byte-for-byte identical chunks for the same seed and different terrain for another seed', () => {
    const first = generatedChunk('deterministic-alpha', -2, 3);
    const repeated = generatedChunk('deterministic-alpha', -2, 3);
    const otherSeed = generatedChunk('deterministic-beta', -2, 3);

    expect(first.blocks.every((block, index) => block === repeated.blocks[index])).toBe(true);
    expect(first.blocks.some((block, index) => block !== otherSeed.blocks[index])).toBe(true);
    expect(first.generated).toBe(true);
  });

  it('places every compact-world ore in its configured vertical band', () => {
    const bands = new Map<BlockId, readonly [number, number]>([
      [BlockId.CoalOre, [18, 46]],
      [BlockId.IronOre, [8, 40]],
      [BlockId.GoldOre, [4, 24]],
      [BlockId.RedstoneOre, [3, 15]],
      [BlockId.DiamondOre, [3, 11]],
    ]);
    const counts = new Map<BlockId, number>();
    const generator = new TerrainGenerator('ore-distribution-sanity');

    for (let chunkZ = -1; chunkZ <= 1; chunkZ += 1) {
      for (let chunkX = -1; chunkX <= 1; chunkX += 1) {
        const chunk = new Chunk(chunkX, chunkZ);
        generator.generate(chunk);
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          for (let z = 0; z < CHUNK_SIZE; z += 1) {
            for (let x = 0; x < CHUNK_SIZE; x += 1) {
              const block = chunk.get(x, y, z) as BlockId;
              const band = bands.get(block);
              if (band === undefined) continue;
              expect(y).toBeGreaterThanOrEqual(band[0]);
              expect(y).toBeLessThanOrEqual(band[1]);
              counts.set(block, (counts.get(block) ?? 0) + 1);
            }
          }
        }
      }
    }

    for (const ore of bands.keys()) expect(counts.get(ore) ?? 0, BlockId[ore]).toBeGreaterThan(0);
    expect(counts.get(BlockId.CoalOre) ?? 0).toBeGreaterThan(counts.get(BlockId.DiamondOre) ?? 0);
  });
});
