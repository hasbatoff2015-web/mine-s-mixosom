import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';
import {
  eastThenWestPath,
  percentile,
  runStreamingPath,
  STREAMING_SPEEDS,
  zigzagPath,
} from '../src/world/streamingSim';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function summarize(label: string, waits: readonly number[]): Record<string, number> {
  return {
    samples: waits.length,
    p50: Number(percentile(waits, 0.5).toFixed(1)),
    p95: Number(percentile(waits, 0.95).toFixed(1)),
    max: Number((waits.length ? Math.max(...waits) : 0).toFixed(1)),
  };
}

function measureMeshSamples(): Record<string, { meshMs: number; faces: number; biome: string }> {
  const mesher = new ChunkMesher(atlasStub);
  const samples: Record<string, { meshMs: number; faces: number; biome: string }> = {};
  const coords: Array<[string, number, number]> = [
    ['plains-ish', 0, 0],
    ['offset-a', 3, 1],
    ['offset-b', -2, 4],
    ['cave-probe', 1, -3],
  ];
  for (const [label, cx, cz] of coords) {
    const world = new VoxelWorld(`mesh-cost-${label}`);
    const chunk = world.getChunk(cx, cz)!;
    world.ensureChunkLighting(chunk);
    const started = performance.now();
    const meshed = mesher.build(chunk, world);
    const meshMs = performance.now() - started;
    samples[label] = { meshMs: Number(meshMs.toFixed(2)), faces: meshed.faces, biome: world.biomeAt(cx * CHUNK_SIZE + 8, cz * CHUNK_SIZE + 8) };
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.vegetation.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
    meshed.fire.dispose();
  }
  return samples;
}

function measureBreakRegression(): { pendingMesh: number; dirtyChunks: number } {
  const world = new VoxelWorld('stream-break-reg');
  world.ensureChunks(8, 8, 1);
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  for (const chunk of world.chunks.values()) chunk.dirty = false;
  world.pendingMesh.clear();
  for (let index = 0; index < 30; index += 1) {
    const x = 4 + (index % 8);
    const y = 40 + (index % 3);
    world.applyBlockBatch([{ x, y, z: 4, block: BlockId.Stone }], { deferLighting: true });
    world.applyBlockBatch([{ x, y, z: 4, block: BlockId.Air }], { deferLighting: true });
  }
  world.flushLighting();
  return { pendingMesh: world.pendingMeshJobs, dirtyChunks: world.dirtyChunkCount };
}

const meshRadius = 4;
const common = {
  meshRadius,
  lightBudgetMs: 8,
  pruneEveryFrames: 120,
  warmupFrames: 36,
  instantLight: true,
};

const walk = runStreamingPath(new VoxelWorld('stream-walk-fair'), {
  ...common,
  policy: 'fair',
  speedBlocksPerSec: STREAMING_SPEEDS.walk,
  path: [{ x: 8, z: 8 }, { x: 8 + 12 * CHUNK_SIZE, z: 8 }],
});
const walkLegacy = runStreamingPath(new VoxelWorld('stream-walk-legacy'), {
  ...common,
  policy: 'legacy-skip-on-gen',
  speedBlocksPerSec: STREAMING_SPEEDS.walk,
  path: [{ x: 8, z: 8 }, { x: 8 + 12 * CHUNK_SIZE, z: 8 }],
});
const fly = runStreamingPath(new VoxelWorld('stream-fly-fair'), {
  ...common,
  policy: 'fair',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: [{ x: 8, z: 8 }, { x: 8 + 24 * CHUNK_SIZE, z: 8 }],
});
const flyLegacy = runStreamingPath(new VoxelWorld('stream-fly-legacy'), {
  ...common,
  policy: 'legacy-skip-on-gen',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: [{ x: 8, z: 8 }, { x: 8 + 24 * CHUNK_SIZE, z: 8 }],
});
const reverse = runStreamingPath(new VoxelWorld('stream-reverse-fair'), {
  ...common,
  policy: 'fair',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: eastThenWestPath(8, 8),
});
const reverseLegacy = runStreamingPath(new VoxelWorld('stream-reverse-legacy'), {
  ...common,
  policy: 'legacy-skip-on-gen',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: eastThenWestPath(8, 8),
});
const zigzag = runStreamingPath(new VoxelWorld('stream-zigzag-fair'), {
  ...common,
  policy: 'fair',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: zigzagPath(6, 4),
  pruneEveryFrames: 40,
});

const beforeLocalQa = {
  litToMeshStartMs: 3020,
  meshRank: 8,
  queuedObsolete: 604,
  note: 'local inspector capture chunk -72,153 during Creative flight; mesh starved by skip-all-mesh-on-gen',
};

function compact(result: ReturnType<typeof runStreamingPath>) {
  const { litToMeshWaitsMs, wantedToVisibleMs, readyWantedToMeshMs, ...rest } = result;
  return {
    ...rest,
    litToMesh: summarize('litToMesh', litToMeshWaitsMs),
    wantedToVisible: summarize('wantedToVisible', wantedToVisibleMs),
    readyWantedToMesh: summarize('readyWantedToMesh', readyWantedToMeshMs),
  };
}

const flySliced = runStreamingPath(new VoxelWorld('stream-fly-sliced-light'), {
  meshRadius,
  lightBudgetMs: 2,
  pruneEveryFrames: 120,
  warmupFrames: 36,
  instantLight: false,
  policy: 'fair',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: [{ x: 8, z: 8 }, { x: 8 + 12 * CHUNK_SIZE, z: 8 }],
});

const flyRadius6 = runStreamingPath(new VoxelWorld('stream-fly-r6-sliced'), {
  meshRadius: 6,
  lightBudgetMs: 2,
  pruneEveryFrames: 80,
  warmupFrames: 48,
  instantLight: false,
  policy: 'fair',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: [{ x: 8, z: 8 }, { x: 8 + 30 * CHUNK_SIZE, z: 8 }],
});

const reverseRadius6 = runStreamingPath(new VoxelWorld('stream-reverse-r6-sliced'), {
  meshRadius: 6,
  lightBudgetMs: 2,
  pruneEveryFrames: 80,
  warmupFrames: 40,
  instantLight: false,
  policy: 'fair',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: eastThenWestPath(15, 15),
});

const zigzagRadius6 = runStreamingPath(new VoxelWorld('stream-zigzag-r6-sliced'), {
  meshRadius: 6,
  lightBudgetMs: 2,
  pruneEveryFrames: 40,
  warmupFrames: 40,
  instantLight: false,
  policy: 'fair',
  speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: zigzagPath(6, 4),
});

const beforeLightingQa = {
  frontDistance: 2,
  blockedBy: 'neighbor S not lit',
  wantedSinceS: 18.75,
  maxDistanceLightPending: 71,
  maxDistanceLightBlocked: 70,
  maxDistanceLightReady: 1,
  oldestBlockedS: 161,
  stopsOnBlockedHead: true,
};

console.info(JSON.stringify({
  scenario: 'streaming-scheduler',
  budgetsUnchanged: { WORLD_JOB_BUDGET_MS: 4, WORLD_LIGHT_BUDGET_MS: 2 },
  note: 'walk/fly/reverse/zigzag use instantLight to isolate mesh fairness from lighting slices',
  beforeLocalQa,
  beforeLightingQa,
  walkFair: compact(walk),
  walkLegacy: compact(walkLegacy),
  flyFair: compact(fly),
  flyLegacy: compact(flyLegacy),
  reverseFair: compact(reverse),
  reverseLegacy: compact(reverseLegacy),
  zigzagFair: compact(zigzag),
  flySlicedLightFair: compact(flySliced),
  flyRadius6SlicedLight: compact(flyRadius6),
  reverseRadius6SlicedLight: compact(reverseRadius6),
  zigzagRadius6SlicedLight: compact(zigzagRadius6),
  meshCpuSamples: measureMeshSamples(),
  breakRegression: measureBreakRegression(),
}, null, 2));
