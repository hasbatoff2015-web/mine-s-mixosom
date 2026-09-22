import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ItemId } from '../../src/items';
import { createItemStack } from '../../src/inventory';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-spawnpet-'));
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: false,
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
}

function resultLines(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text) lines.push(record.text);
  }
  return lines;
}

describe('/spawnpet operator command', { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot() {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Owner' });
    if ('error' in joined) throw new Error('join failed');
    joined.player.controller.teleport([20.5, 100, 20.5]);
    joined.player.controller.yaw = 0;
    for (const z of [16, 17, 18, 19, 20]) {
      world.world.setBlock(20, 99, z, BlockId.Stone);
      world.world.setBlock(20, 100, z, BlockId.Air);
      world.world.setBlock(20, 101, z, BlockId.Air);
    }
    return { world, player: joined.player, sink };
  }

  it('rejects a non-operator player', async () => {
    const { world, player, sink } = await boot();
    sink.payloads.length = 0;
    world.handleChat(player, '/spawnpet wolf');
    expect(resultLines(sink).some((line) => line.includes('You do not have permission.'))).toBe(true);
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'wolf')).toHaveLength(0);
  });

  it('spawns exactly one wild cat and one wild wolf for an operator', async () => {
    const { world, player, sink } = await boot();
    player.inventory.setSlot(0, createItemStack(ItemId.Bone, 16));
    world.permissions.op(player.name);
    world.permissions.op(player.id);
    sink.payloads.length = 0;
    world.handleChat(player, '/spawnpet cat');
    const cats = world.gameplay.mobs.entities.filter((mob) => mob.kind === 'cat');
    expect(cats).toHaveLength(1);
    expect(cats[0]?.ownerId).toBeUndefined();
    expect(cats[0]?.tameProgress).toBe(0);
    expect(cats[0]?.sitting).toBe(false);
    expect(Number.isFinite(cats[0]?.position.x)).toBe(true);
    expect(Number.isFinite(cats[0]?.position.y)).toBe(true);
    expect(Number.isFinite(cats[0]?.position.z)).toBe(true);
    expect(resultLines(sink).some((line) => line.includes('Spawned cat') && line.includes(`id=${cats[0]!.id}`))).toBe(true);

    sink.payloads.length = 0;
    world.handleChat(player, '/petspawn wolf');
    const wolves = world.gameplay.mobs.entities.filter((mob) => mob.kind === 'wolf');
    expect(wolves).toHaveLength(1);
    expect(wolves[0]?.ownerId).toBeUndefined();
    expect(wolves[0]?.tameProgress).toBe(0);
    expect(wolves[0]?.sitting).toBe(false);
    expect(resultLines(sink).some((line) => line.includes('Spawned wolf'))).toBe(true);
    expect(player.inventory.getSlot(0)?.count).toBe(16);
  });

  it('rejects an invalid kind and console use without a player position', async () => {
    const { world, player, sink } = await boot();
    world.permissions.op(player.name);
    world.permissions.op(player.id);
    sink.payloads.length = 0;
    world.handleChat(player, '/spawnpet chicken');
    expect(resultLines(sink).some((line) => line.includes('Usage: /spawnpet <wolf|cat>'))).toBe(true);
    expect(world.gameplay.mobs.entities).toHaveLength(0);
    const consoleResult = world.dispatchConsole('spawnpet wolf');
    expect(consoleResult.ok).toBe(false);
    expect(consoleResult.lines.some((line) => line.toLowerCase().includes('player'))).toBe(true);
    expect(world.gameplay.mobs.entities).toHaveLength(0);
  });
});
