import { describe, expect, it, vi } from 'vitest';
import { BlockId, getBlockDefinition, isKnownBlockId } from '../src/blocks';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

const UNKNOWN_ID = 165;

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

    expect(world.getBlock(8, 70, 8)).toBe(UNKNOWN_ID);
    expect(() => world.ensureChunkLighting(world.getChunk(0, 0)!)).not.toThrow();
    expect(getBlockDefinition(world.getBlock(8, 70, 8)).solid).toBe(true);
    expect(world.serializeModifications()['0,0']?.[String(index)]).toBe(UNKNOWN_ID);
    expect(isKnownBlockId(UNKNOWN_ID)).toBe(false);
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
});
