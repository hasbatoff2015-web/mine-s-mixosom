import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { chunkKey, WORLD_JOB_BUDGET_MS, WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import {
  applyNetworkBlockChanges,
  collectMutationMeshKeys,
  URGENT_MUTATION_MESH_BUDGET_MS,
  URGENT_MUTATION_MESH_LIMIT,
} from '../src/world/networkBlockUpdates';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function litWorld(): VoxelWorld {
  const world = new VoxelWorld('urgent-mesh');
  world.deferredLighting = true;
  for (let cz = -1; cz <= 1; cz += 1) {
    for (let cx = -1; cx <= 1; cx += 1) {
      const chunk = world.getChunk(cx, cz)!;
      for (let z = 0; z < 16; z += 1) {
        for (let x = 0; x < 16; x += 1) chunk.set(x, 40, z, BlockId.Stone);
      }
      chunk.skyReady = true;
      chunk.skyLateralReady = true;
      chunk.blockLightReady = true;
      chunk.dirty = false;
    }
  }
  return world;
}

describe('urgent live block remesh', () => {
  it('includes the edited chunk and border neighbors', () => {
    const keys = collectMutationMeshKeys([{ x: 15, z: 8 }, { x: 16, z: 8 }]);
    expect(keys).toContain(chunkKey(0, 0));
    expect(keys).toContain(chunkKey(1, 0));
  });

  it('dirties collision immediately and remeshes without waiting on pending light', () => {
    const world = litWorld();
    const renderer = new WorldRenderer(world, atlasStub);
    renderer.rebuildDirty(9, 50, 8, 8, { requireNeighborLight: false, allowPendingLighting: true });
    const beforeFaces = renderer.meshSamples;

    const applied = applyNetworkBlockChanges(world, [
      { x: 8, y: 41, z: 8, blockId: BlockId.Dirt },
    ]);
    expect(world.getBlock(8, 41, 8)).toBe(BlockId.Dirt);
    expect(applied.meshKeys.length).toBeGreaterThan(0);
    const chunk = world.getChunk(0, 0, false)!;
    expect(chunk.dirty).toBe(true);
    chunk.lightPending = true;
    expect(world.hasPendingLighting(chunk)).toBe(true);
    const blocked = renderer.rebuildDirty(URGENT_MUTATION_MESH_LIMIT, URGENT_MUTATION_MESH_BUDGET_MS, 8, 8, {
      requireNeighborLight: false,
      preferKeys: new Set(applied.meshKeys),
    });
    expect(blocked).toBe(0);
    expect(chunk.dirty).toBe(true);
    const urgent = renderer.rebuildDirty(URGENT_MUTATION_MESH_LIMIT, URGENT_MUTATION_MESH_BUDGET_MS, 8, 8, {
      requireNeighborLight: false,
      allowPendingLighting: true,
      preferKeys: new Set(applied.meshKeys),
    });
    expect(urgent).toBeGreaterThan(0);
    expect(renderer.meshSamples).toBeGreaterThan(beforeFaces);
    expect(chunk.dirty).toBe(false);
  });

  it('remeshes a state-only door/slab mutation on the same urgent path', () => {
    const world = litWorld();
    world.applyBlockBatch([{ x: 8, y: 41, z: 8, block: BlockId.OakDoor }], {
      skipSupport: true,
      deferLighting: true,
    });
    const chunk = world.getChunk(0, 0, false)!;
    chunk.skyReady = true;
    chunk.skyLateralReady = true;
    chunk.blockLightReady = true;
    const renderer = new WorldRenderer(world, atlasStub);
    applyNetworkBlockChanges(world, [
      { x: 8, y: 41, z: 8, blockId: BlockId.OakDoor, state: { open: true, facing: 'north', half: 'lower' } },
    ]);
    const keys = collectMutationMeshKeys([{ x: 8, z: 8 }]);
    const rebuilt = renderer.rebuildDirty(URGENT_MUTATION_MESH_LIMIT, URGENT_MUTATION_MESH_BUDGET_MS, 8, 8, {
      requireNeighborLight: false,
      allowPendingLighting: true,
      preferKeys: new Set(keys),
    });
    expect(rebuilt).toBeGreaterThan(0);
  });

  it('uses a dedicated urgent slice instead of raising the global job budget', () => {
    expect(WORLD_JOB_BUDGET_MS).toBe(4);
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
    expect(URGENT_MUTATION_MESH_BUDGET_MS).toBeLessThanOrEqual(WORLD_JOB_BUDGET_MS);
    expect(URGENT_MUTATION_MESH_LIMIT).toBeLessThanOrEqual(3);
  });
});
