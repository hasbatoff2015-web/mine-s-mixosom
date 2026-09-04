import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { ChunkMesher, disposeMeshedChunk } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

const atlas = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

describe('farming chunk rendering', () => {
  it('batches hundreds of crop cells into one vegetation BufferGeometry', () => {
    const world = new VoxelWorld('farming-render-batch');
    const chunk = new Chunk(0, 0);
    world.chunks.set('0,0', chunk);
    for (let z = 0; z < 16; z += 1) for (let x = 0; x < 16; x += 1) {
      chunk.set(x, 40, z, BlockId.WheatCrop);
      world.replaceBlockState(x, 40, z, { age: (x + z) % 8 });
    }
    const mesher = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z));
    const result = mesher.build(chunk, world);
    expect(result.vegetation.getAttribute('position').count).toBe(256 * 4 * 4);
    expect(result.faces).toBe(256 * 4);
    expect(result.vegetation.groups).toHaveLength(0);
    disposeMeshedChunk(result);
  });

  it('renders wet/dry farmland in chunk geometry at 15/16 height', () => {
    const world = new VoxelWorld('farming-render-farmland');
    const chunk = new Chunk(0, 0);
    world.chunks.set('0,0', chunk);
    chunk.set(4, 40, 4, BlockId.Farmland);
    world.replaceBlockState(4, 40, 4, { hydrated: true });
    const result = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
    const positions = result.opaque.getAttribute('position');
    let maxY = -Infinity;
    for (let index = 0; index < positions.count; index += 1) maxY = Math.max(maxY, positions.getY(index));
    expect(maxY).toBe(40 + 15 / 16);
    disposeMeshedChunk(result);
  });
});
