import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, LIGHTING_HALO_CHUNKS, WORLD_HEIGHT } from '../src/core/constants';
import { isChunkOverlayQueryEnabled } from '../src/core/devProfiler';
import { createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import {
  lightEngineStats,
  lightFrameStats,
  processChunkLighting,
  resetLightEngineStats,
  resetLightFrameStats,
} from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';
import {
  countInitialAreaProgress,
  initialAreaReady,
  lightContextReady,
  lightingHaloRadius,
} from '../src/world/worldJobs';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function fillFlat(world: VoxelWorld, y = 50): void {
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let height = 0; height <= y; height += 1) {
          chunk.set(lx, height, lz, height === y ? BlockId.GrassBlock : BlockId.Stone);
        }
      }
    }
  }
}

function lightAll(world: VoxelWorld): void {
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
}

describe('simplified lighting, seams and budgets', () => {
  it('keeps identical sky values on a flat border between two chunks', () => {
    const world = new VoxelWorld('seam-flat');
    world.getChunk(0, 0);
    world.getChunk(1, 0);
    fillFlat(world, 48);
    lightAll(world);
    for (const y of [48, 49, 52, 60, 79]) {
      expect(world.skyLightAt(15, y, 8)).toBe(world.skyLightAt(16, y, 8));
    }
    expect(world.skyLightAt(15, 49, 8)).toBe(15);
    expect(world.skyLightAt(16, 49, 8)).toBe(15);
    expect(world.skyLightAt(15, 48, 8)).toBe(0);
  });

  it('propagates torch block light across a chunk border', () => {
    const world = new VoxelWorld('seam-torch');
    world.getChunk(0, 0);
    world.getChunk(1, 0);
    fillFlat(world, 40);
    for (let x = 12; x <= 20; x += 1) {
      for (let z = 6; z <= 10; z += 1) {
        for (let y = 41; y <= 50; y += 1) world.setBlock(x, y, z, BlockId.Air);
      }
    }
    lightAll(world);
    expect(world.setBlock(15, 44, 8, BlockId.Torch)).toBe(true);
    expect(world.blockLightAt(15, 44, 8)).toBe(14);
    expect(world.blockLightAt(16, 44, 8)).toBeGreaterThan(0);
    expect(world.blockLightAt(16, 44, 8)).toBeGreaterThanOrEqual(12);
  });

  it('keeps a closed chamber dark and admits sky through a roof hole', () => {
    const world = new VoxelWorld('seam-cave');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Stone);
    for (let x = 4; x <= 11; x += 1) {
      for (let z = 4; z <= 11; z += 1) {
        for (let y = 40; y <= 50; y += 1) chunk.set(x, y, z, BlockId.Air);
      }
    }
    world.ensureChunkLighting(chunk);
    expect(world.skyLightAt(8, 44, 8)).toBe(0);
    world.setBlock(8, 51, 8, BlockId.Air);
    for (let y = 52; y < WORLD_HEIGHT; y += 1) world.setBlock(8, y, 8, BlockId.Air);
    expect(world.skyLightAt(8, 44, 8)).toBeGreaterThan(0);
    expect(world.skyLightAt(5, 44, 8)).toBe(0);
  });

  it('does not recompute sky when placing or removing a torch', () => {
    const world = new VoxelWorld('torch-no-sky');
    world.ensureChunks(8, 8, 1);
    lightAll(world);
    resetLightEngineStats();
    world.setBlock(8, 50, 8, BlockId.Torch);
    expect(lightEngineStats.skyRecomputes).toBe(0);
    expect(lightEngineStats.blockPropagations).toBeGreaterThan(0);
    const blockBefore = lightEngineStats.blockPropagations;
    world.setBlock(8, 50, 8, BlockId.Air);
    expect(lightEngineStats.skyRecomputes).toBe(0);
    expect(lightEngineStats.blockPropagations).toBeGreaterThan(blockBefore);
  });

  it('does not start a sky recompute when a furnace starts or stops burning', () => {
    const world = new VoxelWorld('furnace-no-sky');
    world.ensureChunks(8, 8, 1);
    lightAll(world);
    world.setBlock(8, 50, 8, BlockId.Furnace);
    resetLightEngineStats();
    const furnace = world.getFurnace(8, 50, 8);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack(ItemId.Coal);
    world.tick();
    expect(world.blockEmissionAt(8, 50, 8)).toBeGreaterThan(0);
    expect(lightEngineStats.skyRecomputes).toBe(0);
    furnace.burnTime = 1;
    world.tick();
    expect(world.blockEmissionAt(8, 50, 8)).toBe(0);
    expect(lightEngineStats.skyRecomputes).toBe(0);
  });

  it('marks light versions stale until the mesh catches up', () => {
    const world = new VoxelWorld('stale-visual');
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    const renderer = new WorldRenderer(world, atlasStub);
    expect(renderer.rebuildDirty(4, 1_000)).toBeGreaterThan(0);
    expect(chunk.meshedLightVersion).toBe(chunk.lightVersion);
    expect(chunk.lightMeshStale).toBe(false);
    const version = chunk.lightVersion;
    world.setBlock(8, 40, 8, BlockId.Torch);
    expect(chunk.lightVersion).toBeGreaterThan(version);
    expect(chunk.lightMeshStale || chunk.dirty).toBe(true);
    renderer.rebuildDirty(4, 1_000);
    expect(chunk.meshedLightVersion).toBe(chunk.lightVersion);
    expect(chunk.lightMeshStale).toBe(false);
    renderer.dispose();
  });

  it('does not treat a chunk as mesh-ready without neighbor light context', () => {
    const world = new VoxelWorld('context-ready');
    world.setViewCenter(8, 8, 1);
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    expect(lightContextReady(world, chunk, 0, 0, world.generationRadius)).toBe(false);
    world.getChunk(1, 0);
    world.getChunk(-1, 0);
    world.getChunk(0, 1);
    world.getChunk(0, -1);
    expect(lightContextReady(world, chunk, 0, 0, world.generationRadius)).toBe(false);
    lightAll(world);
    expect(lightContextReady(world, chunk, 0, 0, world.generationRadius)).toBe(true);
  });

  it('requires the lighting halo to be generated and lit before initial ready', () => {
    expect(lightingHaloRadius(4)).toBe(4 + LIGHTING_HALO_CHUNKS);
    const world = new VoxelWorld('ready-halo');
    world.ensureChunks(0, 0, 1);
    lightAll(world);
    const meshes = new Set<string>();
    for (const key of world.chunks.keys()) meshes.add(key);
    for (const chunk of world.chunks.values()) {
      chunk.dirty = false;
      chunk.meshedLightVersion = chunk.lightVersion;
    }
    expect(initialAreaReady(world, (key) => meshes.has(key), 0, 0, 1, 2)).toBe(false);
    world.ensureChunks(0, 0, 2);
    lightAll(world);
    const progress = countInitialAreaProgress(world, (key) => meshes.has(key), 0, 0, 1, 2);
    expect(progress.generated).toBe(progress.generateTotal);
    expect(progress.lit).toBe(progress.litTotal);
    expect(progress.meshed).toBeLessThan(progress.meshTotal);
    for (const chunk of world.chunks.values()) {
      const key = `${chunk.x},${chunk.z}`;
      if (Math.max(Math.abs(chunk.x), Math.abs(chunk.z)) <= 1) {
        meshes.add(key);
        chunk.dirty = false;
        chunk.meshedLightVersion = chunk.lightVersion;
      }
    }
    expect(initialAreaReady(world, (key) => meshes.has(key), 0, 0, 1, 2)).toBe(true);
  });

  it('yields a lighting slice instead of running a monolithic chunk job', () => {
    const world = new VoxelWorld('light-slice');
    const chunk = world.getChunk(0, 0)!;
    resetLightFrameStats();
    const finished = processChunkLighting(world, chunk, performance.now());
    expect(finished).toBe(false);
    expect(chunk.skyReady).toBe(false);
    expect(chunk.skyFillCursor).toBeGreaterThan(0);
    expect(chunk.skyFillCursor).toBeLessThan(CHUNK_SIZE * CHUNK_SIZE);
    const started = performance.now();
    world.processLighting(2, 8, 8);
    expect(performance.now() - started).toBeLessThan(20);
    expect(lightFrameStats.maxSlice).toBeLessThan(20);
    let steps = 0;
    while (!chunk.lightingReady && steps < 64) {
      world.processLighting(2, 8, 8);
      steps += 1;
    }
    expect(chunk.lightingReady).toBe(true);
  });

  it('reads ?perf=1&chunks=1 as a DEV chunk-border overlay flag', () => {
    expect(isChunkOverlayQueryEnabled('?perf=1&chunks=1')).toBe(true);
    expect(isChunkOverlayQueryEnabled('?perf=1')).toBe(false);
  });
});
