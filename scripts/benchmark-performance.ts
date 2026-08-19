import * as THREE from 'three';
import { MobManager, type MobKind } from '../src/entities';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';

const SEED = 'legacy-model-performance';
const MOB_KINDS: readonly MobKind[] = [
  'cow', 'pig', 'chicken', 'sheep', 'zombie', 'skeleton', 'creeper', 'spider',
];

interface SampleStats {
  averageMs: number;
  p95Ms: number;
  maximumMs: number;
  samples: number;
}

function summarize(samples: readonly number[]): SampleStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentileIndex = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    averageMs: samples.reduce((sum, sample) => sum + sample, 0) / Math.max(1, samples.length),
    p95Ms: sorted[percentileIndex] ?? 0,
    maximumMs: sorted.at(-1) ?? 0,
    samples: samples.length,
  };
}

function rounded(stats: SampleStats): SampleStats {
  return {
    averageMs: Number(stats.averageMs.toFixed(3)),
    p95Ms: Number(stats.p95Ms.toFixed(3)),
    maximumMs: Number(stats.maximumMs.toFixed(3)),
    samples: stats.samples,
  };
}

function deterministicRandom(): () => number {
  let state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

const sharedTile = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });
const atlasStub = { tile: () => sharedTile } as unknown as TextureAtlas;

function disposeMeshed(meshed: ReturnType<ChunkMesher['build']>): void {
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
}

function benchmarkChunks(): { generation: SampleStats; meshing: SampleStats; meshScan: SampleStats; geometryUpload: SampleStats; faces: number } {
  const world = new VoxelWorld(SEED);
  const mesher = new ChunkMesher(atlasStub);
  const generationSamples: number[] = [];
  const meshingSamples: number[] = [];
  const scanSamples: number[] = [];
  const geometrySamples: number[] = [];
  let faces = 0;

  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const generationStart = performance.now();
      const chunk = world.getChunk(x, z)!;
      generationSamples.push(performance.now() - generationStart);
      const meshingStart = performance.now();
      const meshed = mesher.build(chunk, world);
      meshingSamples.push(performance.now() - meshingStart);
      scanSamples.push(mesher.lastProfile.scanMs);
      geometrySamples.push(mesher.lastProfile.geometryMs);
      faces += meshed.faces;
      disposeMeshed(meshed);
    }
  }

  return {
    generation: summarize(generationSamples),
    meshing: summarize(meshingSamples),
    meshScan: summarize(scanSamples),
    geometryUpload: summarize(geometrySamples),
    faces,
  };
}

function benchmarkMobTicks(): SampleStats {
  const world = new VoxelWorld(SEED);
  world.ensureChunks(0, 0, 3);
  const scene = new THREE.Scene();
  const mobs = new MobManager(scene, world, {
    automaticSpawning: false,
    maxMobs: 32,
    passiveCap: 32,
    hostileCap: 32,
    random: deterministicRandom(),
  });

  for (let index = 0; index < 24; index += 1) {
    const angle = index / 24 * Math.PI * 2;
    const radius = 5 + index % 4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = world.surfaceY(Math.floor(x), Math.floor(z)) + 1.01;
    mobs.spawn(MOB_KINDS[index % MOB_KINDS.length]!, new THREE.Vector3(x, y, z), { force: true });
  }

  const samples: number[] = [];
  const playerPosition = new THREE.Vector3(0.5, world.surfaceY(0, 0) + 1.01, 0.5);
  for (let tick = 0; tick < 660; tick += 1) {
    const start = performance.now();
    mobs.update(0.05, {
      playerPosition,
      playerAlive: true,
      playerTargetable: false,
      daylight: 1,
    });
    const elapsed = performance.now() - start;
    if (tick >= 60) samples.push(elapsed);
  }
  mobs.dispose();
  return summarize(samples);
}

const chunkResult = benchmarkChunks();
const result = {
  seed: SEED,
  generatedChunks: chunkResult.generation.samples,
  faces: chunkResult.faces,
  generation: rounded(chunkResult.generation),
  meshing: rounded(chunkResult.meshing),
  meshScan: rounded(chunkResult.meshScan),
  geometryUpload: rounded(chunkResult.geometryUpload),
  mobTick24: rounded(benchmarkMobTicks()),
};

console.log(JSON.stringify(result, null, 2));
