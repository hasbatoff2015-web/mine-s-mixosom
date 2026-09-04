import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { FarmingSystem } from '../src/farming';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

const TICK_BUDGET_MS = 50;

function emptyWorld(): { world: VoxelWorld; farming: FarmingSystem } {
  const world = new VoxelWorld('farm-budget-empty');
  for (let cx = -2; cx <= 2; cx += 1) {
    for (let cz = -2; cz <= 2; cz += 1) world.chunks.set(`${cx},${cz}`, new Chunk(cx, cz));
  }
  world.setViewCenter(0, 0, 32);
  return { world, farming: new FarmingSystem(world, { random: () => 0.5 }) };
}

function farmlandWorld(count: number): { world: VoxelWorld; farming: FarmingSystem } {
  const world = new VoxelWorld(`farm-budget-${count}`);
  const chunkCount = Math.ceil(count / (CHUNK_SIZE * CHUNK_SIZE * 16));
  for (let cx = 0; cx < chunkCount; cx += 1) world.chunks.set(`${cx},0`, new Chunk(cx, 0));
  const farming = new FarmingSystem(world, { random: () => 0.5 });
  const changes: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
  let remaining = count;
  for (const chunk of world.chunks.values()) {
    for (let y = 32; y < 48 && remaining > 0; y += 1) {
      for (let z = 0; z < 16 && remaining > 0; z += 1) {
        for (let x = 0; x < 16 && remaining > 0; x += 1) {
          changes.push({ x: chunk.x * CHUNK_SIZE + x, y, z, block: BlockId.Farmland });
          remaining -= 1;
        }
      }
    }
  }
  world.applyBlockBatch(changes, { updateLighting: false, scheduleNeighbors: false });
  world.setViewCenter(0, 0, 32);
  return { world, farming };
}

describe('FarmingSystem tick budget vs 20 TPS', () => {
  it('empty loaded chunks stay far under one simulation tick between pulses', () => {
    const { world, farming } = emptyWorld();
    world.tickNumber = 1;
    farming.tick([{ x: 0, z: 0 }]);
    const started = performance.now();
    const n = 200;
    for (let i = 0; i < n; i += 1) {
      world.tickNumber += 1;
      farming.tick([{ x: 0, z: 0 }]);
    }
    const avg = (performance.now() - started) / n;
    farming.dispose();
    expect(avg).toBeLessThan(1);
  });

  it('a 1024-cell hydration pulse stays under one 50 ms server tick', () => {
    const { world, farming } = farmlandWorld(1_024);
    world.tickNumber = 1;
    farming.tick();
    world.tickNumber = 100;
    const started = performance.now();
    const stats = farming.tick();
    const elapsed = performance.now() - started;
    farming.dispose();
    expect(stats.visited).toBe(1_024);
    expect(elapsed).toBeLessThan(TICK_BUDGET_MS);
  });
});
