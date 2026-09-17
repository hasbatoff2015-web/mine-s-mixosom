import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { VoxelWorld } from '../../src/world/World';
import {
  RtpService,
  RtpSessionManager,
  isSafeRtpStand,
} from '../../server/services/rtp';

function options(extra: Record<string, number> = {}) {
  return {
    minX: 0,
    maxX: 3,
    minZ: 0,
    maxZ: 0,
    attemptsPerTick: 2,
    maxAttempts: 8,
    maxChunkGenerates: 1,
    ...extra,
  };
}

function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)]!;
    index += 1;
    return value;
  };
}

describe('RTP search retries', () => {
  it('continues after the first unsafe column and teleports to the next valid one', () => {
    const world = new VoxelWorld('rtp-retry');
    world.getChunk(0, 0, true);
    const y0 = world.surfaceY(0, 0);
    const y1 = world.surfaceY(1, 0);
    world.setBlock(0, y0, 0, BlockId.Lava);
    world.setBlock(0, y0 + 1, 0, BlockId.Air);
    world.setBlock(0, y0 + 2, 0, BlockId.Air);
    world.setBlock(1, y1, 0, BlockId.Stone);
    world.setBlock(1, y1 + 1, 0, BlockId.Air);
    world.setBlock(1, y1 + 2, 0, BlockId.Air);
    expect(isSafeRtpStand(world, 0, y0, 0)).toBe(false);
    expect(isSafeRtpStand(world, 1, y1, 0)).toBe(true);

    const rtp = new RtpService(world);
    const state = rtp.createSearch(options());
    rtp.step(state, options(), sequence([0, 0, 0.3, 0]));
    expect(state.found).toEqual({ x: 1.5, y: y1 + 1, z: 0.5 });
    expect(state.exhausted).toBe(false);
    expect(state.attempts).toBeGreaterThanOrEqual(2);
  });

  it('skips generate-budget holes without counting them as failed attempts', () => {
    const world = new VoxelWorld('rtp-budget');
    const rtp = new RtpService(world);
    const opts = options({ maxChunkGenerates: 1, attemptsPerTick: 4, maxAttempts: 80, minX: 0, maxX: 40, minZ: 0, maxZ: 40 });
    const state = rtp.createSearch(opts);
    rtp.step(state, opts, () => 0.01);
    expect(state.exhausted).toBe(false);
    expect(state.attempts).toBeLessThanOrEqual(4);
    expect(state.generates).toBeLessThanOrEqual(1);
  });

  it('exhausts only after the real attempt budget, never an infinite loop', () => {
    const world = new VoxelWorld('rtp-exhaust');
    world.getChunk(0, 0, true);
    const y = world.surfaceY(0, 0);
    for (let x = 0; x <= 3; x += 1) {
      world.setBlock(x, y, 0, BlockId.Lava);
      world.setBlock(x, y + 1, 0, BlockId.Air);
      world.setBlock(x, y + 2, 0, BlockId.Air);
    }
    const rtp = new RtpService(world);
    const sessions = new RtpSessionManager(rtp);
    const opts = options({ attemptsPerTick: 2, maxAttempts: 6, maxChunkGenerates: 2 });
    expect(sessions.enqueue('a', opts).ok).toBe(true);
    expect(sessions.enqueue('a', opts).ok).toBe(false);
    expect(sessions.enqueue('b', opts).ok).toBe(true);
    let ticks = 0;
    let done = 0;
    while (ticks < 20 && (sessions.has('a') || sessions.has('b'))) {
      ticks += 1;
      done += sessions.tick(() => 0.1).length;
    }
    expect(ticks).toBeLessThan(20);
    expect(sessions.has('a')).toBe(false);
    expect(sessions.has('b')).toBe(false);
    expect(done).toBe(2);
  });

  it('does not double-teleport a player who already found a location', () => {
    const world = new VoxelWorld('rtp-once');
    world.getChunk(0, 0, true);
    const y = world.surfaceY(0, 0);
    world.setBlock(0, y, 0, BlockId.Stone);
    world.setBlock(0, y + 1, 0, BlockId.Air);
    world.setBlock(0, y + 2, 0, BlockId.Air);
    const rtp = new RtpService(world);
    const sessions = new RtpSessionManager(rtp);
    const opts = options({ minX: 0, maxX: 0, attemptsPerTick: 4, maxAttempts: 4 });
    expect(sessions.enqueue('p', opts).ok).toBe(true);
    const first = sessions.tick(() => 0);
    expect(first).toHaveLength(1);
    expect(first[0]?.dest).toBeDefined();
    expect(sessions.tick(() => 0)).toHaveLength(0);
    expect(sessions.has('p')).toBe(false);
  });
});
