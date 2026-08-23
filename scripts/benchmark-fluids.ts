import { BlockId } from '../src/blocks';
import { VoxelWorld } from '../src/world/World';
import { CHUNK_SIZE } from '../src/core/constants';

const world = new VoxelWorld('fluid-bench');
world.getChunk(0, 0);
world.getChunk(1, 0);
world.getChunk(0, 1);
for (const chunk of world.chunks.values()) {
  chunk.blocks.fill(BlockId.Air);
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      chunk.set(x, 20, z, BlockId.Stone);
    }
  }
}
world.setBlock(8, 21, 8, BlockId.Water);
world.scheduleFluidAround(8, 21, 8, 1);

const started = performance.now();
let maxQueue = 0;
let maxTick = 0;
for (let tick = 0; tick < 200; tick += 1) {
  const tickStart = performance.now();
  world.tick();
  maxTick = Math.max(maxTick, performance.now() - tickStart);
  maxQueue = Math.max(maxQueue, world.fluidQueueSize);
}
const total = performance.now() - started;
console.log(JSON.stringify({
  scenario: 'fluid-spread',
  ticks: 200,
  totalMs: Number(total.toFixed(3)),
  maxTickMs: Number(maxTick.toFixed(3)),
  maxQueue,
  lastUpdates: world.fluidUpdates,
}, null, 2));
