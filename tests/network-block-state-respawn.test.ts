import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import {
  shouldRestoreGameplayAfterRespawn,
  lifecycleAfterOnlineRespawn,
  onlineRespawnAllowsMovement,
  planOnlineRespawnInputRestore,
} from '../src/core/onlineRespawn';
import { shouldRunClientFluidSimulation, shouldRunClientWorldSimulation } from '../src/core/onlineSimulation';
import {
  playerGameplayAllowed,
  resolvePlayerMoveInput,
  worldSimulationActive,
} from '../src/core/gameplayModal';
import { shouldResumeFromBackground } from '../src/core/lifecycleFocus';
import { fluidCellGeometry, fluidTopHasSlope } from '../src/world/fluidSurface';
import { isUseTargetBlock } from '../src/world/blockInteraction';
import { applyNetworkBlockChanges } from '../src/world/networkBlockUpdates';
import { VoxelWorld } from '../src/world/World';
import { parseNetworkBlockState, parseServerMessage } from '../shared/protocol';
import type { MoveInput } from '../src/input/InputManager';

const live: MoveInput = {
  forward: 1,
  right: 1,
  jump: true,
  sprint: true,
  sneak: false,
  descend: true,
  flySprint: false,
};

function loadFlat(world: VoxelWorld, floorY = 40): void {
  world.getChunk(0, 0);
  world.getChunk(1, 0);
  world.getChunk(-1, 0);
  world.getChunk(0, 1);
  world.getChunk(0, -1);
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        chunk.set(x, floorY, z, BlockId.Stone);
        chunk.set(x, 0, z, BlockId.Bedrock);
      }
    }
  }
}

describe('online respawn input lifecycle', () => {
  it('restores PLAYING from BACKGROUND/DEAD after death → alive', () => {
    expect(shouldRestoreGameplayAfterRespawn(
      { dead: true, health: 0 },
      { dead: false, health: 20 },
    )).toBe(true);
    expect(lifecycleAfterOnlineRespawn('BACKGROUND')).toBe('PLAYING');
    expect(lifecycleAfterOnlineRespawn('DEAD')).toBe('PLAYING');
    expect(lifecycleAfterOnlineRespawn('PAUSED')).toBe('PAUSED');
    expect(onlineRespawnAllowsMovement('BACKGROUND', false)).toBe(true);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    expect(worldSimulationActive('PLAYING')).toBe(true);
  });

  it('keeps WASD available after respawn even if chat was open', () => {
    expect(resolvePlayerMoveInput(false, live).forward).toBe(1);
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
    expect(playerGameplayAllowed(lifecycleAfterOnlineRespawn('BACKGROUND'), false)).toBe(true);
    const plan = planOnlineRespawnInputRestore({
      state: 'BACKGROUND',
      pointerLocked: false,
      chatOpen: true,
      inventoryOpen: false,
    });
    expect(plan.lifecycle).toBe('PLAYING');
    expect(plan.clearHeldKeys).toBe(true);
    expect(worldSimulationActive(plan.lifecycle)).toBe(true);
  });

  it('treats pointer lock resume as compatible with post-respawn PLAYING', () => {
    expect(shouldResumeFromBackground({ state: 'BACKGROUND', documentHidden: false })).toBe(true);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
  });
});

describe('online world simulation ownership', () => {
  it('does not run client world/fluid simulation while online', () => {
    expect(shouldRunClientWorldSimulation(true)).toBe(false);
    expect(shouldRunClientFluidSimulation(true)).toBe(false);
    expect(shouldRunClientWorldSimulation(false)).toBe(true);
    expect(shouldRunClientFluidSimulation(false)).toBe(true);
    expect(isUseTargetBlock(BlockId.StoneButton)).toBe(true);
    expect(isUseTargetBlock(BlockId.OakDoor)).toBe(true);
    expect(isUseTargetBlock(BlockId.Stone)).toBe(false);
  });
});

describe('live network block state vs initial chunk load', () => {
  it('parses optional block state on block_update / block_batch', () => {
    const parsed = parseServerMessage({
      type: 'block_update',
      x: 1, y: 2, z: 3, blockId: BlockId.Water,
      state: { fluidLevel: 4, fluidFalling: false },
    });
    expect(parsed).toMatchObject({
      type: 'block_update',
      blockId: BlockId.Water,
      state: { fluidLevel: 4, fluidFalling: false },
    });
    expect(parseNetworkBlockState({ facing: 'west', attachment: 'wall' })).toEqual({
      facing: 'west',
      attachment: 'wall',
    });
    expect(parseNetworkBlockState({ hydrated: true, age: 99 })).toEqual({ hydrated: true, age: 7 });
    const batch = parseServerMessage({
      type: 'block_batch',
      changes: [
        { x: 0, y: 1, z: 2, blockId: BlockId.Chest, state: { facing: 'east' } },
        { x: 0, y: 1, z: 3, blockId: BlockId.Air },
      ],
    });
    expect(batch).toMatchObject({
      type: 'block_batch',
      changes: [
        { x: 0, y: 1, z: 2, blockId: BlockId.Chest, state: { facing: 'east' } },
        { x: 0, y: 1, z: 3, blockId: BlockId.Air },
      ],
    });
  });

  it('keeps corner-based fluid mesh when the same cells arrive as live updates', () => {
    const loaded = new VoxelWorld('fluid-path-a');
    loadFlat(loaded, 30);
    loaded.setBlock(8, 31, 8, BlockId.Water);
    loaded.setBlock(9, 31, 8, BlockId.Water);
    loaded.setBlockState(9, 31, 8, { fluidLevel: 6, fluidFalling: false });
    loaded.setBlock(10, 31, 8, BlockId.Water);
    loaded.setBlockState(10, 31, 8, { fluidLevel: 4, fluidFalling: false });
    const loadedGeom = fluidCellGeometry(loaded, 10, 31, 8)!;
    expect(fluidTopHasSlope(loadedGeom.top!)).toBe(true);

    const live = new VoxelWorld('fluid-path-b');
    loadFlat(live, 30);
    live.setBlock(8, 31, 8, BlockId.Water);
    live.setBlock(9, 31, 8, BlockId.Water);
    live.setBlock(10, 31, 8, BlockId.Water);
    expect(live.getBlockState(10, 31, 8)?.fluidLevel).toBeUndefined();

    applyNetworkBlockChanges(live, [
      { x: 8, y: 31, z: 8, blockId: BlockId.Water, state: { fluidLevel: 8 } },
      { x: 9, y: 31, z: 8, blockId: BlockId.Water, state: { fluidLevel: 6, fluidFalling: false } },
      { x: 10, y: 31, z: 8, blockId: BlockId.Water, state: { fluidLevel: 4, fluidFalling: false } },
    ]);
    const after = fluidCellGeometry(live, 10, 31, 8)!;
    expect(live.getBlockState(10, 31, 8)?.fluidLevel).toBe(4);
    expect(fluidTopHasSlope(after.top!)).toBe(true);
    expect(after.top).toEqual(loadedGeom.top);
  });

  it('keeps live lava levels and dirties neighbor chunks at x=15/x=16', () => {
    const world = new VoxelWorld('fluid-border');
    loadFlat(world, 30);
    world.meshDirtyMarks = 0;
    applyNetworkBlockChanges(world, [
      { x: 15, y: 31, z: 8, blockId: BlockId.Lava, state: { fluidLevel: 6, fluidFalling: false } },
      { x: 16, y: 31, z: 8, blockId: BlockId.Lava, state: { fluidLevel: 4, fluidFalling: false } },
    ]);
    expect(world.getBlockState(15, 31, 8)?.fluidLevel).toBe(6);
    expect(world.getBlockState(16, 31, 8)?.fluidLevel).toBe(4);
    expect(world.getChunk(0, 0, false)?.dirty).toBe(true);
    expect(world.getChunk(1, 0, false)?.dirty).toBe(true);
    const left = fluidCellGeometry(world, 15, 31, 8)!.top!;
    const right = fluidCellGeometry(world, 16, 31, 8)!.top!;
    expect(left.h10).toBeCloseTo(right.h00, 6);
    expect(left.h11).toBeCloseTo(right.h01, 6);
  });

  it('applies a fluid batch then remeshes each chunk once', () => {
    const world = new VoxelWorld('fluid-batch');
    loadFlat(world, 30);
    world.meshDirtyMarks = 0;
    applyNetworkBlockChanges(world, [
      { x: 7, y: 31, z: 7, blockId: BlockId.Water, state: { fluidLevel: 7 } },
      { x: 8, y: 31, z: 7, blockId: BlockId.Water, state: { fluidLevel: 5 } },
      { x: 9, y: 31, z: 7, blockId: BlockId.Water, state: { fluidLevel: 3 } },
    ]);
    const pending = [...world.pendingMesh];
    expect(pending.filter((key) => key === '0,0').length).toBe(1);
    expect(world.getChunk(0, 0, false)?.dirty).toBe(true);
  });
});
