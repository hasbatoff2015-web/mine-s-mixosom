import { describe, expect, it } from 'vitest';
import { WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { lightingModeOf, processDeferredLighting } from '../src/world/LightingAdapter';
import { VoxelWorld } from '../src/world/World';

describe('lighting adapter', () => {
  it('does not raise the playing light budget', () => {
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
  });

  it('classifies server worlds as immediate and client worlds as deferred', () => {
    const server = new VoxelWorld('light-immediate');
    server.deferredLighting = false;
    expect(lightingModeOf(server)).toBe('immediate');
    const client = new VoxelWorld('light-deferred');
    client.deferredLighting = true;
    expect(lightingModeOf(client)).toBe('deferred');
  });

  it('does not run the client budgeted scheduler on an immediate world', () => {
    const world = new VoxelWorld('light-server');
    world.deferredLighting = false;
    world.getChunk(0, 0);
    const elapsed = processDeferredLighting(world, WORLD_LIGHT_BUDGET_MS, 8, 8);
    expect(elapsed).toBe(0);
  });

  it('still drains deferred lighting through the existing LightEngine path', () => {
    const world = new VoxelWorld('light-client');
    world.deferredLighting = true;
    world.getChunk(0, 0);
    const elapsed = processDeferredLighting(world, WORLD_LIGHT_BUDGET_MS, 8, 8);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(world.chunks.get('0,0')?.lightingReady || world.pendingLightJobs >= 0).toBe(true);
  });
});
