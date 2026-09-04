import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { FarmingSystem } from '../src/farming';
import { CHUNK_SIZE } from '../src/core/constants';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

function benchmark(count: number): { elapsed: number; visited: number; indexed: number } {
  const world = new VoxelWorld(`farm-perf-${count}`);
  const chunkCount = Math.ceil(count / (CHUNK_SIZE * CHUNK_SIZE * 16));
  for (let cx = 0; cx < chunkCount; cx += 1) world.chunks.set(`${cx},0`, new Chunk(cx, 0));
  const farming = new FarmingSystem(world, { random: () => 0.5 });
  const changes: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
  let remaining = count;
  for (const chunk of world.chunks.values()) {
    for (let y = 32; y < 48 && remaining > 0; y += 1) for (let z = 0; z < 16 && remaining > 0; z += 1) {
      for (let x = 0; x < 16 && remaining > 0; x += 1) {
        changes.push({ x: chunk.x * CHUNK_SIZE + x, y, z, block: BlockId.Farmland });
        remaining -= 1;
      }
    }
  }
  world.applyBlockBatch(changes, { updateLighting: false, scheduleNeighbors: false });
  world.setViewCenter(0, 0, 32);
  world.tickNumber = 1;
  farming.tick(); // one-time lazy chunk scan is outside the pulse measurement
  world.tickNumber = 100;
  const started = performance.now();
  const stats = farming.tick();
  const elapsed = performance.now() - started;
  farming.dispose();
  return { elapsed, visited: stats.visited, indexed: stats.indexed };
}

describe('FarmingSystem sparse pulse performance', () => {
  for (const count of [1_024, 4_096]) {
    it(`visits only the ${count} indexed farming cells`, () => {
      const result = benchmark(count);
      expect(result.indexed).toBe(count);
      expect(result.visited).toBe(count);
      expect(result.elapsed).toBeLessThan(1_500);
    });
  }
});
