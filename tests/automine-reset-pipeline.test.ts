import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, chunkKey, MESH_SECTION_HEIGHT } from '../src/core/constants';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import {
  applyNetworkBlockChanges,
  URGENT_MUTATION_MESH_BUDGET_MS,
  URGENT_MUTATION_MESH_LIMIT,
} from '../src/world/networkBlockUpdates';
import {
  EDIT_LIGHT_BURST_HOLD_MS,
  VoxelWorld,
} from '../src/world/World';
import { LIGHT_FLOOD_REGION, lightingFloodOwner } from '../src/world/LightEngine';
import { AutoMineManager, cuboidSize, fillVoxelAt } from '../server/services/autoMine';
import { volumeFromCorners } from '../server/services/selection';
import type { AutoMineHost, AutoMineStore } from '../server/services/autoMine';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function memoryHost(world: VoxelWorld): AutoMineHost {
  const store: AutoMineStore = { mines: [] };
  const originals = new Map<string, { blocks: number[] }>();
  return {
    world,
    worldId: () => 'anarchy',
    now: () => 1,
    random: () => 0.1,
    loadStore: () => store,
    saveStore: (next) => {
      store.mines = next.mines;
    },
    loadOriginals: (name) => originals.get(name),
    saveOriginals: (name, blocks) => {
      originals.set(name, { blocks: [...blocks] });
    },
    players: () => [],
    teleport: () => ({ ok: true }),
    send: () => undefined,
    notifyAdmins: () => undefined,
    log: () => undefined,
  };
}

function markLit(world: VoxelWorld, minCx: number, maxCx: number, minCz: number, maxCz: number): void {
  for (let cz = minCz; cz <= maxCz; cz += 1) {
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      const chunk = world.getChunk(cx, cz)!;
      chunk.skyReady = true;
      chunk.skyLateralReady = true;
      chunk.blockLightReady = true;
      chunk.dirty = true;
    }
  }
}

/** Replace V3 hydrology water in a Y band so remesh timing measures AutoMine, not ocean faces. */
function flattenSectionBand(
  world: VoxelWorld,
  minCx: number,
  maxCx: number,
  minCz: number,
  maxCz: number,
  minY: number,
  maxY: number,
): void {
  for (let cz = minCz; cz <= maxCz; cz += 1) {
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      const chunk = world.getChunk(cx, cz)!;
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          for (let y = minY; y <= maxY; y += 1) {
            chunk.set(x, y, z, BlockId.Stone);
          }
        }
      }
      chunk.skyReady = true;
      chunk.skyLateralReady = true;
      chunk.blockLightReady = true;
      chunk.dirty = true;
    }
  }
}

describe('AutoMine reset pipeline', () => {
  it('remeshes only dirty Y sections instead of the full column after a live batch', () => {
    const world = new VoxelWorld('automine-section-mesh');
    world.deferredLighting = true;
    markLit(world, -1, 1, -1, 1);
    const renderer = new WorldRenderer(world, atlasStub);
    renderer.rebuildDirty(16, 500, 8, 8, { requireNeighborLight: false, allowPendingLighting: true });
    const beforeSamples = renderer.meshSamples;

    const changes = [];
    for (let z = 1; z < 7; z += 1) {
      for (let x = 1; x < 7; x += 1) {
        changes.push({ x, y: 90, z, blockId: BlockId.DiamondOre });
      }
    }
    const applied = applyNetworkBlockChanges(world, changes);
    expect(applied.applied).toBe(36);
    const rebuilt = renderer.rebuildDirty(URGENT_MUTATION_MESH_LIMIT, 20, 8, 8, {
      requireNeighborLight: false,
      allowPendingLighting: true,
      preferKeys: new Set(applied.meshKeys),
    });
    expect(rebuilt).toBeGreaterThan(0);
    expect(renderer.lastRebuildSections).toBeLessThanOrEqual(2);
    expect(renderer.meshSamples).toBeGreaterThan(beforeSamples);
    expect(world.getBlock(1, 90, 1)).toBe(BlockId.DiamondOre);
    renderer.dispose();
  });

  it('does not start an edit-region light flood while a large batch burst is still arriving', () => {
    const world = new VoxelWorld('automine-light-hold');
    world.deferredLighting = true;
    markLit(world, -1, 1, -1, 1);
    const mutations = [];
    for (let i = 0; i < 64; i += 1) {
      mutations.push({ x: i % 8, y: 90, z: Math.floor(i / 8), block: BlockId.DiamondOre });
    }
    world.applyBlockBatch(mutations, { deferLighting: true, skipSupport: true, scheduleNeighbors: false });
    expect(world.hasQueuedRegionLight).toBe(true);
    world.processLighting(8, 8, 8);
    expect(lightingFloodOwner(world)).not.toBe(LIGHT_FLOOD_REGION);

    const realNow = performance.now.bind(performance);
    const started = realNow();
    vi.spyOn(performance, 'now').mockImplementation(() => started + EDIT_LIGHT_BURST_HOLD_MS + 5);
    world.processLighting(8, 8, 8);
    expect(lightingFloodOwner(world) === LIGHT_FLOOD_REGION || !world.hasQueuedRegionLight).toBe(true);
    vi.restoreAllMocks();
  });

  it('applies a 15³ AutoMine reset as aggregated batches with bounded remesh work', () => {
    const server = new VoxelWorld('automine-pipeline-15');
    const client = new VoxelWorld('automine-pipeline-15-client');
    client.deferredLighting = true;
    markLit(client, -1, 2, -1, 2);
    flattenSectionBand(client, -1, 2, -1, 2, 48, 79);
    const renderer = new WorldRenderer(client, atlasStub);
    renderer.rebuildDirty(16, 80, 16, 16, { requireNeighborLight: false, allowPendingLighting: true });

    const volume = volumeFromCorners({ x: 1, y: 50, z: 1 }, { x: 15, y: 64, z: 15 });
    expect(cuboidSize(volume).blocks).toBe(15 * 15 * 15);
    const batches: number[] = [];
    const meshMs: number[] = [];
    const sections: number[] = [];
    const original = server.applyBlockBatch.bind(server);
    server.applyBlockBatch = ((mutations, options) => {
      batches.push(mutations.length);
      const stats = original(mutations, options);
      const applied = applyNetworkBlockChanges(client, mutations.map((m) => ({
        x: m.x, y: m.y, z: m.z, blockId: m.block,
      })));
      const before = renderer.meshTotalMs;
      renderer.rebuildDirty(URGENT_MUTATION_MESH_LIMIT, URGENT_MUTATION_MESH_BUDGET_MS, 8, 8, {
        requireNeighborLight: false,
        allowPendingLighting: true,
        preferKeys: new Set(applied.meshKeys),
      });
      meshMs.push(renderer.meshTotalMs - before);
      sections.push(renderer.lastRebuildSections);
      return stats;
    }) as VoxelWorld['applyBlockBatch'];

    const manager = new AutoMineManager(memoryHost(server));
    manager.enabled = true;
    manager.blocksPerTick = 64;
    expect(manager.create('pipe15', volume, 'anarchy').ok).toBe(true);
    let ticks = 0;
    while (manager.isResetting('pipe15') && ticks < 200) {
      manager.tick();
      ticks += 1;
    }
    expect(manager.isResetting('pipe15')).toBe(false);
    expect(Math.max(...batches)).toBe(64);
    expect(Math.max(...sections)).toBeLessThanOrEqual(6);
    expect(Math.max(...meshMs)).toBeLessThan(40);
    expect(client.getBlock(fillVoxelAt(volume, 0).x, fillVoxelAt(volume, 0).y, fillVoxelAt(volume, 0).z)).not.toBe(BlockId.Air);
    expect(manager.lastResetMetrics?.blocksWritten).toBe(15 * 15 * 15);
    renderer.dispose();
  });
});

describe('ChunkMesher Y range', () => {
  it('scans only the requested Y band', () => {
    const world = new VoxelWorld('mesher-y-range');
    const chunk = world.getChunk(0, 0)!;
    chunk.set(8, 40, 8, BlockId.Stone);
    chunk.set(8, 70, 8, BlockId.Stone);
    const mesher = new ChunkMesher(atlasStub);
    const band = mesher.build(chunk, world, { minY: 64, maxY: 79 });
    const positions = band.opaque.getAttribute('position') as THREE.BufferAttribute;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < positions.count * 3; i += 3) {
      const y = positions.array[i]!;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(minY).toBeGreaterThanOrEqual(64);
    expect(maxY).toBeLessThanOrEqual(80);
    expect(chunkKey(0, 0)).toBe('0,0');
    expect(MESH_SECTION_HEIGHT).toBe(16);
    band.opaque.dispose();
    band.cutout.dispose();
    band.vegetation.dispose();
    band.translucent.dispose();
    band.water.dispose();
    band.fire.dispose();
  });
});
