import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { computeFluidUpdate, readFluidFalling, readFluidLevel } from '../src/world/fluids';
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
  meshed.fire.dispose();
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

interface HillFixture {
  block: BlockId;
  ticks: number;
  source: { x: number; y: number; z: number };
  terraces: ReadonlyArray<{ y: number; minX: number; maxX: number; minZ: number; maxZ: number }>;
}

function hillStats(label: string, fixture: HillFixture) {
  const world = new VoxelWorld(`fluid-hill-${label}`);
  for (let cz = -1; cz <= 1; cz += 1) {
    for (let cx = -1; cx <= 1; cx += 1) world.getChunk(cx, cz);
  }
  for (const chunk of world.chunks.values()) chunk.blocks.fill(BlockId.Air);
  const terrain: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
  for (let z = -8; z <= 31; z += 1) {
    for (let x = -8; x <= 31; x += 1) terrain.push({ x, y: 20, z, block: BlockId.Stone });
  }
  for (const terrace of fixture.terraces) {
    for (let z = terrace.minZ; z <= terrace.maxZ; z += 1) {
      for (let x = terrace.minX; x <= terrace.maxX; x += 1) {
        terrain.push({ x, y: terrace.y, z, block: BlockId.Stone });
      }
    }
  }
  world.applyBlockBatch(terrain, { record: false, updateLighting: false, scheduleNeighbors: false });

  const { x: sourceX, y: sourceY, z: sourceZ } = fixture.source;
  world.setBlock(sourceX, sourceY, sourceZ, fixture.block);
  const initialWrites = computeFluidUpdate(world, sourceX, sourceY, sourceZ);
  const initialDirections = initialWrites
    .filter((write) => write.y === sourceY && write.block === fixture.block)
    .map((write) => `${write.x - sourceX},${write.z - sourceZ}`)
    .sort();
  world.scheduleFluidAround(sourceX, sourceY, sourceZ, 1);

  let peakQueue = 0;
  let totalUpdates = 0;
  let totalWrites = 0;
  let settleTick = fixture.ticks;
  for (let tick = 0; tick < fixture.ticks; tick += 1) {
    world.tick();
    peakQueue = Math.max(peakQueue, world.fluidQueueSize);
    totalUpdates += world.fluidUpdates;
    totalWrites += world.fluidWrites;
    if (world.fluidQueueSize === 0 && world.fluidWrites === 0 && settleTick === fixture.ticks) settleTick = tick + 1;
  }

  let totalCells = 0;
  let fallingCells = 0;
  let landingDropColumns = 0;
  let maxManhattanFromSource = 0;
  const cellsPerY: Record<string, number> = {};
  const levelHistogram: Record<string, number> = {};
  for (let y = 21; y <= sourceY; y += 1) {
    for (let z = -8; z <= 31; z += 1) {
      for (let x = -8; x <= 31; x += 1) {
        if (world.getBlock(x, y, z, false) !== fixture.block) continue;
        totalCells += 1;
        cellsPerY[y] = (cellsPerY[y] ?? 0) + 1;
        const level = readFluidLevel(world, x, y, z);
        levelHistogram[level] = (levelHistogram[level] ?? 0) + 1;
        const falling = readFluidFalling(world, x, y, z);
        if (falling) fallingCells += 1;
        if (falling && world.getBlock(x, y - 1, z, false) === BlockId.Stone) {
          landingDropColumns += 1;
        }
        maxManhattanFromSource = Math.max(
          maxManhattanFromSource,
          Math.abs(x - sourceX) + Math.abs(y - sourceY) + Math.abs(z - sourceZ),
        );
      }
    }
  }

  let lateWrites = 0;
  for (let tick = 0; tick < 200; tick += 1) {
    world.tick();
    lateWrites += world.fluidWrites;
  }
  const landingFootprintByY = Object.fromEntries(
    [21, ...fixture.terraces.map((terrace) => terrace.y + 1)]
      .sort((a, b) => a - b)
      .map((y) => [y, cellsPerY[y] ?? 0]),
  );
  return {
    scenario: label,
    initialDirections,
    initialBranchCount: initialDirections.length,
    totalCells,
    fallingCells,
    landingDropColumns,
    landingFootprintByY,
    cellsPerY,
    levelHistogram,
    maxManhattanFromSource,
    peakQueue,
    totalUpdates,
    totalWrites,
    settleTick,
    lateWrites,
    lastQueue: world.fluidQueueSize,
  };
}

function computeUpdateCost(label: string, block: BlockId, iterations = 5_000) {
  const world = new VoxelWorld(`fluid-compute-cost-${label}`);
  loadFlat(world, 20);
  world.setBlock(8, 21, 8, block);
  for (let warmup = 0; warmup < 100; warmup += 1) computeFluidUpdate(world, 8, 21, 8);
  const batchSize = 50;
  const batchMs: number[] = [];
  for (let offset = 0; offset < iterations; offset += batchSize) {
    const started = performance.now();
    for (let sample = 0; sample < batchSize; sample += 1) computeFluidUpdate(world, 8, 21, 8);
    batchMs.push((performance.now() - started) / batchSize);
  }
  return {
    scenario: label,
    iterations,
    averageMs: Number((batchMs.reduce((sum, value) => sum + value, 0) / batchMs.length).toFixed(5)),
    p95Ms: Number(percentile(batchMs, 95).toFixed(5)),
    maxBatchAverageMs: Number(Math.max(...batchMs).toFixed(5)),
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
const waterHill = hillStats('water-terraced-hill', {
  block: BlockId.Water,
  ticks: 500,
  source: { x: 10, y: 33, z: 12 },
  terraces: [
    { y: 24, minX: 2, maxX: 25, minZ: 2, maxZ: 25 },
    { y: 28, minX: 6, maxX: 21, minZ: 6, maxZ: 21 },
    { y: 32, minX: 9, maxX: 15, minZ: 9, maxZ: 15 },
  ],
});
const lavaHill = hillStats('lava-terraced-hill', {
  block: BlockId.Lava,
  ticks: 900,
  source: { x: 10, y: 33, z: 11 },
  terraces: [
    { y: 24, minX: 6, maxX: 20, minZ: 6, maxZ: 20 },
    { y: 28, minX: 8, maxX: 16, minZ: 8, maxZ: 16 },
    { y: 32, minX: 10, maxX: 12, minZ: 10, maxZ: 12 },
  ],
});
const waterComputeCost = computeUpdateCost('flat-water-compute', BlockId.Water);
const lavaComputeCost = computeUpdateCost('flat-lava-compute', BlockId.Lava);

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
  hill: { waterHill, lavaHill },
  computeUpdate: { waterComputeCost, lavaComputeCost },
  mesh: {
    dryMs: Number(dryMesh.ms.toFixed(3)),
    dryFaces: dryMesh.faces,
    fluidMs: Number(wetMesh.ms.toFixed(3)),
    fluidFaces: wetMesh.faces,
  },
  streaming: { waterFly, lavaFly, bothFly },
}, null, 2));
