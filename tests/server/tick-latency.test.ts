import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import type { ClientInputMessage } from '../../shared/protocol';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-tick-ms-'));
}

function idleInput(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input',
    seq,
    forward: 0,
    right: 0,
    jump: false,
    sneak: false,
    sprint: false,
    descend: false,
    flySprint: false,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    ...extra,
  };
}

describe('Anarchy server tick latency', { timeout: 20_000 }, () => {
  const worlds: WorldInstance[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('stays under 50ms during ordinary walk and jump ticks', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'anarchy',
        WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
      }, process.cwd()),
      dataDir: dir,
      pluginDir: join(dir, 'no-plugins'),
      port: 0,
      chunkViewRadius: 1,
      persistIntervalMs: 60_000,
    });
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    const joined = world.join({
      sink: { send() {} },
      name: 'Runner',
    });
    if ('error' in joined) throw new Error(joined.error);
    const runner = joined.player;
    const samples: number[] = [];
    const walls: number[] = [];
    for (let seq = 1; seq <= 40; seq += 1) {
      const jumping = seq === 8 || seq === 20;
      world.applyInput(runner, idleInput(seq, {
        forward: 1,
        sprint: seq > 12 && seq < 28,
        jump: jumping,
      }));
      const t0 = performance.now();
      world.tick();
      walls.push(performance.now() - t0);
      samples.push(world.lastTickMs);
    }
    const maxGameplay = Math.max(...samples);
    const maxWall = Math.max(...walls);
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    expect(runner.connected).toBe(true);
    expect(maxGameplay).toBeLessThan(50);
    expect(maxWall).toBeLessThan(50);
    expect(mean).toBeLessThan(25);
    console.log(
      `tick-latency n=${samples.length} mean=${mean.toFixed(2)} maxGameplay=${maxGameplay.toFixed(2)} maxWall=${maxWall.toFixed(2)}`,
    );
  });
});
