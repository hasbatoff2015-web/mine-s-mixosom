import { describe, expect, it, vi } from 'vitest';
import {
  BLOCK_REGISTRY,
  BlockId,
  getBlockDefinition,
  isKnownBlockId,
} from '../src/blocks';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { blockCollisionBoxes } from '../src/world/collision';
import { canReplaceWithFluid } from '../src/world/fluids';
import { blockSelectionBoxes } from '../src/world/selection';
import { ChunkMesher, disposeMeshedChunk } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { parseWorldSnapshot } from '../src/save/snapshot';
import { IdbWorldStore } from '../src/save/IdbWorldStore';
import { sampleSnapshot } from './persistFixture';

const UNKNOWN_ID = 165;
const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function exerciseUnknownVoxel(world: VoxelWorld, x: number, y: number, z: number): void {
  expect(world.getBlock(x, y, z)).toBe(UNKNOWN_ID);
  expect(() => world.ensureChunkLighting(world.getChunk(0, 0)!)).not.toThrow();
  expect(() => world.tick()).not.toThrow();
  expect(() => world.isSolid(x, y, z)).not.toThrow();
  expect(() => world.isLiquid(x, y, z)).not.toThrow();
  expect(world.isSolid(x, y, z)).toBe(true);
  expect(world.isLiquid(x, y, z)).toBe(false);
  expect(canReplaceWithFluid(world.getBlock(x, y, z))).toBe(false);
  expect(blockCollisionBoxes(world, x, y, z)).toEqual([
    { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 },
  ]);
  expect(blockSelectionBoxes(world, x, y, z).length).toBeGreaterThan(0);
  const chunk = world.getChunk(0, 0)!;
  for (let i = 0; i < chunk.blocks.length; i += 1) {
    expect(() => getBlockDefinition(chunk.blocks[i] as BlockId)).not.toThrow();
  }
  const meshed = new ChunkMesher(atlasStub, (bx, by, bz) => world.getBlockState(bx, by, bz)).build(chunk, world);
  expect(meshed.faces).toBeGreaterThan(0);
  disposeMeshedChunk(meshed);
  expect(getBlockDefinition(world.getBlock(x, y, z)).solid).toBe(true);
  expect(getBlockDefinition(world.getBlock(x, y, z)).breakable).toBe(false);
  expect(isKnownBlockId(UNKNOWN_ID)).toBe(false);
  expect(BLOCK_REGISTRY.has(UNKNOWN_ID as BlockId)).toBe(false);
}

describe('unknown block load compat', () => {
  it('restores an unregistered voxel ID without rewriting the save or crashing lighting', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(isKnownBlockId(UNKNOWN_ID)).toBe(false);

    const index = Chunk.index(8, 70, 8);
    const world = new VoxelWorld('unknown-block-load');
    world.restore({
      timeOfDay: 0,
      modifications: { '0,0': { [String(index)]: UNKNOWN_ID } },
      chests: {},
      furnaces: {},
      blockStates: {},
    });

    exerciseUnknownVoxel(world, 8, 70, 8);
    expect(world.serializeModifications()['0,0']?.[String(index)]).toBe(UNKNOWN_ID);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the unknown ID after an adjacent known write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const world = new VoxelWorld('unknown-block-neighbor');
    const index = Chunk.index(4, 70, 4);
    world.restore({
      timeOfDay: 0,
      modifications: { '0,0': { [String(index)]: UNKNOWN_ID } },
      chests: {},
      furnaces: {},
      blockStates: {},
    });
    expect(world.setBlock(4, 71, 4, BlockId.Glass)).toBe(true);
    expect(world.getBlock(4, 70, 4)).toBe(UNKNOWN_ID);
    expect(world.getBlock(4, 71, 4)).toBe(BlockId.Glass);
    expect(world.serializeModifications()['0,0']?.[String(index)]).toBe(UNKNOWN_ID);
    warn.mockRestore();
  });

  it('loads a saved world snapshot that still contains unknown ID 165', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const x = 8;
    const y = 70;
    const z = 8;
    const index = Chunk.index(x, y, z);
    const raw = {
      ...sampleSnapshot({
        summary: {
          ...sampleSnapshot().summary,
          id: 'unknown-165-save',
          seed: 'unknown-165-seed',
        },
        player: {
          ...sampleSnapshot().player,
          position: [x + 0.5, y + 1.01, z + 0.5],
          spawnPoint: [x + 0.5, y + 1.01, z + 0.5],
        },
      }),
      modifications: { '0,0': { [String(index)]: '165' } },
    };

    const parsed = parseWorldSnapshot(JSON.parse(JSON.stringify(raw)));
    expect(parsed.modifications['0,0']?.[String(index)]).toBe('165');

    const store = new IdbWorldStore();
    await store.save(parsed);
    const loaded = await store.load('unknown-165-save');
    expect(loaded).not.toBeNull();
    expect(loaded!.modifications['0,0']?.[String(index)]).toBe('165');

    const world = new VoxelWorld(loaded!.summary.seed);
    expect(() => world.restore(loaded!)).not.toThrow();
    exerciseUnknownVoxel(world, x, y, z);
    expect(world.serializeModifications()['0,0']?.[String(index)]).toBe(UNKNOWN_ID);
    expect(loaded!.modifications['0,0']?.[String(index)]).toBe('165');
    warn.mockRestore();
  });
});
