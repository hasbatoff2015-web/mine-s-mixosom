import { describe, expect, it } from 'vitest';
import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator } from '../src/world/Generator';
import { VoxelWorld } from '../src/world/World';

describe('staged terrain generation', () => {
  it('matches a monolithic generate() for the same seed and chunk', () => {
    const seed = 'stage-identity-4,-2';
    const generator = new TerrainGenerator(seed);
    const full = new Chunk(4, -2);
    generator.generate(full);

    const staged = new Chunk(4, -2);
    const job = generator.beginGenerate(staged);
    let slices = 0;
    while (!generator.advanceGenerate(job, 16)) {
      slices += 1;
      expect(slices).toBeLessThan(80);
    }
    expect(slices).toBeGreaterThan(5);
    expect(staged.generated).toBe(true);
    expect([...staged.blocks]).toEqual([...full.blocks]);
    expect([...staged.surfaceHeights]).toEqual([...full.surfaceHeights]);
    expect([...staged.biomeCodes]).toEqual([...full.biomeCodes]);
    expect(staged.occupancyTop).toBe(full.occupancyTop);
  });

  it('keeps an in-progress chunk off the world map until the job commits', () => {
    const world = new VoxelWorld('stage-world');
    let t = 0;
    const now = () => {
      t += 1;
      return t;
    };
    const first = world.continueGeneration(3, 1, 2, { maxColumns: 16, now });
    expect(first.done).toBe(false);
    expect(first.advanced).toBe(true);
    expect(world.getChunk(3, 1, false)).toBeUndefined();
    expect(world.pendingGenerationJobs).toBe(1);

    let guard = 0;
    let result = first;
    while (!result.done && guard < 80) {
      result = world.continueGeneration(3, 1, 2, { maxColumns: 16, now });
      guard += 1;
    }
    expect(result.done).toBe(true);
    expect(world.getChunk(3, 1, false)?.generated).toBe(true);
    expect(world.pendingGenerationJobs).toBe(0);

    const control = new VoxelWorld('stage-world');
    const expected = control.getChunk(3, 1)!;
    const got = world.getChunk(3, 1, false)!;
    expect([...got.blocks]).toEqual([...expected.blocks]);
  });
});
