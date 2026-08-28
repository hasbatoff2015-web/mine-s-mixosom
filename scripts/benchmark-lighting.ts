import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { createLightingQaScene, lightingQaOpening, lightingQaRoofHole, lightingQaSkyLine } from '../src/dev/lightingQaScenes';

// --baseline uses the same scenes and measurement code against an untouched detached worktree.
const baseline = process.argv.includes('--baseline');
const only = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
const root = resolve(baseline ? '.local/lighting-baseline/src' : 'src').replaceAll('\\', '/');
const { VoxelWorld } = await import(root + '/world/World.ts');
const { Chunk } = await import(root + '/world/Chunk.ts');
const light = await import(root + '/world/LightEngine.ts');
const { collectReadyMeshJobs, completeCpuMesh } = await import(root + '/world/streamingScheduler.ts');
const { runStreamingPath, STREAMING_SPEEDS } = await import(root + '/world/streamingSim.ts');
const { WORLD_HEIGHT } = await import(root + '/core/constants.ts');
const { importVoxelsIntoWorld } = await import(root + '/world/import/placeStructure.ts');

function scene(kind: Parameters<typeof createLightingQaScene>[0]) {
  return createLightingQaScene(kind, VoxelWorld, Chunk);
}
function lightAll(world: InstanceType<typeof VoxelWorld>): void {
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  for (const chunk of world.chunks.values()) completeCpuMesh(world, chunk);
}
function measure(world: InstanceType<typeof VoxelWorld>, edit?: (frame: number) => void, editFrames = 0) {
  let totalMs = 0;
  let editMs = 0;
  let maxSliceMs = 0;
  let maxEditMs = 0;
  let columns = 0;
  let nodes = 0;
  let jobs = 0;
  let completedJobs = 0;
  let slices = 0;
  let remeshCount = 0;
  let peakDirtyChunks = 0;
  do {
    if (slices < editFrames && edit) {
      const start = performance.now();
      edit(slices);
      const elapsed = performance.now() - start;
      editMs += elapsed;
      maxEditMs = Math.max(maxEditMs, elapsed);
    }
    const counters = { attempted: 0, completed: 0, yielded: 0, blocked: 0 };
    const elapsed = world.processLighting(2, 8, 8, counters);
    totalMs += elapsed;
    maxSliceMs = Math.max(maxSliceMs, elapsed, light.lightFrameStats.maxSlice);
    columns += light.lightFrameStats.columns;
    nodes += light.lightFrameStats.nodes;
    jobs += light.lightFrameStats.jobsActive;
    completedJobs += counters.completed;
    peakDirtyChunks = Math.max(peakDirtyChunks, world.dirtyChunkCount);
    // Count production-gated mesh commits; CPU stand-in, not GPU rendering or mesh timing.
    for (const job of collectReadyMeshJobs(world, 8, 8, world.meshRadius).slice(0, 2)) {
      completeCpuMesh(world, job.chunk);
      remeshCount += 1;
    }
    slices += 1;
    if (slices > 20000) throw new Error('Lighting did not settle; no partial benchmark success.');
  } while (slices < editFrames || world.pendingLightJobs > 0 || light.lightingFloodOwner(world));
  for (const job of collectReadyMeshJobs(world, 8, 8, world.meshRadius)) {
    completeCpuMesh(world, job.chunk);
    remeshCount += 1;
  }
  return { totalMs, maxSliceMs, editMs, maxEditMs, columns, nodes, jobs, completedJobs,
    slices, peakDirtyChunks, remeshCount, memory: light.lightingMemoryUsage?.(world) };
}
const cases: Record<string, unknown> = {};
for (let i = 0; i < 2; i += 1) lightAll(scene('room'));
function run(name: string, create: () => InstanceType<typeof VoxelWorld>,
  prepare?: (world: InstanceType<typeof VoxelWorld>) => void,
  edit?: (world: InstanceType<typeof VoxelWorld>, frame: number) => void,
  frames = 0, sample?: (world: InstanceType<typeof VoxelWorld>) => unknown) {
  if (only && name !== only) return;
  const trials = [];
  for (let trial = 0; trial < 3; trial += 1) {
    const world = create();
    prepare?.(world);
    const result = measure(world, edit ? (frame) => edit(world, frame) : undefined, frames);
    trials.push({ ...result, sample: sample?.(world) });
  }
  cases[name] = trials;
}
const ready = (world: InstanceType<typeof VoxelWorld>) => lightAll(world);
const edit = (world: InstanceType<typeof VoxelWorld>, mutations: unknown[]) =>
  world.applyBlockBatch(mutations, { deferLighting: true, scheduleNeighbors: false });

run('initialChunk', () => {
  const world = new VoxelWorld('bench-one-chunk');
  world.getChunk(0, 0);
  return world;
});
run('initial81StreamingSlices', () => {
  const world = new VoxelWorld('bench-initial-sky-sliced');
  world.setViewCenter(8, 8, 3);
  world.ensureChunks(8, 8, 4);
  return world;
});
run('openRoom', () => scene('room'), undefined, undefined, 0, lightingQaSkyLine);
run('caveEntrance', () => scene('cave'), undefined, undefined, 0, lightingQaSkyLine);
run('forest', () => scene('forest'), undefined, undefined, 0,
  (world) => [3, 4, 8, 15].map((x) => world.skyLightAt(x, 43, 12)));
run('roofOpen', () => scene('closed'), ready,
  (world) => edit(world, lightingQaRoofHole(true)), 1, lightingQaSkyLine);
run('roofClose', () => scene('hole'), ready,
  (world) => edit(world, lightingQaRoofHole(false)), 1, lightingQaSkyLine);
for (const [name, id] of [['torch', BlockId.Torch], ['glowstone', BlockId.Glowstone], ['lantern', BlockId.Lantern]] as const) {
  run(name + 'Add', () => scene('closed'), ready,
    (world) => edit(world, [{ x: 15, y: 43, z: 16, block: id }]), 1,
    (world) => world.blockLightAt(16, 43, 16));
  run(name + 'Remove', () => scene('closed'), (world) => {
    lightAll(world);
    world.setBlock(15, 43, 16, id);
    for (const chunk of world.chunks.values()) completeCpuMesh(world, chunk);
  }, (world) => edit(world, [{ x: 15, y: 43, z: 16, block: BlockId.Air }]), 1,
  (world) => world.blockLightAt(16, 43, 16));
}
run('externalRegionSource', () => scene('closed'), (world) => {
  lightAll(world);
  world.setBlock(14, 43, 16, BlockId.Glowstone);
  for (const chunk of world.chunks.values()) completeCpuMesh(world, chunk);
}, (world) => world.queueLight({ minX: 16, maxX: 20, minY: 41, maxY: 45, minZ: 13, maxZ: 20 }, false, true), 1,
(world) => world.blockLightAt(16, 43, 16));
run('cardinalBorder', () => scene('room'), ready,
  (world) => edit(world, [{ x: 15, y: 43, z: 16, block: BlockId.Torch }]), 1,
  (world) => [world.skyLightAt(15, 43, 16), world.skyLightAt(16, 43, 16), world.blockLightAt(16, 43, 16)]);
run('diagonalCorner', () => scene('closed'), ready,
  (world) => edit(world, [{ x: 15, y: 43, z: 15, block: BlockId.Glowstone }]), 1,
  (world) => [[15, 15], [16, 15], [15, 16], [16, 16]].map(([x, z]) => world.blockLightAt(x, 43, z)));
run('repeatedEdits30Frames', () => scene('room'), ready,
  (world, frame) => edit(world, [{ x: 7 + (Math.floor(frame / 2) % 4), y: 47, z: 16,
    block: frame % 2 === 0 ? BlockId.Air : BlockId.OakPlanks }]), 30);
const burstBlocks = Array.from({ length: 100 }, (_, i) => ({
  x: 4 + i % 10, y: 43, z: 8 + Math.floor(i / 10), block: BlockId.Stone,
}));
run('creativeBurst100', () => scene('room'), (world) => {
  lightAll(world);
  world.applyBlockBatch(burstBlocks, { scheduleNeighbors: false });
  for (const chunk of world.chunks.values()) completeCpuMesh(world, chunk);
}, (world) => {
  for (const block of burstBlocks) edit(world, [{ ...block, block: BlockId.Air }]);
}, 1);
run('wallCloseOpen', () => scene('room'), ready,
  (world, frame) => edit(world, lightingQaOpening(frame === 1)), 2, lightingQaSkyLine);

run('highYRoom', () => scene('high'), undefined, undefined, 0, (world) => lightingQaSkyLine(world, 192));
run('highYEmitter', () => scene('closed'), ready,
  (world) => edit(world, [{ x: 15, y: 230, z: 15, block: BlockId.Lantern }]), 1,
  (world) => [world.blockLightAt(16, 230, 16), world.skyLightAt(15, 230, 15)]);
const structure = [];
for (let z = -16; z <= 47; z += 1) for (let x = -16; x <= 47; x += 1) {
  structure.push({ x, y: 192, z, block: BlockId.Stone }, { x, y: 200, z, block: BlockId.OakPlanks });
  if (x === -16 || x === 47 || z === -16 || z === 47) {
    for (let y = 193; y < 200; y += 1) structure.push({ x, y, z, block: BlockId.OakPlanks });
  }
}
run('importedStructureLighting', () => scene('room'), ready,
  (world) => importVoxelsIntoWorld(world, structure), 1,
  (world) => [world.skyLightAt(8, 196, 8), world.getChunk(0, 0)!.occupancyTop]);

const memory = [];
if (!only) for (const radius of [2, 4, 6]) {
  const world = new VoxelWorld('lighting-memory-' + radius);
  world.setViewCenter(8, 8, radius);
  world.ensureChunks(8, 8, radius + 1);
  measure(world);
  edit(world, [{ x: 15, y: 70, z: 15, block: BlockId.Glowstone }]);
  measure(world);
  const chunks = [...world.chunks.values()];
  memory.push({ radius, loadedChunks: chunks.length,
    blocksBytes: chunks.reduce((sum, chunk) => sum + chunk.blocks.byteLength, 0),
    skyBytes: chunks.reduce((sum, chunk) => sum + chunk.skyLight.byteLength, 0),
    blockLightBytes: chunks.reduce((sum, chunk) => sum + chunk.blockLight.byteLength, 0),
    metadataBytes: chunks.reduce((sum, chunk) => sum + chunk.surfaceHeights.byteLength + chunk.biomeCodes.byteLength
      + (chunk.skyFilterHeights?.byteLength ?? 0) + (chunk.skyStoredHeights?.byteLength ?? 0), 0),
    lighting: light.lightingMemoryUsage?.(world),
    naiveFullFlagsBytes: chunks.length * CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT,
    naiveFullSnapshotsBytes: chunks.length * CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT * 2,
  });
}
const streaming = !only ? runStreamingPath(new VoxelWorld('stream-fly-r6-sliced'), {
  meshRadius: 6, lightBudgetMs: 2, pruneEveryFrames: 80, warmupFrames: 48,
  instantLight: false, policy: 'fair', speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
  path: [{ x: 8, z: 8 }, { x: 8 + 12 * CHUNK_SIZE, z: 8 }],
}) : undefined;
const { litToMeshWaitsMs, wantedToVisibleMs, readyWantedToMeshMs, ...streamingSummary } = streaming ?? {};
const result = { runtime: 'Node CPU; no browser FPS claim', baseline, worldHeight: WORLD_HEIGHT, trials: 3, budgetMs: 2,
  remeshCount: 'production-gated CPU mesh acknowledgements; no GPU work',
  memoryScope: 'Typed arrays only; excludes JS object overhead, world deltas, import voxel objects, GPU and renderer caches',
  cases, memory, streaming: streamingSummary };
const path = '.local/lighting-benchmark-' + WORLD_HEIGHT + '-' + (only ? only + '-' : '') + (baseline ? 'before' : 'after') + '.json';
mkdirSync('.local', { recursive: true });
writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
console.info(JSON.stringify(result, null, 2));
