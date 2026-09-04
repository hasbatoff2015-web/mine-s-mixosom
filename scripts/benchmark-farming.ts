import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { FarmingSystem } from '../src/farming';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

for (const count of [1_024, 4_096]) {
  const world = new VoxelWorld(`benchmark-farming-${count}`);
  const chunks = Math.ceil(count / (CHUNK_SIZE * CHUNK_SIZE * 16));
  for (let cx = 0; cx < chunks; cx += 1) world.chunks.set(`${cx},0`, new Chunk(cx, 0));
  const farming = new FarmingSystem(world, { random: () => 0.5 });
  const changes: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
  let remaining = count;
  for (const chunk of world.chunks.values()) for (let y = 32; y < 48 && remaining > 0; y += 1) {
    for (let z = 0; z < CHUNK_SIZE && remaining > 0; z += 1) for (let x = 0; x < CHUNK_SIZE && remaining > 0; x += 1) {
      changes.push({ x: chunk.x * CHUNK_SIZE + x, y, z, block: BlockId.Farmland });
      remaining -= 1;
    }
  }
  world.applyBlockBatch(changes, { updateLighting: false, scheduleNeighbors: false });
  world.setViewCenter(0, 0, 32);
  world.tickNumber = 1;
  farming.tick();
  world.tickNumber = 100;
  const started = performance.now();
  const stats = farming.tick();
  const elapsed = performance.now() - started;
  console.log(JSON.stringify({ count, elapsedMs: Number(elapsed.toFixed(3)), ...stats }));
  farming.dispose();
}
