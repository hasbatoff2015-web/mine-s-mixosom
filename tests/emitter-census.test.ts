import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { chunkKey } from '../src/core/constants';
import {
  EMITTER_CENSUS_HOLD_MS,
  EMITTER_CENSUS_INTERVAL_MS,
  EmitterCensusScanner,
  emptyEmitterCensus,
  formatEmitterCensus,
} from '../src/debug/emitterCensus';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

function addChunk(world: VoxelWorld, x: number, z: number): Chunk {
  const chunk = new Chunk(x, z);
  chunk.generated = true;
  world.chunks.set(chunkKey(x, z), chunk);
  return chunk;
}

describe('emitter census cadence', () => {
  it('keeps the published EMIT line', () => {
    expect(formatEmitterCensus(emptyEmitterCensus(4))).toBe('EMIT scanning 0/4 (not a final count)');
    expect(formatEmitterCensus({
      ...emptyEmitterCensus(3),
      torch: 2,
      total: 2,
      scannedChunks: 3,
      loadedChunks: 3,
      passComplete: true,
    })).toBe('EMIT torch 2 lantern 0 glow 0 lava 0 fire 0 rtorch 0 furnace 0 other 0 total 2 scan 3/3');
  });

  it('resets when the world changes and does not keep the previous census', () => {
    const alpha = new VoxelWorld('census-a');
    addChunk(alpha, 0, 0).set(1, 4, 1, BlockId.Torch);
    const scanner = new EmitterCensusScanner();
    const finished = scanner.advance(alpha, 2, 0);
    expect(finished.passComplete).toBe(true);
    expect(finished.torch).toBe(1);

    const beta = new VoxelWorld('census-b');
    for (let index = 0; index < 4; index += 1) addChunk(beta, index, 0);
    addChunk(beta, 3, 0).set(0, 2, 0, BlockId.Lantern);
    const reset = scanner.advance(beta, 2, 1_000);
    expect(reset.passComplete).toBe(false);
    expect(reset.torch).toBe(0);
    expect(reset.lantern).toBe(0);
    expect(reset.scannedChunks).toBeLessThan(beta.chunks.size);
    expect(reset.total).not.toBe(finished.total);
  });

  it('does not walk chunks on every animation frame after a pass completes', () => {
    const world = new VoxelWorld('census-hold');
    for (let index = 0; index < 3; index += 1) addChunk(world, index, 0);
    addChunk(world, 0, 0).set(2, 5, 2, BlockId.Glowstone);
    const scanner = new EmitterCensusScanner();
    let now = 0;
    let view = scanner.advance(world, 1, now);
    while (!view.passComplete) {
      now += EMITTER_CENSUS_INTERVAL_MS;
      view = scanner.advance(world, 1, now);
    }
    const walks = scanner.chunkWalks;
    expect(view.glowstone).toBe(1);
    for (let frame = 1; frame <= 20; frame += 1) {
      const held = scanner.advance(world, 2, now + frame * 16);
      expect(scanner.chunkWalks).toBe(walks);
      expect(held.glowstone).toBe(1);
      expect(held.passComplete).toBe(true);
      expect(formatEmitterCensus(held)).toBe(formatEmitterCensus(view));
    }
    expect(20 * 16).toBeLessThan(EMITTER_CENSUS_HOLD_MS);
  });

  it('starts a new pass after the hold when the loaded chunk set changes', () => {
    const world = new VoxelWorld('census-refresh');
    addChunk(world, 0, 0).set(1, 3, 1, BlockId.Torch);
    const scanner = new EmitterCensusScanner();
    const finished = scanner.advance(world, 2, 0);
    expect(finished.passComplete).toBe(true);
    expect(finished.loadedChunks).toBe(1);
    const walks = scanner.chunkWalks;
    addChunk(world, 4, 4);
    for (let frame = 1; frame * 16 < EMITTER_CENSUS_HOLD_MS; frame += 1) {
      const held = scanner.advance(world, 2, frame * 16);
      expect(scanner.chunkWalks).toBe(walks);
      expect(held.loadedChunks).toBe(1);
      expect(held.passComplete).toBe(true);
    }
    const refreshed = scanner.advance(world, 2, EMITTER_CENSUS_HOLD_MS);
    expect(scanner.chunkWalks).toBeGreaterThan(walks);
    expect(refreshed.loadedChunks).toBe(2);
    expect(refreshed.passComplete).toBe(true);
    expect(refreshed.torch).toBe(1);
  });
});
