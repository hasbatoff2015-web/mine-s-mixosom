import { describe, expect, it } from 'vitest';
import { chunkKey } from '../src/core/constants';
import { VoxelWorld } from '../src/world/World';
import { countInitialAreaProgress, initialAreaReady } from '../src/world/worldJobs';
import { completeCpuMesh, queueChunksMissingMesh } from '../src/world/streamingScheduler';
import { parseServerMessage, SERVER_MESSAGE_TYPES } from '../shared/protocol';

function parkedChunk(world: VoxelWorld) {
  const chunk = world.getChunk(0, 0, true);
  if (!chunk) throw new Error('chunk was not generated');
  chunk.skyReady = true;
  chunk.skyLateralReady = true;
  chunk.blockLightReady = true;
  chunk.lightPending = false;
  chunk.generated = true;
  chunk.dirty = false;
  chunk.meshedLightVersion = chunk.lightVersion;
  world.acknowledgeMeshed(chunk);
  return chunk;
}

describe('dimension switch', () => {
  it('accepts the dimension packet the multiplayer client must apply', () => {
    expect(SERVER_MESSAGE_TYPES).toContain('dimension');
    expect(parseServerMessage({
      type: 'dimension',
      dimension: 'nether',
      seed: 'anarchy-spawn-v1',
      timeOfDay: 12_800,
      x: 1.5,
      y: 40,
      z: 2.5,
      yaw: 0.2,
      pitch: -0.1,
      movementEpoch: 3,
      modifications: { '0,0': { '10': 171 } },
      blockStates: {},
    })).toMatchObject({
      type: 'dimension',
      dimension: 'nether',
      seed: 'anarchy-spawn-v1',
      movementEpoch: 3,
    });
    expect(parseServerMessage({ type: 'dimension', dimension: 'end' })).toEqual({ error: 'dimension invalid' });
  });

  it('queues a parked overworld column that the new renderer has not meshed', () => {
    const world = new VoxelWorld('mesh-stall', 'overworld');
    world.deferredLighting = true;
    const parked = parkedChunk(world);
    const key = chunkKey(0, 0);
    const stalled = countInitialAreaProgress(world, () => false, 8, 8, 0, 0);
    expect(stalled.generated).toBe(stalled.generateTotal);
    expect(stalled.lit).toBe(stalled.litTotal);
    expect(stalled.meshed).toBe(0);
    expect(world.pendingMeshJobs).toBe(0);

    const chunk = parked;
    const version = chunk.meshContentVersion;
    expect(queueChunksMissingMesh(world, () => false, 8, 8, 0)).toBe(1);
    expect(chunk.dirty).toBe(true);
    expect(world.pendingMeshJobs).toBe(1);
    expect(queueChunksMissingMesh(world, () => false, 8, 8, 0)).toBe(0);
    expect(chunk.meshContentVersion).toBe(version + 1);

    for (let trip = 0; trip < 5; trip += 1) {
      completeCpuMesh(world, chunk);
      expect(initialAreaReady(world, (candidate) => candidate === key, 8, 8, 0, 0)).toBe(true);
      chunk.dirty = false;
      chunk.meshedLightVersion = chunk.lightVersion;
      world.acknowledgeMeshed(chunk);
      expect(queueChunksMissingMesh(world, () => false, 8, 8, 0)).toBe(1);
    }
    completeCpuMesh(world, chunk);
    expect(queueChunksMissingMesh(world, (candidate) => candidate === key, 8, 8, 0)).toBe(0);
  });
});
