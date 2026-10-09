import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { MEGA_ZOMBIE_SPAWN_TEXT } from '../../src/entities/megaZombie';

const dirs: string[] = [];
const worlds: WorldInstance[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.stop();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function testConfig(dataDir: string) {
  return {
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
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Op'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: Array<{ type?: string; text?: string; ok?: boolean; lines?: string[] }> = [];
  send(payload: unknown): void {
    this.payloads.push(payload as { type?: string; text?: string; ok?: boolean; lines?: string[] });
  }
}

async function boot(dataDir: string): Promise<WorldInstance> {
  const world = new WorldInstance(testConfig(dataDir));
  worlds.push(world);
  await world.initialize();
  await world.loadPlugins();
  await world.plugins.enableAll();
  return world;
}

describe('mega zombie world integration', () => {
  it('configures the arena, spawns one boss, and does not restore it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-mega-world-'));
    dirs.push(dir);
    const world = await boot(dir);
    expect(world.plugins.phaseOf('mega-zombie')).toBe('enabled');
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Op' });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    player.controller.position.set(8, 80, 8);
    world.handleChat(player, '/boss setspawn');
    player.controller.position.set(2, 70, 2);
    world.handleChat(player, '/boss setpos1');
    player.controller.position.set(18, 90, 18);
    world.handleChat(player, '/boss setpos2');
    world.handleChat(player, '/boss info');
    world.handleChat(player, '/boss spawn');
    const bosses = world.gameplay.mobs.entities.filter((mob) => mob.kind === 'mega_zombie');
    expect(bosses).toHaveLength(1);
    expect(bosses[0]?.health).toBe(3000);
    world.handleChat(player, '/boss spawn');
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'mega_zombie')).toHaveLength(1);
    world.tick();
    const lines = sink.payloads.flatMap((payload) => payload.lines ?? []);
    const texts = sink.payloads.map((payload) => payload.text ?? '');
    expect(texts.some((text) => text.includes(MEGA_ZOMBIE_SPAWN_TEXT)) || lines.some((line) => line.includes('Мега-зомби'))).toBe(true);
    expect(lines.some((line) => line.startsWith('AABB:'))).toBe(true);
    const denied = new MemorySink();
    const guest = world.join({ sink: denied, name: 'Ada' });
    if ('error' in guest) throw new Error(guest.error);
    world.handleChat(guest.player, '/boss spawn');
    expect(denied.payloads.some((payload) => payload.ok === false)).toBe(true);

    await world.stop();
    worlds.splice(0, worlds.length);
    const restarted = await boot(dir);
    expect(restarted.gameplay.mobs.entities.some((mob) => mob.kind === 'mega_zombie')).toBe(false);
    expect(restarted.megaZombie.persisted.spawn?.x).toBeCloseTo(8, 1);
    expect(restarted.megaZombie.arena()?.minY).toBeCloseTo(70, 1);
    expect(restarted.megaZombie.arena()?.maxY).toBeGreaterThan(restarted.megaZombie.arena()?.minY ?? 0);
    expect(restarted.plugins.list().filter((entry) => entry.name === 'mega-zombie')).toHaveLength(1);
  }, 60_000);
});
