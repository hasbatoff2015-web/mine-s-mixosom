import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import {
  lightEngineStats,
  lightFrameStats,
  resetLightEngineStats,
  resetLightFrameStats,
} from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function fillFlat(world: VoxelWorld, y = 50): void {
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let height = 0; height <= y; height += 1) {
          chunk.set(lx, height, lz, height === y ? BlockId.GrassBlock : BlockId.Dirt);
        }
      }
    }
  }
}

function lightAll(world: VoxelWorld): void {
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
}

function measureSlices(world: VoxelWorld, originX: number, originZ: number, budgetMs: number): {
  totalMs: number;
  maxSlice: number;
  jobs: number;
  columns: number;
  nodes: number;
} {
  resetLightFrameStats();
  let totalMs = 0;
  let maxSlice = 0;
  let jobs = 0;
  let columns = 0;
  let nodes = 0;
  let guard = 0;
  while ((world.unlitChunkCount > 0 || world.pendingLightJobs > world.unlitChunkCount) && guard < 4_000) {
    const slice = world.processLighting(budgetMs, originX, originZ);
    totalMs += slice;
    maxSlice = Math.max(maxSlice, lightFrameStats.maxSlice, slice);
    jobs += lightFrameStats.jobsActive;
    columns += lightFrameStats.columns;
    nodes += lightFrameStats.nodes;
    guard += 1;
    if (slice === 0 && world.unlitChunkCount === 0) break;
  }
  return { totalMs, maxSlice, jobs, columns, nodes };
}

function scenarioInitialSky(): unknown {
  const world = new VoxelWorld('bench-initial-sky');
  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) world.getChunk(x, z);
  }
  const syncStart = performance.now();
  lightAll(world);
  const syncMs = performance.now() - syncStart;

  const sliced = new VoxelWorld('bench-initial-sky-sliced');
  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) sliced.getChunk(x, z);
  }
  const slices = measureSlices(sliced, 8, 8, 2);
  return {
    chunks: 81,
    syncEnsureMs: Number(syncMs.toFixed(3)),
    slicedTotalMs: Number(slices.totalMs.toFixed(3)),
    slicedMaxSliceMs: Number(slices.maxSlice.toFixed(3)),
    slicedJobs: slices.jobs,
    columns: slices.columns,
    nodes: slices.nodes,
  };
}

function scenarioOneChunk(): unknown {
  const world = new VoxelWorld('bench-one-chunk');
  const chunk = world.getChunk(0, 0)!;
  resetLightEngineStats();
  const started = performance.now();
  world.ensureChunkLighting(chunk);
  return {
    ms: Number((performance.now() - started).toFixed(3)),
    skyRecomputes: lightEngineStats.skyRecomputes,
  };
}

function scenarioTorch(): unknown {
  const world = new VoxelWorld('bench-torch');
  world.ensureChunks(8, 8, 1);
  lightAll(world);
  const y = world.surfaceY(8, 8) + 2;
  world.setBlock(8, y, 8, BlockId.Air);
  resetLightEngineStats();
  const placeStart = performance.now();
  world.setBlock(8, y, 8, BlockId.Torch);
  const placeMs = performance.now() - placeStart;
  const skyAfterPlace = lightEngineStats.skyRecomputes;
  const removeStart = performance.now();
  world.setBlock(8, y, 8, BlockId.Air);
  return {
    placeMs: Number(placeMs.toFixed(3)),
    removeMs: Number((performance.now() - removeStart).toFixed(3)),
    skyRecomputes: lightEngineStats.skyRecomputes,
    skyAfterPlace,
    blockPropagations: lightEngineStats.blockPropagations,
    visualUpdates: world.pendingMeshJobs,
  };
}

function scenarioFurnace(): unknown {
  const world = new VoxelWorld('bench-furnace');
  world.ensureChunks(8, 8, 1);
  lightAll(world);
  world.setBlock(8, 50, 8, BlockId.Furnace);
  resetLightEngineStats();
  const furnace = world.getFurnace(8, 50, 8);
  furnace.slots[0] = createItemStack('iron_ore');
  furnace.slots[1] = createItemStack(ItemId.Coal);
  const onStart = performance.now();
  world.tick();
  const onMs = performance.now() - onStart;
  furnace.burnTime = 1;
  const offStart = performance.now();
  world.tick();
  return {
    onMs: Number(onMs.toFixed(3)),
    offMs: Number((performance.now() - offStart).toFixed(3)),
    skyRecomputes: lightEngineStats.skyRecomputes,
    emissionOn: world.blockEmissionAt(8, 50, 8) === 0,
  };
}

function scenarioRoofHole(): unknown {
  const world = new VoxelWorld('bench-roof');
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Stone);
  for (let x = 4; x <= 11; x += 1) {
    for (let z = 4; z <= 11; z += 1) {
      for (let y = 40; y <= 50; y += 1) chunk.set(x, y, z, BlockId.Air);
    }
  }
  world.ensureChunkLighting(chunk);
  resetLightEngineStats();
  const started = performance.now();
  for (let y = 51; y < 80; y += 1) world.setBlock(8, y, 8, BlockId.Air);
  return {
    ms: Number((performance.now() - started).toFixed(3)),
    skyRecomputes: lightEngineStats.skyRecomputes,
    skyInChamber: world.skyLightAt(8, 44, 8),
  };
}

function scenarioOcclusionBatch(): unknown {
  const world = new VoxelWorld('bench-occ-30');
  world.ensureChunks(8, 8, 1);
  lightAll(world);
  for (const chunk of world.chunks.values()) chunk.dirty = false;
  world.pendingMesh.clear();
  resetLightEngineStats();
  const samples: number[] = [];
  const started = performance.now();
  for (let index = 0; index < 30; index += 1) {
    const x = 4 + (index % 8);
    const z = 4;
    const y = 40 + (index % 3);
    const one = performance.now();
    world.applyBlockBatch([{ x, y, z, block: BlockId.Stone }]);
    world.applyBlockBatch([{ x, y, z, block: BlockId.Air }]);
    samples.push(performance.now() - one);
  }
  return {
    totalMs: Number((performance.now() - started).toFixed(3)),
    averageMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    skyRecomputes: lightEngineStats.skyRecomputes,
    pendingMesh: world.pendingMeshJobs,
    dirtyChunks: world.dirtyChunkCount,
  };
}

function scenarioCrossChunkTorch(): unknown {
  const world = new VoxelWorld('bench-cross-torch');
  world.getChunk(0, 0);
  world.getChunk(1, 0);
  fillFlat(world, 40);
  lightAll(world);
  resetLightEngineStats();
  const started = performance.now();
  world.setBlock(15, 44, 8, BlockId.Torch);
  return {
    ms: Number((performance.now() - started).toFixed(3)),
    skyRecomputes: lightEngineStats.skyRecomputes,
    source: world.blockLightAt(15, 44, 8),
    neighbor: world.blockLightAt(16, 44, 8),
    visualUpdates: world.pendingMeshJobs,
  };
}

resetLightEngineStats();
console.info(JSON.stringify({
  scenario: 'lighting-performance',
  initial9x9: scenarioInitialSky(),
  oneChunk: scenarioOneChunk(),
  torch: scenarioTorch(),
  furnace: scenarioFurnace(),
  roofHole: scenarioRoofHole(),
  occlusion30: scenarioOcclusionBatch(),
  crossChunkTorch: scenarioCrossChunkTorch(),
}, null, 2));
