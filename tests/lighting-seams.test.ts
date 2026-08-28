import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { createLightingQaScene, lightingQaOpening, lightingQaRoofHole, lightingQaSkyLine } from '../src/dev/lightingQaScenes';
import { ChunkMesher, disposeMeshedChunk } from '../src/rendering/ChunkMesher';
import { sampleSurfaceVertexLight } from '../src/world/lightSampling';
import { composeWorldLight } from '../src/rendering/worldLighting';
import { hasDirectSkyLight } from '../src/combat/fireSources';
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
  relightRegion,
  skyOcclusionClass,
  lightingFloodOwner,
  MAX_LIGHT_COLUMNS_PER_SLICE,
  MAX_LIGHT_NODES_PER_SLICE,
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

function settle(world: VoxelWorld): void {
  let steps = 0;
  do {
    world.processLighting(2, 8, 8);
    steps += 1;
  } while (world.pendingLightJobs > 0 && steps < 2000);
  expect(world.pendingLightJobs).toBe(0);
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
    expect(world.skyLightAt(5, 44, 8)).toBeGreaterThan(0);
    expect(world.skyLightAt(5, 44, 8)).toBeLessThan(world.skyLightAt(8, 44, 8));
  });

  it('does not recompute sky when placing or removing a torch', () => {
    const world = new VoxelWorld('torch-no-sky');
    world.ensureChunks(8, 8, 1);
    lightAll(world);
    resetLightEngineStats();
    world.setBlock(8, 88, 8, BlockId.Torch);
    expect(lightEngineStats.skyRecomputes).toBe(0);
    expect(lightEngineStats.blockPropagations).toBeGreaterThan(0);
    const blockBefore = lightEngineStats.blockPropagations;
    world.setBlock(8, 88, 8, BlockId.Air);
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
    world.getChunk(-1, -1);
    world.getChunk(-1, 1);
    world.getChunk(1, -1);
    world.getChunk(1, 1);
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

  it('admits lateral daylight through a wide wall opening and removes it when sealed', () => {
    const world = new VoxelWorld('lateral-room');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Stone);
    for (let z = 3; z <= 12; z += 1) {
      for (let x = 1; x <= 13; x += 1) {
        for (let y = 40; y < (x === 1 ? WORLD_HEIGHT : 46); y += 1) chunk.set(x, y, z, BlockId.Air);
      }
    }
    world.ensureChunkLighting(chunk);
    expect(world.skyLightAt(2, 42, 8)).toBeGreaterThan(0);
    expect(world.skyLightAt(2, 42, 8)).toBeGreaterThan(world.skyLightAt(10, 42, 8));
    const wall = [];
    for (let z = 3; z <= 12; z += 1) {
      for (let y = 40; y < 46; y += 1) wall.push({ x: 2, y, z, block: BlockId.Stone });
    }
    world.applyBlockBatch(wall, { deferLighting: true });
    for (let step = 0; world.pendingLightJobs > 0 && step < 500; step += 1) world.processLighting(2, 8, 8);
    expect(world.pendingLightJobs).toBe(0);
    expect(world.skyLightAt(3, 42, 8)).toBe(0);
    expect(world.skyLightAt(10, 42, 8)).toBe(0);
  });

  it.each([BlockId.Torch, BlockId.Glowstone, BlockId.Lantern])('imports external emitter %s across a regional boundary', (source) => {
    const world = new VoxelWorld(`external-${source}`);
    world.getChunk(0, 0)!.blocks.fill(BlockId.Air);
    world.getChunk(1, 0)!.blocks.fill(BlockId.Air);
    lightAll(world);
    world.setBlock(14, 40, 8, source);
    const before = world.blockLightAt(16, 40, 8);
    expect(before).toBeGreaterThan(0);
    relightRegion(world, { minX: 16, maxX: 20, minY: 38, maxY: 44, minZ: 5, maxZ: 11 }, false, true);
    expect(world.blockLightAt(16, 40, 8)).toBe(before);
  });

  it('keeps a mesh blocked until its diagonal light samples are ready', () => {
    const world = new VoxelWorld('diagonal-context');
    world.ensureChunks(8, 8, 1);
    const diagonal = world.getChunk(1, 1)!;
    for (const chunk of world.chunks.values()) {
      if (chunk !== diagonal) world.ensureChunkLighting(chunk);
    }
    expect(lightContextReady(world, world.getChunk(0, 0)!, 0, 0, 1)).toBe(false);
    world.ensureChunkLighting(diagonal);
    expect(lightContextReady(world, world.getChunk(0, 0)!, 0, 0, 1)).toBe(true);
  });
});

describe('lateral sky production paths', () => {
  it('does not mistake bright lateral sky under a roof for direct sunlight', () => {
    const world = createLightingQaScene('room');
    lightAll(world);
    expect(world.skyLightAt(2, 43, 16)).toBe(14);
    expect(hasDirectSkyLight(world, 2, 43, 16)).toBe(false);
    expect(hasDirectSkyLight(world, 1, 43, 16)).toBe(true);
  });
  it.each(['room', 'cave'] as const)('has a smooth finite gradient at a wide %s entrance', (kind) => {
    const world = createLightingQaScene(kind);
    lightAll(world);
    const line = lightingQaSkyLine(world);
    expect(line[0]).toBe(13);
    for (let i = 1; i < line.length; i += 1) {
      expect(line[i]).toBeLessThanOrEqual(line[i - 1]!);
      expect(line[i - 1]! - line[i]!).toBeLessThanOrEqual(1);
    }
    expect(line.at(-1)).toBe(0);
    world.applyBlockBatch(lightingQaOpening(false), { deferLighting: true });
    settle(world);
    expect(lightingQaSkyLine(world).every((level) => level === 0)).toBe(true);
    world.applyBlockBatch(lightingQaOpening(true), { deferLighting: true });
    settle(world);
    expect(lightingQaSkyLine(world)).toEqual(line);
  });

  it('keeps a roof hole local and removes its indirect light after closing', () => {
    const world = createLightingQaScene('closed');
    lightAll(world);
    world.deferredLighting = true;
    world.applyBlockBatch(lightingQaRoofHole(true));
    expect(world.hasPendingLighting(world.getChunk(0, 1)!)).toBe(true);
    settle(world);
    expect(world.skyLightAt(7, 43, 16)).toBe(15);
    expect(world.skyLightAt(9, 43, 16)).toBe(13);
    expect(world.skyLightAt(25, 43, 16)).toBe(0);
    world.applyBlockBatch(lightingQaRoofHole(false));
    settle(world);
    expect(lightingQaSkyLine(world).every((level) => level === 0)).toBe(true);
  });

  it('restarts edits inside unchanged bounds after a job has already started', () => {
    const world = createLightingQaScene('closed');
    lightAll(world);
    world.applyBlockBatch(lightingQaRoofHole(true), { deferLighting: true });
    world.processLighting(0.25, 8, 8);
    expect(world.pendingLightJobs).toBeGreaterThan(0);
    world.applyBlockBatch(lightingQaRoofHole(false), { deferLighting: true });
    settle(world);
    expect(lightingQaSkyLine(world).every((level) => level === 0)).toBe(true);
  });

  it('retains canopy shade while accepting light from adjacent open space', () => {
    const world = createLightingQaScene('forest');
    lightAll(world);
    expect(world.skyLightAt(3, 43, 12)).toBe(15);
    expect(world.skyLightAt(4, 43, 12)).toBe(14);
    expect(world.skyLightAt(15, 43, 12)).toBeLessThan(14);
    expect(world.skyLightAt(15, 43, 12)).toBeGreaterThan(0);
  });

  it('keeps registry sky filters explicit for translucent and small geometry', () => {
    for (const id of [BlockId.OakLeaves, BlockId.BirchLeaves, BlockId.SpruceLeaves, BlockId.Water, BlockId.Lava]) {
      expect(skyOcclusionClass(getBlockDefinition(id))).toBe('attenuate');
    }
    for (const id of [BlockId.Glass, BlockId.Ice, BlockId.TallGrass, BlockId.OakDoor, BlockId.Ladder,
      BlockId.Torch, BlockId.Lantern, BlockId.Chain]) expect(skyOcclusionClass(getBlockDefinition(id))).toBe('pass');
    expect(skyOcclusionClass(getBlockDefinition(BlockId.Glowstone))).toBe('block');
  });

  it.each([BlockId.Torch, BlockId.Glowstone, BlockId.Lantern])('removes source %s without ghost light across a border', (id) => {
    const world = createLightingQaScene('closed');
    lightAll(world);
    world.deferredLighting = true;
    world.setBlock(15, 43, 16, id);
    settle(world);
    expect(world.blockLightAt(16, 43, 16)).toBe(getBlockDefinition(id).emission! - 1);
    world.setBlock(15, 43, 16, BlockId.Air);
    settle(world);
    expect(world.blockLightAt(16, 43, 16)).toBe(0);
    expect(world.blockLightAt(13, 43, 16)).toBe(0);
  });

  it('does not discard emitters beyond the former 8192-entry flood limit', () => {
    const world = new VoxelWorld('many-emitters');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    chunk.blocks.fill(BlockId.Glowstone, 0, 41 * CHUNK_SIZE * CHUNK_SIZE);
    settle(world);
    expect(world.blockLightAt(8, 41, 8)).toBe(14);
    expect(world.blockLightAt(8, 45, 8)).toBe(10);
  });

  it('slices furnace on/off and removes the emission of a broken burning furnace', () => {
    const world = createLightingQaScene('closed');
    lightAll(world);
    world.deferredLighting = true;
    world.setBlock(13, 40, 16, BlockId.Furnace);
    settle(world);
    const furnace = world.getFurnace(13, 40, 16);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack(ItemId.Coal);
    resetLightEngineStats();
    world.tick();
    expect(world.isFurnaceBurning(13, 40, 16)).toBe(true);
    expect(lightEngineStats.blockPropagations).toBe(0);
    settle(world);
    expect(world.blockLightAt(14, 40, 16)).toBe(13);
    furnace.slots[0] = null;
    furnace.slots[1] = null;
    furnace.burnTime = 1;
    world.tick();
    settle(world);
    expect(world.blockLightAt(14, 40, 16)).toBe(0);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack(ItemId.Coal);
    world.tick();
    settle(world);
    expect(world.blockLightAt(14, 40, 16)).toBe(13);
    world.setBlock(13, 40, 16, BlockId.Air);
    settle(world);
    expect(world.blockLightAt(14, 40, 16)).toBe(0);
    expect(lightEngineStats.skyRecomputes).toBeGreaterThan(0);
  });

  it('does not import external light through a cold furnace on the region boundary', () => {
    const world = new VoxelWorld('cold-furnace-boundary');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Stone);
    for (let x = 2; x <= 12; x += 1) chunk.set(x, 43, 8, BlockId.Air);
    chunk.set(4, 43, 8, BlockId.Glowstone);
    chunk.set(6, 43, 8, BlockId.Furnace);
    lightAll(world);
    expect(world.blockLightAt(5, 43, 8)).toBe(14);
    expect(world.blockLightAt(7, 43, 8)).toBe(0);
    relightRegion(world, { minX: 6, maxX: 10, minY: 43, maxY: 43, minZ: 8, maxZ: 8 }, false, true);
    expect(world.blockLightAt(6, 43, 8)).toBe(0);
    expect(world.blockLightAt(7, 43, 8)).toBe(0);
  });

  it.each([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])(
    'imports incoming block light through regional face %s,%s,%s', (dx, dy, dz) => {
      const world = new VoxelWorld('external-six-faces');
      world.getChunk(0, 0)!.blocks.fill(BlockId.Air);
      lightAll(world);
      world.setBlock(8 + dx * 4, 44 + dy * 4, 8 + dz * 4, BlockId.Glowstone);
      const sample = [8 + dx * 2, 44 + dy * 2, 8 + dz * 2] as const;
      const before = world.blockLightAt(...sample);
      expect(before).toBe(13);
      relightRegion(world, { minX: 6, maxX: 10, minY: 42, maxY: 46, minZ: 6, maxZ: 10 }, false, true);
      expect(world.blockLightAt(...sample)).toBe(before);
    },
  );

  it('uses hard work caps even when the budget clock is frozen', () => {
    const world = createLightingQaScene('sources');
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      world.processLighting(2, 8, 8);
      expect(world.unlitChunkCount).toBeGreaterThan(0);
      expect(lightFrameStats.columns).toBeLessThanOrEqual(2 * MAX_LIGHT_COLUMNS_PER_SLICE);
      expect(lightFrameStats.nodes).toBeLessThanOrEqual(MAX_LIGHT_NODES_PER_SLICE);
    } finally { clock.mockRestore(); }
    settle(world);
  });

  it('does not run synchronous lighting from gameplay getters or steal another world job', () => {
    const world = createLightingQaScene('room');
    world.deferredLighting = true;
    world.processLighting(0.25, 8, 8);
    const owner = lightingFloodOwner(world);
    const neighbor = world.getChunk(2, 2)!;
    const cursor = neighbor.skyFillCursor;
    world.skyLightAt(40, 43, 40);
    world.blockLightAt(40, 43, 40);
    expect(neighbor.skyFillCursor).toBe(cursor);
    const other = createLightingQaScene('closed');
    other.ensureChunkLighting(other.getChunk(0, 0)!);
    expect(lightingFloodOwner(world)).toBe(owner);
    settle(world);
  });

  it('commits no version/remesh change for a region whose final lighting is unchanged', () => {
    const world = createLightingQaScene('room');
    lightAll(world);
    const versions = [...world.chunks.values()].map((chunk) => chunk.lightVersion);
    world.queueLight({ minX: 0, maxX: 29, minY: 30, maxY: 60, minZ: 0, maxZ: 29 }, true, true);
    settle(world);
    expect([...world.chunks.values()].map((chunk) => chunk.lightVersion)).toEqual(versions);
  });

  it('changes daylight through uniforms without relighting or modifying mesh attributes', () => {
    const world = createLightingQaScene('room');
    lightAll(world);
    const renderer = new WorldRenderer(world, atlasStub);
    const versions = [...world.chunks.values()].map((chunk) => chunk.lightVersion);
    const sky = world.getChunk(0, 0)!.skyLight.slice();
    resetLightEngineStats();
    renderer.setDaylight(0.08);
    renderer.setDaylight(1);
    expect(lightEngineStats.skyRecomputes + lightEngineStats.blockPropagations).toBe(0);
    expect(world.getChunk(0, 0)!.skyLight).toEqual(sky);
    expect([...world.chunks.values()].map((chunk) => chunk.lightVersion)).toEqual(versions);
    expect(composeWorldLight(0, 0, 0, 1, 1)[0]).toBeLessThan(0.1);
    renderer.dispose();
  });
});

describe('surface lighting consistency', () => {
  it('separates an opaque diagonal from light level and applies only bounded AO', () => {
    const read = (x: number, _y: number, z: number): number => x === 1 && z === 1 ? 256 : 15;
    const light = sampleSurfaceVertexLight(read, 1, 1, 1, 0, 1, 0, 0, 0, 0, { sky: 0, block: 0, ao: 1 });
    expect(light.sky).toBe(15);
    expect(light.ao).toBeCloseTo(0.95);
    const sealed = (x: number, _y: number, z: number): number => x !== z ? 256 : x === 1 ? 15 : 0;
    expect(sampleSurfaceVertexLight(sealed, 1, 1, 1, 0, 1, 0, 0, 0, 0, light).sky).toBe(0);
  });

  it('bakes the same shared diagonal vertices regardless of chunk lighting/build order', () => {
    const samples: number[][] = [];
    for (const reverse of [false, true]) {
      const world = createLightingQaScene('sources');
      const chunks = [...world.chunks.values()];
      if (reverse) chunks.reverse();
      for (const chunk of chunks) world.ensureChunkLighting(chunk);
      const mesher = new ChunkMesher(atlasStub);
      const geometry = mesher.build(world.getChunk(0, 0)!, world);
      const positions = geometry.opaque.getAttribute('position');
      const sky = geometry.opaque.getAttribute('skyLight');
      const block = geometry.opaque.getAttribute('blockLight');
      const sample: number[] = [];
      for (let i = 0; i < positions.count; i += 1) {
        if (positions.getX(i) === 16 && positions.getZ(i) === 16) sample.push(sky.getX(i), block.getX(i));
      }
      expect(sample.length).toBeGreaterThan(0);
      samples.push(sample);
      disposeMeshedChunk(geometry);
    }
    expect(samples[0]).toEqual(samples[1]);
  });

  it.each([BlockId.Stone, BlockId.StoneSlab, BlockId.StoneStairs, BlockId.OakFence, BlockId.Lantern,
    BlockId.Chain, BlockId.OakDoor, BlockId.Ladder, BlockId.Rail, BlockId.StoneButton, BlockId.Lever])(
    'samples full sky consistently on shape %s', (id) => {
      const world = new VoxelWorld(`shape-light-${id}`);
      const chunk = world.getChunk(0, 0)!;
      chunk.blocks.fill(BlockId.Air);
      chunk.set(8, 40, 8, id);
      world.ensureChunkLighting(chunk);
      const geometry = new ChunkMesher(atlasStub).build(chunk, world);
      let checked = 0;
      for (const layer of [geometry.opaque, geometry.cutout]) {
        const normals = layer.getAttribute('normal');
        const skies = layer.getAttribute('skyLight');
        for (let i = 0; i < normals.count; i += 1) {
          if (id !== BlockId.Stone || normals.getY(i) > 0.9) {
            expect(skies.getX(i)).toBeCloseTo(1);
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
      disposeMeshedChunk(geometry);
    },
  );

  it.each([BlockId.Stone, BlockId.StoneSlab, BlockId.StoneStairs, BlockId.OakFence, BlockId.Lantern])(
    'uses the same spatial gradient on cube and special top surfaces %s', (id) => {
      const world = new VoxelWorld('shape-gradient');
      const chunk = world.getChunk(0, 0)!;
      chunk.blocks.fill(BlockId.Air);
      chunk.set(8, 40, 8, id);
      world.ensureChunkLighting(chunk);
      for (let i = 0; i < chunk.skyLight.length; i += 1) chunk.skyLight[i] = 15 - i % CHUNK_SIZE;
      const geometry = new ChunkMesher(atlasStub).build(chunk, world);
      let checked = 0;
      for (const layer of [geometry.opaque, geometry.cutout]) {
        const normals = layer.getAttribute('normal');
        const positions = layer.getAttribute('position');
        const sky = layer.getAttribute('skyLight');
        for (let i = 0; i < normals.count; i += 1) {
          if (normals.getY(i) <= 0.9) continue;
          expect(sky.getX(i)).toBeCloseTo((15.5 - positions.getX(i)) / 15);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
      disposeMeshedChunk(geometry);
    },
  );
});
