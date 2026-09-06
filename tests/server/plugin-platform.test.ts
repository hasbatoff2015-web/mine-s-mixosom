import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig } from '../../server/config';
import { PRE_CANCELLABLE_EVENTS, POST_OBSERVATION_EVENTS } from '../../server/events';
import { PLUGIN_API_VERSION, type Plugin } from '../../server/PluginManager';
import { WorldInstance } from '../../server/WorldInstance';
import { createItemStack } from '../../src/inventory';

const REPO_ROOT = pathJoin(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_PLUGINS = pathJoin(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugins');
const REPO_PLUGINS = pathJoin(REPO_ROOT, 'server/plugins');
const EXAMPLE_PLUGINS = pathJoin(REPO_ROOT, 'server/plugin-examples');

async function tempDir(): Promise<string> {
  return mkdtemp(pathJoin(tmpdir(), 'fc-plugins-'));
}

function testConfig(dataDir: string, pluginDir = pathJoin(dataDir, 'no-plugins')) {
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
    pluginDir,
    loadExamplePlugin: false,
    loadBuiltinPlugins: false,
  };
}

function lookAt(
  from: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  const dx = x + 0.5 - from.x;
  const dy = y + 0.5 - (from.y + PLAYER_EYE_HEIGHT);
  const dz = z + 0.5 - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

describe('Phase 8 plugin platform', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  const servers: AnarchyServer[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    for (const server of servers.splice(0)) await server.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function bootWorld(pluginDir?: string): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir, pluginDir));
    worlds.push(world);
    await world.initialize();
    return world;
  }

  function join(world: WorldInstance, name = 'Sim') {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  it('defaults production discovery to cwd/server/plugins and does not auto-load /hello', () => {
    const config = loadServerConfig({ HOST: '127.0.0.1', PORT: '0' }, REPO_ROOT);
    expect(config.pluginDir).toBe(`${REPO_ROOT}/server/plugins`);
    expect(config.loadExamplePlugin).toBe(false);
    expect(loadServerConfig({ FC_EXAMPLE_PLUGIN: '1' }, REPO_ROOT).loadExamplePlugin).toBe(true);
  });

  it('does not register /hello from the stock repo plugin directory', async () => {
    const world = await bootWorld(REPO_PLUGINS);
    await world.loadPlugins();
    await world.plugins.enableAll();
    expect(world.plugins.list()).toEqual([]);
    expect(world.commands.find('hello')).toBeUndefined();
    const joined = join(world, 'Ada');
    world.handleChat(joined.player, '/hello');
    expect(joined.sink.payloads.some((payload) => String((payload as { text?: string }).text ?? '').includes("Unknown command 'hello'"))).toBe(true);
  });

  it('registers /hello when discovering server/plugin-examples', async () => {
    const world = await bootWorld(EXAMPLE_PLUGINS);
    await world.loadPlugins();
    await world.plugins.enableAll();
    expect(world.plugins.phaseOf('example')).toBe('enabled');
    expect(world.commands.find('hello')).toBeDefined();
    const joined = join(world, 'Ada');
    world.handleChat(joined.player, '/hello');
    expect(joined.sink.payloads.some((payload) => (payload as { text?: string }).text === 'Hello, Ada')).toBe(true);
  });

  it('registers /hello via FC_EXAMPLE_PLUGIN without copying or scanning fixtures', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance({
      ...testConfig(dir, pathJoin(dir, 'empty-plugins')),
      loadExamplePlugin: true,
    });
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    expect(world.plugins.phaseOf('example')).toBe('enabled');
    expect(world.commands.find('hello')).toBeDefined();
    const joined = join(world, 'Ada');
    world.handleChat(joined.player, '/hello');
    expect(joined.sink.payloads.some((payload) => (payload as { text?: string }).text === 'Hello, Ada')).toBe(true);
  });

  it('starts without plugins and keeps 20 TPS tick order', async () => {
    const world = await bootWorld();
    await world.loadPlugins();
    await world.plugins.enableAll();
    expect(world.plugins.list()).toEqual([]);
    for (let i = 0; i < 20; i += 1) world.tick();
    expect(world.tickNumber).toBe(20);
  });

  it('runs onLoad / onEnable / onDisable exactly once and cleans up', async () => {
    const world = await bootWorld();
    const counts = { load: 0, enable: 0, disable: 0 };
    const plugin: Plugin = {
      name: 'lifecycle',
      onLoad() { counts.load += 1; },
      onEnable(api) {
        counts.enable += 1;
        api.registerCommand({
          name: 'once',
          usage: '/once',
          description: 'once',
          execute: () => ({ ok: true, lines: ['ok'] }),
        });
      },
      onDisable() { counts.disable += 1; },
    };
    world.plugins.register(plugin);
    await world.plugins.enableAll();
    await world.plugins.enableAll();
    expect(counts).toEqual({ load: 1, enable: 1, disable: 0 });
    const joined = join(world);
    world.handleChat(joined.player, '/once');
    expect(world.commands.find('once')).toBeDefined();
    await world.plugins.disable('lifecycle');
    expect(counts.disable).toBe(1);
    expect(world.commands.find('once')).toBeUndefined();
    await world.plugins.enableAll();
    expect(counts.enable).toBe(1);
  });

  it('isolates a throwing plugin and still enables others', async () => {
    const world = await bootWorld();
    const good: Plugin = {
      name: 'good',
      onEnable(api) {
        api.registerCommand({
          name: 'okcmd',
          usage: '/okcmd',
          description: 'ok',
          execute: () => ({ ok: true, lines: ['ok'] }),
        });
      },
    };
    const bad: Plugin = {
      name: 'bad',
      onEnable() { throw new Error('bad enable'); },
    };
    world.plugins.register(good);
    world.plugins.register(bad);
    await world.plugins.enableAll();
    expect(world.plugins.phaseOf('good')).toBe('enabled');
    expect(world.plugins.phaseOf('bad')).toBe('failed');
    expect(world.commands.find('okcmd')).toBeDefined();
    const joined = join(world);
    world.handleChat(joined.player, '/okcmd');
    const chat = joined.sink.payloads.filter((payload) => (payload as { type?: string }).type === 'chat');
    expect(chat.some((payload) => (payload as { text?: string }).text === 'ok')).toBe(true);
  });

  it('catches event handler throws and keeps dispatching', async () => {
    const world = await bootWorld();
    const seen: string[] = [];
    world.plugins.register({
      name: 'throws',
      onEnable(api) {
        api.registerEvent('playerJoin', () => {
          throw new Error('join boom');
        });
      },
    });
    world.plugins.register({
      name: 'observer',
      onEnable(api) {
        api.registerEvent('playerJoin', (event) => { seen.push(event.name); });
      },
    });
    await world.plugins.enableAll();
    join(world, 'A');
    expect(seen).toEqual(['A']);
  });

  it('registers plugin commands, respects operator permission, and unregisters on disable', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance({ ...testConfig(dir), operators: ['Op'] });
    worlds.push(world);
    await world.initialize();
    world.plugins.register({
      name: 'cmds',
      onEnable(api) {
        api.registerCommand({
          name: 'hello',
          usage: '/hello',
          description: 'hello',
          execute: () => ({ ok: true, lines: ['Hello'] }),
        });
        api.registerCommand({
          name: 'oponly',
          usage: '/oponly',
          description: 'op',
          permission: 'operator',
          execute: () => ({ ok: true, lines: ['secret'] }),
        });
      },
    });
    await world.plugins.enableAll();
    const player = join(world, 'Player');
    world.handleChat(player.player, '/hello');
    expect(player.sink.payloads.some((payload) => (payload as { text?: string }).text === 'Hello')).toBe(true);
    world.handleChat(player.player, '/oponly');
    expect(player.sink.payloads.some((payload) => (payload as { text?: string }).text === 'You do not have permission.')).toBe(true);
    const op = join(world, 'Op');
    world.handleChat(op.player, '/oponly');
    expect(op.sink.payloads.some((payload) => (payload as { text?: string }).text === 'secret')).toBe(true);
    await world.plugins.disable('cmds');
    expect(world.commands.find('hello')).toBeUndefined();
    expect(world.commands.find('oponly')).toBeUndefined();
  });

  it('cancels break, place, command, damage, pickup, and interact before mutation', async () => {
    const world = await bootWorld();
    world.plugins.register({
      name: 'deny',
      onEnable(api) {
        api.registerEvent('blockBreak', (event) => event.cancel());
        api.registerEvent('blockPlace', (event) => event.cancel());
        api.registerEvent('playerCommand', (event) => {
          if (event.command.startsWith('/seed')) event.cancel();
        });
        api.registerEvent('playerDamage', (event) => event.cancel());
        api.registerEvent('itemPickup', (event) => event.cancel());
        api.registerEvent('playerInteract', (event) => event.cancel());
      },
    });
    await world.plugins.enableAll();
    const joined = join(world);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    const x = Math.floor(player.controller.position.x);
    const y = Math.floor(player.controller.position.y) + 2;
    const z = Math.floor(player.controller.position.z) + 2;
    if (world.world.getBlock(x, y, z) !== BlockId.Air) world.world.setBlock(x, y, z, BlockId.Air);
    const look = lookAt(player.controller.position, x, y, z);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z, BlockId.Dirt)).toEqual({ ok: false, reason: 'cancelled' });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);

    world.world.setBlock(x, y, z, BlockId.Dirt);
    player.miningTarget = { x, y, z };
    player.miningProgress = 1;
    expect(world.tryBreak(player, x, y, z)).toEqual({ ok: false, reason: 'cancelled' });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Dirt);

    world.handleChat(player, '/seed');
    expect(joined.sink.payloads.some((payload) => (payload as { lines?: string[] }).lines?.includes('Command cancelled.'))).toBe(true);

    world.setGameMode(player, 'survival');
    const health = player.survival.health;
    const accepted = (world.gameplay as unknown as {
      hurtPlayer: (victim: typeof player, amount: number, cause: 'melee', from: { x: number; y: number; z: number }) => boolean;
    }).hurtPlayer(player, 8, 'melee', player.controller.position);
    expect(accepted).toBe(false);
    expect(player.survival.health).toBe(health);

    player.inventory.clear();
    world.gameplay.drops.spawn(createItemStack('dirt', 8), player.controller.position);
    world.pickup(player);
    expect(player.inventory.has('dirt', 1)).toBe(false);

    world.world.setBlock(x, y, z, BlockId.Chest);
    world.interact(player);
    expect(player.window.kind).toBe('inventory');
  });

  it('emits post-break after a successful mutation', async () => {
    const world = await bootWorld();
    const posts: Array<{ x: number; y: number; z: number }> = [];
    world.plugins.register({
      name: 'post',
      onEnable(api) {
        api.registerEvent('blockBroken', (event) => posts.push({ x: event.x, y: event.y, z: event.z }));
      },
    });
    await world.plugins.enableAll();
    const joined = join(world);
    world.setGameMode(joined.player, 'creative');
    const x = Math.floor(joined.player.controller.position.x);
    const y = Math.floor(joined.player.controller.position.y) + 2;
    const z = Math.floor(joined.player.controller.position.z) + 2;
    if (world.world.getBlock(x, y, z) !== BlockId.Air) world.world.setBlock(x, y, z, BlockId.Air);
    const look = lookAt(joined.player.controller.position, x, y, z);
    joined.player.controller.yaw = look.yaw;
    joined.player.controller.pitch = look.pitch;
    expect(world.tryPlace(joined.player, x, y, z, BlockId.Stone)).toEqual({ ok: true });
    expect(world.tryBreak(joined.player, x, y, z)).toEqual({ ok: true });
    expect(posts).toEqual([{ x, y, z }]);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
  });

  it('lets two plugins share an event and isolates disable', async () => {
    const world = await bootWorld();
    const aHits: string[] = [];
    const bHits: string[] = [];
    world.plugins.register({
      name: 'A',
      onEnable(api) {
        api.registerEvent('playerJoin', (event) => aHits.push(event.name));
      },
    });
    world.plugins.register({
      name: 'B',
      onEnable(api) {
        api.registerEvent('playerJoin', (event) => bHits.push(event.name));
      },
    });
    await world.plugins.enableAll();
    join(world, 'One');
    expect(aHits).toEqual(['One']);
    expect(bHits).toEqual(['One']);
    await world.plugins.disable('A');
    join(world, 'Two');
    expect(aHits).toEqual(['One']);
    expect(bHits).toEqual(['One', 'Two']);
    await world.plugins.disable('B');
    join(world, 'Three');
    expect(bHits).toEqual(['One', 'Two']);
    expect(world.events.listenerCount('playerJoin')).toBe(0);
  });

  it('reloads a plugin through disable, cleanup, load, and enable', async () => {
    const world = await bootWorld();
    const counts = { load: 0, enable: 0, disable: 0 };
    world.plugins.register({
      name: 'reloadable',
      onLoad() { counts.load += 1; },
      onEnable(api) {
        counts.enable += 1;
        api.registerCommand({
          name: 'pingreload',
          usage: '/pingreload',
          description: 'ping',
          execute: () => ({ ok: true, lines: ['pong'] }),
        });
      },
      onDisable() { counts.disable += 1; },
    });
    await world.plugins.enableAll();
    expect(world.commands.find('pingreload')).toBeDefined();
    const reloaded = await world.plugins.reload('reloadable');
    expect(reloaded.ok).toBe(true);
    expect(counts).toEqual({ load: 2, enable: 2, disable: 1 });
    expect(world.commands.find('pingreload')).toBeDefined();
    expect(world.plugins.phaseOf('reloadable')).toBe('enabled');
  });

  it('cancels scheduled tasks when the plugin disables', async () => {
    const world = await bootWorld();
    let ticks = 0;
    world.plugins.register({
      name: 'timer',
      onEnable(api) {
        api.scheduleRepeating(10, () => { ticks += 1; });
      },
    });
    await world.plugins.enableAll();
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(ticks).toBeGreaterThan(0);
    const frozen = ticks;
    await world.plugins.disable('timer');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ticks).toBe(frozen);
  });

  it('loads fixture plugins, skips invalid modules, and keeps /hello until disable', async () => {
    const world = await bootWorld(FIXTURE_PLUGINS);
    await world.loadPlugins();
    await world.plugins.enableAll();
    expect(world.plugins.phaseOf('example')).toBe('enabled');
    expect(world.plugins.phaseOf('broken-enable')).toBe('failed');
    expect(world.commands.find('hello')).toBeDefined();
    const joined = join(world, 'Ada');
    world.handleChat(joined.player, '/hello');
    expect(joined.sink.payloads.some((payload) => (payload as { text?: string }).text === 'Hello, Ada')).toBe(true);
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    expect(world.commands.find('hello')).toBeUndefined();
  });

  it('does not leak player sockets or tokens through PlayerView', async () => {
    const world = await bootWorld();
    await world.plugins.enableAll();
    join(world, 'Eve');
    world.plugins.register({
      name: 'inspect-now',
      onEnable(api) {
        const player = api.getPlayer('Eve');
        expect(player).toBeDefined();
        expect(player!.name).toBe('Eve');
        expect((player as unknown as { sessionToken?: unknown }).sessionToken).toBeUndefined();
        expect((player as unknown as { sink?: unknown }).sink).toBeUndefined();
        expect((player as unknown as { lastInput?: unknown }).lastInput).toBeUndefined();
        expect(player!.teleport).toBeTypeOf('function');
        expect(api.getStatus().pluginApiVersion).toBe(PLUGIN_API_VERSION);
      },
    });
    await world.plugins.whenReady();
  });

  it('AnarchyServer starts with a valid plugin and with one broken plugin', async () => {
    const empty = await tempDir();
    dirs.push(empty);
    const first = new AnarchyServer(testConfig(empty, pathJoin(empty, 'missing-plugins')));
    servers.push(first);
    await first.start();
    expect(first.world.plugins.list()).toEqual([]);
    await first.stop();
    servers.pop();

    const withFixtures = await tempDir();
    dirs.push(withFixtures);
    const second = new AnarchyServer(testConfig(withFixtures, FIXTURE_PLUGINS));
    servers.push(second);
    await second.start();
    expect(second.world.plugins.phaseOf('example')).toBe('enabled');
    expect(second.world.plugins.phaseOf('broken-enable')).toBe('failed');
    expect(second.world.readyState).toBe('READY');
  });

  it('plugin API version is independent of protocol/world schema', () => {
    expect(PLUGIN_API_VERSION).toBe(1);
    expect(PRE_CANCELLABLE_EVENTS).toContain('blockBreak');
    expect(POST_OBSERVATION_EVENTS).toContain('blockBroken');
    expect(POST_OBSERVATION_EVENTS).toContain('craft');
  });

  it('refuses an incompatible plugin API version', async () => {
    const world = await bootWorld();
    world.plugins.register({
      name: 'future',
      apiVersion: 99,
      onEnable() { throw new Error('should not enable'); },
    });
    await world.plugins.enableAll();
    expect(world.plugins.phaseOf('future')).toBe('failed');
  });
});
