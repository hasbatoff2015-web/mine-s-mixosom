import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { runStreamingPath, STREAMING_SPEEDS } from '../src/world/streamingSim';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function loadFlat(world: VoxelWorld, floorY: number): void {
  for (let cz = -1; cz <= 1; cz += 1) {
    for (let cx = -1; cx <= 1; cx += 1) world.getChunk(cx, cz);
  }
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        chunk.set(x, floorY, z, BlockId.Stone);
      }
    }
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return sorted[index]!;
}

function meshMs(world: VoxelWorld, chunkX = 0, chunkZ = 0): { ms: number; faces: number } {
  const chunk = world.getChunk(chunkX, chunkZ)!;
  world.ensureChunkLighting(chunk);
  const mesher = new ChunkMesher(atlasStub, (x, y, z) => world.getBlockState(x, y, z));
  const started = performance.now();
  const meshed = mesher.build(chunk, world);
  const ms = performance.now() - started;
  const faces = meshed.faces;
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  return { ms, faces };
}

function floodStats(label: string, block: BlockId, ticks: number) {
  const world = new VoxelWorld(`fluid-bench-${label}`);
  loadFlat(world, 20);
  world.setBlock(8, 21, 8, block);
  world.scheduleFluidAround(8, 21, 8, 1);
  let peakQueue = 0;
  let totalUpdates = 0;
  let totalWrites = 0;
  let totalNoops = 0;
  let totalDedupe = 0;
  let peakMeshDirty = 0;
  let peakLightDirty = 0;
  let settleTick = ticks;
  const started = performance.now();
  let maxTick = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    const tickStart = performance.now();
    world.tick();
    maxTick = Math.max(maxTick, performance.now() - tickStart);
    peakQueue = Math.max(peakQueue, world.fluidQueueSize);
    totalUpdates += world.fluidUpdates;
    totalWrites += world.fluidWrites;
    totalNoops += world.fluidNoops;
    totalDedupe += world.fluidDedupe;
    peakMeshDirty = Math.max(peakMeshDirty, world.fluidMeshDirtyChunks);
    peakLightDirty = Math.max(peakLightDirty, world.fluidLightDirtyChunks);
    if (world.fluidQueueSize === 0 && world.fluidWrites === 0 && settleTick === ticks) settleTick = tick + 1;
  }
  let lateWrites = 0;
  for (let tick = 0; tick < 200; tick += 1) {
    world.tick();
    lateWrites += world.fluidWrites;
  }
  return {
    scenario: label,
    ticks,
    totalMs: Number((performance.now() - started).toFixed(3)),
    maxTickMs: Number(maxTick.toFixed(3)),
    peakQueue,
    totalUpdates,
    totalWrites,
    totalNoops,
    totalDedupe,
    peakMeshDirtyChunks: peakMeshDirty,
    peakLightDirtyChunks: peakLightDirty,
    settleTick,
    lateWrites,
    lastQueue: world.fluidQueueSize,
  };
}

function streamingAfter(label: string, place: (world: VoxelWorld) => void) {
  const world = new VoxelWorld('light-r6-fly');
  world.setViewCenter(8, 8, 6);
  world.ensureChunks(8, 8, 2);
  place(world);
  for (let tick = 0; tick < 24; tick += 1) world.tick();
  const result = runStreamingPath(world, {
    policy: 'fair',
    meshRadius: 6,
    lightBudgetMs: WORLD_LIGHT_BUDGET_MS,
    pruneEveryFrames: 80,
    warmupFrames: 8,
    instantLight: false,
    tickWorld: true,
    speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
    path: [{ x: 8, z: 8 }, { x: 8 + 24 * CHUNK_SIZE, z: 8 }],
  });
  const wanted = result.wantedToVisibleMs;
  return {
    scenario: label,
    wantedP50: Number(percentile(wanted, 50).toFixed(1)),
    wantedP95: Number(percentile(wanted, 95).toFixed(1)),
    wantedMax: Number((wanted.length ? Math.max(...wanted) : 0).toFixed(1)),
    oldestCriticalProxyMs: result.maxNearWantedMissingMs,
    nearMissingMaxMs: result.maxNearWantedMissingMs,
    peakLightPending: result.peakLightPending,
    peakLightReady: result.peakLightReady,
    samples: wanted.length,
    lightBudgetMs: WORLD_LIGHT_BUDGET_MS,
  };
}

const water = floodStats('water-spread', BlockId.Water, 200);
const lava = floodStats('lava-spread', BlockId.Lava, 400);

const dryWorld = new VoxelWorld('fluid-mesh-dry');
loadFlat(dryWorld, 20);
const dryMesh = meshMs(dryWorld);

const wetWorld = new VoxelWorld('fluid-mesh-wet');
loadFlat(wetWorld, 20);
for (let z = 2; z <= 13; z += 1) {
  for (let x = 2; x <= 13; x += 1) wetWorld.setBlock(x, 21, z, BlockId.Water);
}
const wetMesh = meshMs(wetWorld);

const waterFly = streamingAfter('water-fly', (world) => {
  const y = world.surfaceY(8, 8) + 1;
  world.setBlock(8, y, 8, BlockId.Water);
  world.scheduleFluidAround(8, y, 8, 1);
});
const lavaFly = streamingAfter('lava-fly', (world) => {
  const y = world.surfaceY(8, 8) + 1;
  world.setBlock(8, y, 8, BlockId.Lava);
  world.scheduleFluidAround(8, y, 8, 1);
});
const bothFly = streamingAfter('water-lava-fly', (world) => {
  const y = world.surfaceY(8, 8) + 1;
  world.setBlock(8, y, 8, BlockId.Water);
  world.scheduleFluidAround(8, y, 8, 1);
  world.setBlock(10, y, 10, BlockId.Lava);
  world.scheduleFluidAround(10, y, 10, 1);
});

console.log(JSON.stringify({
  lightBudgetMs: WORLD_LIGHT_BUDGET_MS,
  water,
  lava,
  mesh: {
    dryMs: Number(dryMesh.ms.toFixed(3)),
    dryFaces: dryMesh.faces,
    fluidMs: Number(wetMesh.ms.toFixed(3)),
    fluidFaces: wetMesh.faces,
  },
  streaming: { waterFly, lavaFly, bothFly },
}, null, 2));
