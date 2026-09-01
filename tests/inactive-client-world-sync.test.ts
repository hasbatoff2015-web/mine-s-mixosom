import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import {
  playerGameplayAllowed,
  worldSimulationActive,
} from '../src/core/gameplayModal';
import type { LifecycleState } from '../src/core/lifecycleTypes';
import {
  shouldProcessOnlineWorldVisuals,
  shouldRunClientFluidSimulation,
  shouldRunClientWorldSimulation,
} from '../src/core/onlineSimulation';
import { applyNetworkBlockChanges } from '../src/world/networkBlockUpdates';
import { VoxelWorld } from '../src/world/World';
import { parseServerMessage } from '../shared/protocol';

function loadFlat(world: VoxelWorld, floorY = 40): void {
  world.getChunk(0, 0);
  world.getChunk(1, 0);
  world.getChunk(0, 1);
  world.getChunk(-1, 0);
  world.getChunk(0, -1);
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        chunk.set(x, floorY, z, BlockId.Stone);
        chunk.set(x, 0, z, BlockId.Bedrock);
      }
    }
    chunk.dirty = false;
  }
  world.pendingMesh.clear();
}

describe('inactive Anarchy client world visuals', () => {
  it('does not run a second world/fluid simulation online', () => {
    expect(shouldRunClientWorldSimulation(true)).toBe(false);
    expect(shouldRunClientFluidSimulation(true)).toBe(false);
    expect(shouldRunClientWorldSimulation(false)).toBe(true);
  });

  it('applies remesh/light while PLAYING, including inventory overlay', () => {
    expect(worldSimulationActive('PLAYING')).toBe(true);
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
    expect(shouldProcessOnlineWorldVisuals('PLAYING')).toBe(true);
  });

  it('applies remesh/light while PAUSED and BACKGROUND without ticking the kernel', () => {
    expect(worldSimulationActive('PAUSED')).toBe(false);
    expect(worldSimulationActive('BACKGROUND')).toBe(false);
    expect(playerGameplayAllowed('PAUSED', false)).toBe(false);
    expect(playerGameplayAllowed('BACKGROUND', false)).toBe(false);
    expect(shouldProcessOnlineWorldVisuals('PAUSED')).toBe(true);
    expect(shouldProcessOnlineWorldVisuals('BACKGROUND')).toBe(true);
  });

  it('does not drain world jobs from menu/loading/ad', () => {
    const idle: LifecycleState[] = ['LOADING', 'LOADING_WORLD', 'MENU', 'AD'];
    for (const state of idle) {
      expect(shouldProcessOnlineWorldVisuals(state), state).toBe(false);
    }
  });

  it('applies block_update into VoxelWorld while the client would be PAUSED', () => {
    const world = new VoxelWorld('inactive-block-update');
    loadFlat(world);
    expect(shouldProcessOnlineWorldVisuals('PAUSED')).toBe(true);
    expect(worldSimulationActive('PAUSED')).toBe(false);
    applyNetworkBlockChanges(world, [{ x: 8, y: 41, z: 8, blockId: BlockId.Dirt }]);
    expect(world.getBlock(8, 41, 8, false)).toBe(BlockId.Dirt);
    expect(world.getChunk(0, 0, false)?.dirty).toBe(true);
    expect(world.pendingMesh.has('0,0')).toBe(true);
  });

  it('applies inventory-time updates the same way as PLAYING (overlay is not a packet gate)', () => {
    const world = new VoxelWorld('inactive-inventory');
    loadFlat(world);
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
    expect(shouldProcessOnlineWorldVisuals('PLAYING')).toBe(true);
    applyNetworkBlockChanges(world, [{ x: 4, y: 41, z: 4, blockId: BlockId.Cobblestone }]);
    expect(world.getBlock(4, 41, 4, false)).toBe(BlockId.Cobblestone);
  });

  it('keeps block_batch order: last write at a cell wins, earlier cells stay', () => {
    const world = new VoxelWorld('inactive-batch-order');
    loadFlat(world);
    applyNetworkBlockChanges(world, [
      { x: 5, y: 41, z: 5, blockId: BlockId.Dirt },
      { x: 6, y: 41, z: 5, blockId: BlockId.Stone },
      { x: 5, y: 41, z: 5, blockId: BlockId.OakLog },
    ]);
    expect(world.getBlock(5, 41, 5, false)).toBe(BlockId.OakLog);
    expect(world.getBlock(6, 41, 5, false)).toBe(BlockId.Stone);
  });

  it('applies a parsed block_batch while BACKGROUND without needing a replay on resume', () => {
    const world = new VoxelWorld('inactive-batch-parse');
    loadFlat(world);
    const message = parseServerMessage({
      type: 'block_batch',
      changes: [
        { x: 2, y: 41, z: 2, blockId: BlockId.Dirt },
        { x: 3, y: 41, z: 2, blockId: BlockId.Air },
      ],
    });
    if ('error' in message) throw new Error(message.error);
    expect(message.type).toBe('block_batch');
    if (message.type !== 'block_batch') return;
    applyNetworkBlockChanges(world, message.changes);
    expect(world.getBlock(2, 41, 2, false)).toBe(BlockId.Dirt);
    expect(world.getBlock(3, 41, 2, false)).toBe(BlockId.Air);
    const dirtied = world.dirtyChunkCount;
    applyNetworkBlockChanges(world, message.changes);
    expect(world.getBlock(2, 41, 2, false)).toBe(BlockId.Dirt);
    expect(world.dirtyChunkCount).toBe(dirtied);
  });

  it('dirties both chunks for a border write at x=15/16', () => {
    const world = new VoxelWorld('inactive-border');
    loadFlat(world);
    applyNetworkBlockChanges(world, [
      { x: 15, y: 41, z: 8, blockId: BlockId.Dirt },
      { x: 16, y: 41, z: 8, blockId: BlockId.Dirt },
    ]);
    expect(world.getBlock(15, 41, 8, false)).toBe(BlockId.Dirt);
    expect(world.getBlock(16, 41, 8, false)).toBe(BlockId.Dirt);
    expect(world.getChunk(0, 0, false)?.dirty).toBe(true);
    expect(world.getChunk(1, 0, false)?.dirty).toBe(true);
  });

  it('keeps fluid level/state from a live packet while inactive', () => {
    const world = new VoxelWorld('inactive-fluid');
    loadFlat(world, 40);
    applyNetworkBlockChanges(world, [
      { x: 8, y: 41, z: 8, blockId: BlockId.Water, state: { fluidLevel: 6, fluidFalling: false } },
    ]);
    expect(world.getBlock(8, 41, 8, false)).toBe(BlockId.Water);
    expect(world.getBlockState(8, 41, 8)?.fluidLevel).toBe(6);
    expect(world.getBlockState(8, 41, 8)?.fluidFalling).toBe(false);
  });

  it('queues deferred lighting from the network write instead of rewriting LightEngine', () => {
    const world = new VoxelWorld('inactive-light');
    world.deferredLighting = true;
    loadFlat(world);
    const before = world.pendingLightJobs;
    applyNetworkBlockChanges(world, [{ x: 8, y: 41, z: 8, blockId: BlockId.Glowstone }]);
    expect(world.getBlock(8, 41, 8, false)).toBe(BlockId.Glowstone);
    expect(world.pendingLightJobs).toBeGreaterThanOrEqual(before);
    expect(world.getChunk(0, 0, false)?.dirty).toBe(true);
  });

  it('does not start client kernel ticks just because visuals still drain', () => {
    expect(shouldProcessOnlineWorldVisuals('PAUSED')).toBe(true);
    expect(worldSimulationActive('PAUSED')).toBe(false);
    expect(shouldRunClientWorldSimulation(true)).toBe(false);
  });
});
