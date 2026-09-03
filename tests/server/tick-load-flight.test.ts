import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { chunkKey } from '../../src/core/constants';
import { VoxelWorld } from '../../src/world/World';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-tick-load-'));
}

function fillModifications(world: VoxelWorld, chunks: number, blocksPerChunk: number): void {
  for (let i = 0; i < chunks; i += 1) {
    const cx = i;
    const cz = 0;
    const key = chunkKey(cx, cz);
    const delta = new Map<number, BlockId>();
    for (let n = 0; n < blocksPerChunk; n += 1) delta.set(n, BlockId.Stone);
    world.modifications.set(key, delta);
  }
}

describe('server tick load vs streamed chunks', { timeout: 20_000 }, () => {
  const worlds: WorldInstance[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('serializeModifications of a large world is much slower than one chunk', () => {
    const world = new VoxelWorld('load-test');
    fillModifications(world, 200, 64);
    const allStart = performance.now();
    const all = world.serializeModifications();
    const allMs = performance.now() - allStart;
    const oneStart = performance.now();
    const one = world.serializeChunkModifications(0, 0);
    const oneMs = performance.now() - oneStart;
    expect(Object.keys(all).length).toBe(200);
    expect(Object.keys(one).length).toBe(64);
    expect(oneMs).toBeLessThanOrEqual(allMs + 1);
  });

  it('setView into new columns stays cheap even with a large modification map', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const instance = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'anarchy',
        WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '4',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
      }, process.cwd()),
      dataDir: dir,
      pluginDir: join(dir, 'no-plugins'),
      port: 0,
      chunkViewRadius: 4,
      persistIntervalMs: 60_000,
    });
    worlds.push(instance);
    await instance.initialize();
    fillModifications(instance.world, 180, 80);
    const joined = instance.join({ sink: { send() {} }, name: 'Flyer' });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    instance.setView(player, 0, 0, 4);
    const samples: number[] = [];
    for (let cx = 1; cx <= 12; cx += 1) {
      const t0 = performance.now();
      instance.setView(player, cx, 0, 4);
      instance.tick();
      samples.push(performance.now() - t0);
    }
    const maxMs = Math.max(...samples);
    const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    expect(maxMs).toBeLessThan(80);
    expect(meanMs).toBeLessThan(50);
  });

  it('welcome restore of a large modification map is timed and remains a map fill', () => {
    const source = new VoxelWorld('restore-src');
    fillModifications(source, 120, 40);
    const packed = source.serializeModifications();
    const target = new VoxelWorld('restore-dst');
    const t0 = performance.now();
    target.restore({ timeOfDay: 1000, modifications: packed, chests: {}, furnaces: {}, blockStates: {} });
    const restoreMs = performance.now() - t0;
    expect(target.modifications.size).toBe(120);
    expect(restoreMs).toBeLessThan(250);
  });
});
