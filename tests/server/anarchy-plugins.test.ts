import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-anarchy-plugins-'));
}

function testConfig(dataDir: string, extra: { operators?: string[] } = {}) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
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
    operators: extra.operators ?? ['Op'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
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

describe('Anarchy builtin plugins', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function chat(world: WorldInstance, player: ReturnType<typeof join>, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return resultLines(player.sink);
  }

  it('keeps /tp coordinates and adds /tpa without replacing it', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const lines = chat(world, ada, '/tp 8 70 8');
    expect(lines.some((line) => line.includes('Teleported to 8.0, 70.0, 8.0'))).toBe(true);
    expect(world.commands.find('tp')?.usage).toBe('/tp <x> <y> <z>');
    expect(world.commands.find('tpa')).toBeDefined();
    expect(chat(world, ada, '/tpa help').some((line) => line.includes('TPA'))).toBe(true);
  });

  it('supports TPA request, deny, accept, and logout cleanup', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    expect(chat(world, ada, '/tpa').some((line) => line.includes('Usage: /tpa <player>'))).toBe(true);
    expect(chat(world, ada, '/tpa Bob').some((line) => line.includes('Asked Bob'))).toBe(true);
    expect(chat(world, bob, '/tpdeny').some((line) => line.includes('denied'))).toBe(true);
    expect(chat(world, bob, '/tpaccept').some((line) => line.includes('no teleport request'))).toBe(true);
    chat(world, ada, '/tpa Bob');
    world.disconnect(ada.player.id);
    expect(chat(world, bob, '/tpaccept').some((line) => line.includes('no teleport request'))).toBe(true);
    const ada2 = join(world, 'Ada');
    ada2.player.controller.teleport([12, 70, 12]);
    chat(world, ada2, '/tpahere Bob');
    const before = { ...bob.player.controller.position };
    expect(chat(world, bob, '/tpaccept').some((line) => line.includes('accepted'))).toBe(true);
    expect(bob.player.controller.position.x).not.toBe(before.x);
  });

  it('persists spawn, homes, back, and home limits', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    chat(world, op, '/home config set cooldownSeconds 0');
    chat(world, op, '/spawn config set cooldownSeconds 0');
    op.player.controller.teleport([20.5, 70, 21.5]);
    expect(chat(world, op, '/setspawn').some((line) => line.includes('Spawn set'))).toBe(true);
    ada.player.controller.teleport([8, 70, 8]);
    expect(chat(world, ada, '/spawn').some((line) => line.includes('Teleporting to spawn'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(20.5, 1);
    chat(world, ada, '/sethome');
    expect(chat(world, ada, '/homes')[0]).toContain('home');
    ada.player.controller.teleport([40, 70, 40]);
    chat(world, ada, '/home');
    expect(ada.player.controller.position.x).toBeCloseTo(20.5, 1);
    expect(chat(world, ada, '/home unknown').some((line) => line.includes("Home 'unknown' not found."))).toBe(true);
    chat(world, ada, '/sethome base');
    expect(chat(world, ada, '/sethome extra').some((line) => line.includes('You can only set 1 home'))).toBe(true);
    world.permissions.grant('ada', 'home.multiple');
    expect(chat(world, ada, '/sethome extra').some((line) => line.includes("Home 'extra' set"))).toBe(true);
    chat(world, ada, '/delhome extra');
    ada.player.controller.teleport([50, 70, 50]);
    chat(world, ada, '/home');
    expect(chat(world, ada, '/back').some((line) => line.includes('previous'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(50, 1);

    await world.save();
    const dir = world.config.dataDir;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = new WorldInstance(testConfig(dir));
    worlds.push(again);
    await again.initialize();
    await again.loadPlugins();
    await again.plugins.enableAll();
    expect(again.spawn[0]).toBeCloseTo(20.5, 1);
    const adaAgain = join(again, 'Ada');
    expect(chat(again, adaAgain, '/homes')[0]).toContain('home');
  });

  it('runs OP/DEOP and plugin admin commands', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const op = join(world, 'Op');
    expect(chat(world, ada, '/op Bob').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, op, '/op Ada').some((line) => line.includes('operator'))).toBe(true);
    expect(world.permissions.isOperator('Ada')).toBe(true);
    expect(chat(world, ada, '/plugins list').some((line) => line.includes('permissions'))).toBe(true);
    expect(chat(world, op, '/deop Ada').some((line) => line.includes('Removed operator'))).toBe(true);
    expect(world.permissions.isOperator('Ada')).toBe(false);
    expect(chat(world, ada, '/plugins help').some((line) => line.includes('Plugins'))).toBe(true);
  });

  it('searches RTP inside configured bounds and stays safe', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const origin = world.spawn;
    const x = Math.floor(origin[0]);
    const z = Math.floor(origin[2]);
    const y = world.world.surfaceY(x, z);
    world.world.setBlock(x, y, z, BlockId.Stone);
    world.world.setBlock(x, y + 1, z, BlockId.Air);
    world.world.setBlock(x, y + 2, z, BlockId.Air);
    chat(world, op, `/rtp config set minX ${x}`);
    chat(world, op, `/rtp config set maxX ${x}`);
    chat(world, op, `/rtp config set minZ ${z}`);
    chat(world, op, `/rtp config set maxZ ${z}`);
    chat(world, op, '/rtp config set maxAttempts 8');
    chat(world, op, '/rtp config set attemptsPerTick 4');
    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/rtp').some((line) => line.includes('Searching'))).toBe(true);
    for (let i = 0; i < 12; i += 1) world.tick();
    const pos = ada.player.controller.position;
    expect(pos.x).toBeGreaterThanOrEqual(-10_000);
    expect(pos.x).toBeLessThanOrEqual(10_000);
    expect(pos.z).toBeGreaterThanOrEqual(-10_000);
    expect(pos.z).toBeLessThanOrEqual(10_000);
    expect(world.world.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))).not.toBe(BlockId.Lava);
  });

  it('triggers an RTP portal inside water and ignores the outside', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const x = Math.floor(op.player.controller.position.x);
    const y = Math.floor(op.player.controller.position.y);
    const z = Math.floor(op.player.controller.position.z) + 4;
    world.world.setBlock(x, y, z, BlockId.Water);
    op.player.controller.teleport([x + 0.5, y, z + 0.5]);
    chat(world, op, '/rtpportal pos1');
    op.player.controller.teleport([x + 0.5, y + 2, z + 0.5]);
    chat(world, op, '/rtpportal pos2');
    expect(chat(world, op, '/rtpportal create spawnwell').some((line) => line.includes("Created RTP portal"))).toBe(true);
    expect(chat(world, op, '/rtpportal list')[0]).toContain('spawnwell');
    const ada = join(world, 'Ada');
    ada.player.controller.teleport([x + 20, y, z + 20]);
    world.events.emit('playerMove', world.events.createPlayerMove(ada.player.id, x + 20, y, z + 20));
    expect(world.rtpSessions.has(ada.player.id)).toBe(false);
    ada.player.controller.teleport([x + 0.5, y, z + 0.5]);
    world.events.emit('playerMove', world.events.createPlayerMove(ada.player.id, x + 0.5, y, z + 0.5));
    expect(world.rtpSessions.has(ada.player.id)).toBe(true);
  });

  it('enforces claim flags through cancellable events', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const x = Math.floor(ada.player.controller.position.x) + 2;
    const y = Math.floor(ada.player.controller.position.y);
    const z = Math.floor(ada.player.controller.position.z) + 2;
    ada.player.controller.teleport([x + 0.5, y, z + 0.5]);
    chat(world, ada, '/claim pos1');
    ada.player.controller.teleport([x + 2.5, y + 3, z + 2.5]);
    chat(world, ada, '/claim pos2');
    expect(chat(world, ada, '/claim create garden').some((line) => line.includes("Claim 'garden' created"))).toBe(true);
    world.world.setBlock(x, y + 1, z, BlockId.Dirt);
    world.setGameMode(bob.player, 'creative');
    bob.player.controller.teleport([x + 0.5, y, z + 0.5]);
    expect(world.tryBreak(bob.player, x, y + 1, z)).toEqual({ ok: false, reason: 'cancelled' });
    chat(world, ada, '/claim addmember Bob');
    expect(world.tryBreak(bob.player, x, y + 1, z)).toEqual({ ok: true });
    chat(world, ada, '/claim flag pvp false');
    const event = world.events.createPlayerDamage(ada.player.id, 4, 'melee', bob.player.id);
    world.events.emit('playerDamage', event);
    expect(event.cancelled).toBe(true);
    const explosion = world.events.createExplosion(x, y, z, 3, 4);
    world.events.emit('explosion', explosion);
    expect(explosion.cancelled).toBe(true);
  });

  it('creates, edits, and persists holograms with multiple lines', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    expect(chat(world, op, '/holograms create spawn').some((line) => line.includes("Created hologram"))).toBe(true);
    chat(world, op, '/holograms line add spawn Welcome');
    chat(world, op, '/holograms line set spawn 1 Spawn');
    expect(chat(world, op, '/holograms info spawn').some((line) => line.includes('Welcome'))).toBe(true);
    chat(world, op, '/holograms range spawn 24');
    await world.save();
    const dir = world.config.dataDir;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = new WorldInstance(testConfig(dir));
    worlds.push(again);
    await again.initialize();
    await again.loadPlugins();
    await again.plugins.enableAll();
    const op2 = join(again, 'Op');
    const info = chat(again, op2, '/holograms info spawn');
    expect(info.some((line) => line.includes('Range: 24'))).toBe(true);
    expect(chat(again, op2, '/holograms delete spawn').some((line) => line.includes('Deleted'))).toBe(true);
  });
});
