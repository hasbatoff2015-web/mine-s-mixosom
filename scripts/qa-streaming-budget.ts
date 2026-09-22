/**
 * DEV timing probe for chunk generation slices vs a full getChunk().
 * Not a CI gate — prints measured ms for the follow-up report.
 */
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator } from '../src/world/Generator';
import { VoxelWorld } from '../src/world/World';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const at = (ratio: number) => sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
  return {
    samples: sorted.length,
    avg: Number((sum / Math.max(1, sorted.length)).toFixed(3)),
    p95: Number(at(0.95).toFixed(3)),
    p99: Number(at(0.99).toFixed(3)),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
  };
}

const full: number[] = [];
const slices: number[] = [];
const jobs: number[] = [];
for (let i = 0; i < 8; i += 1) {
  const generator = new TerrainGenerator(`qa-stream-${i}`);
  const chunk = new Chunk(i, 12);
  const t0 = performance.now();
  generator.generate(chunk);
  full.push(performance.now() - t0);

  const staged = new Chunk(i + 20, 12);
  const job = generator.beginGenerate(staged);
  const jobStart = performance.now();
  while (true) {
    const s0 = performance.now();
    const done = generator.advanceGenerate(job, 16);
    slices.push(performance.now() - s0);
    if (done) break;
  }
  jobs.push(performance.now() - jobStart);
}

const warm = new VoxelWorld('qa-warm');
warm.deferredLighting = true;
for (let cz = -2; cz <= 2; cz += 1) {
  for (let cx = -2; cx <= 2; cx += 1) warm.getChunk(cx, cz);
}
for (const chunk of warm.chunks.values()) {
  chunk.skyReady = true;
  chunk.skyLateralReady = true;
  chunk.blockLightReady = true;
}
const renderer = new WorldRenderer(warm, atlasStub);
const meshSections: number[] = [];
const meshJobs: number[] = [];
for (const chunk of warm.chunks.values()) {
  chunk.dirty = true;
  chunk.noteMeshDirtyAllY();
  const jobStart = performance.now();
  let guard = 0;
  while (chunk.dirty && guard < 64) {
    const s0 = performance.now();
    renderer.rebuildDirty(1, 4, 8, 8, {
      requireNeighborLight: false,
      allowPendingLighting: true,
      preferKeys: new Set([`${chunk.x},${chunk.z}`]),
      maxSections: 1,
    });
    meshSections.push(performance.now() - s0);
    guard += 1;
  }
  meshJobs.push(performance.now() - jobStart);
}

const far = new VoxelWorld('qa-far');
far.deferredLighting = true;
const farFull: number[] = [];
const farSlices: number[] = [];
for (const [cx, cz] of [[-268, 99], [-270, 100], [-265, 98], [12, 12]] as const) {
  const t0 = performance.now();
  far.getChunk(cx, cz);
  farFull.push(performance.now() - t0);
  const staged = far.continueGeneration(cx + 40, cz + 40, 4, { maxColumns: 16 });
  void staged;
  const sliceWorld = new VoxelWorld('qa-far-slice');
  sliceWorld.deferredLighting = true;
  let guard = 0;
  let result = { done: false, advanced: false };
  while (!result.done && guard < 80) {
    const s0 = performance.now();
    result = sliceWorld.continueGeneration(cx, cz, 4, { maxColumns: 16 });
    farSlices.push(performance.now() - s0);
    guard += 1;
  }
}

console.log(JSON.stringify({
  generationFullMs: stats(full),
  generationSliceMs: stats(slices),
  generationJobMs: stats(jobs),
  farGetChunkMs: stats(farFull),
  farContinueSliceMs: stats(farSlices),
  meshSectionCallMs: stats(meshSections),
  meshJobWallMs: stats(meshJobs),
  rendererSectionMax: Number(renderer.meshSectionMaximumMs.toFixed(3)),
  rendererJobMax: Number(renderer.meshJobMaximumMs.toFixed(3)),
}, null, 2));
