import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_SERVER_PRESETS } from '../../shared/config';
import { anarchyClientUrl, anarchyStatusUrl } from '../../src/net/AnarchyClient';
import { BlockId } from '../../src/blocks';
import { PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { AnarchyServer } from '../../server/AnarchyServer';
import {
  assertDistinctWorldDirectories,
  explosionsAllowed,
  loadServerConfig,
  pvpAllowed,
  worldDirectory,
  type ServerMode,
} from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-modes-'));
}

function configFor(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
      FC_NO_BUILTIN_PLUGINS: '1',
      ...env,
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
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function lookAt(
  from: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  const dx = x - from.x;
  const dy = y - (from.y + PLAYER_EYE_HEIGHT);
  const dz = z - from.z;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
  };
}

describe('server modes', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  const servers: AnarchyServer[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.stop();
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(mode?: ServerMode, worldId?: string): Promise<WorldInstance> {
    const dataDir = await tempDir();
    dirs.push(dataDir);
    const env: NodeJS.ProcessEnv = {};
    if (mode) env.SERVER_MODE = mode;
    if (worldId) env.WORLD = worldId;
    const world = new WorldInstance(configFor(dataDir, env));
    worlds.push(world);
    await world.initialize();
    return world;
  }

  function joinPlayer(world: WorldInstance, name: string) {
    const result = world.join({ sink: new MemorySink(), name });
    if ('error' in result) throw new Error(result.error);
    return result.player;
  }

  it('defaults to anarchy and rejects an unknown mode', () => {
    const config = loadServerConfig({});
    expect(config.serverMode).toBe('anarchy');
    expect(config.worldId).toBe('anarchy');
    expect(config.port).toBe(2567);
    expect(config.serverName).toBe('Frontier Cubes Anarchy');
    expect(loadServerConfig({ SERVER_MODE: '   ' }).serverMode).toBe('anarchy');
    expect(loadServerConfig({ SERVER_MODE: 'Peaceful' }).serverMode).toBe('peaceful');
    expect(loadServerConfig({ FC_SERVER_MODE: 'survival' }).serverMode).toBe('survival');
    expect(() => loadServerConfig({ SERVER_MODE: 'creative' })).toThrow(/Invalid SERVER_MODE/);
  });

  it('gives each mode its own world directory and plugin-data path', async () => {
    const dataDir = await tempDir();
    dirs.push(dataDir);
    const configs = (['anarchy', 'survival', 'peaceful'] as const).map((mode) => configFor(dataDir, {
      SERVER_MODE: mode,
      PORT: String(LOCAL_SERVER_PRESETS[mode].port),
      WORLD: LOCAL_SERVER_PRESETS[mode].worldId,
    }));
    expect(() => assertDistinctWorldDirectories(configs)).not.toThrow();
    expect(configs.map((config) => worldDirectory(config))).toEqual([
      `${dataDir}/anarchy`,
      `${dataDir}/survival`,
      `${dataDir}/peaceful`,
    ]);
    const instances = configs.map((config) => new WorldInstance(config));
    expect(instances.map((world) => world.serverMode)).toEqual(['anarchy', 'survival', 'peaceful']);
    expect(instances.map((world) => world.pluginStore.directory)).toEqual([
      join(dataDir, 'anarchy', 'plugin-data'),
      join(dataDir, 'survival', 'plugin-data'),
      join(dataDir, 'peaceful', 'plugin-data'),
    ]);
    expect(new Set(instances.map((world) => world.pluginStore.directory)).size).toBe(3);
    const collided = [
      configFor(dataDir, { SERVER_MODE: 'anarchy', WORLD: 'shared' }),
      configFor(dataDir, { SERVER_MODE: 'survival', WORLD: 'shared' }),
    ];
    expect(() => assertDistinctWorldDirectories(collided)).toThrow(/shared by/);
  });

  it('refuses a second instance that opens the same world directory', async () => {
    const dataDir = await tempDir();
    dirs.push(dataDir);
    const first = new WorldInstance(configFor(dataDir, { WORLD: 'anarchy', SERVER_MODE: 'anarchy' }));
    worlds.push(first);
    await first.initialize();
    const second = new WorldInstance(configFor(dataDir, { WORLD: 'anarchy', SERVER_MODE: 'survival' }));
    worlds.push(second);
    await expect(second.initialize()).rejects.toThrow(/already owned/);
    await first.stop();
    worlds.splice(worlds.indexOf(first), 1);
    await second.initialize();
    expect(second.serverMode).toBe('survival');
  });

  it.each([
    ['anarchy', true],
    ['survival', true],
    ['peaceful', false],
  ] as const)('%s PvP allowed=%s', async (mode, allowed) => {
    expect(pvpAllowed(mode)).toBe(allowed);
    const world = await boot(mode);
    expect(world.serverMode).toBe(mode);
    expect(world.gameplay.serverMode).toBe(mode);
    const attacker = joinPlayer(world, 'Ada');
    const victim = joinPlayer(world, 'Bob');
    const origin = attacker.controller.position;
    attacker.controller.teleport([origin.x, 100, origin.z]);
    victim.controller.teleport([origin.x, 100, origin.z + 2]);
    const aim = lookAt(
      attacker.controller.position,
      victim.controller.position.x,
      victim.controller.position.y + 0.9,
      victim.controller.position.z,
    );
    attacker.controller.yaw = aim.yaw;
    attacker.controller.pitch = aim.pitch;
    attacker.inventory.clear();
    attacker.inventory.addItem('diamond_sword', 1);
    attacker.selectedSlot = 0;
    const before = victim.survival.health;
    world.attack(attacker);
    if (allowed) expect(victim.survival.health).toBeLessThan(before);
    else expect(victim.survival.health).toBe(before);
  });

  it('peaceful still applies environmental fall damage', async () => {
    const world = await boot('peaceful');
    const player = joinPlayer(world, 'Ada');
    world.tick();
    const before = player.survival.health;
    player.controller.fallDistance = 8;
    world.tick();
    expect(player.survival.health).toBeLessThan(before);
  });

  it.each(['anarchy', 'survival', 'peaceful'] as const)('%s explosion rule', async (mode) => {
    expect(explosionsAllowed(mode)).toBe(mode === 'anarchy');
    const world = await boot(mode);
    const player = joinPlayer(world, 'Ada');
    const origin = player.controller.position;
    const y = Math.floor(origin.y);
    const z = Math.floor(origin.z);
    const kinds = [BlockId.Tnt, BlockId.TntPowerful, BlockId.TntDestructive] as const;
    for (const [index, blockId] of kinds.entries()) {
      const x = Math.floor(origin.x) + 4 + index * 16;
      world.world.setBlock(x, y, z, BlockId.Dirt);
      world.world.setBlock(x + 1, y, z, blockId);
      expect(world.gameplay.redstone.primeTnt(x + 1, y, z, 0.05)).toBeDefined();
      for (let tick = 0; tick < 4; tick += 1) world.tick();
      const neighbor = world.world.getBlock(x, y, z);
      if (mode === 'anarchy') expect(neighbor).toBe(BlockId.Air);
      else expect(neighbor).toBe(BlockId.Dirt);
      expect(world.gameplay.explosions.pendingCount).toBe(0);
    }

    const cartX = Math.floor(origin.x) + 4 + kinds.length * 16;
    world.world.setBlock(cartX, y - 1, z, BlockId.Stone);
    world.world.setBlock(cartX, y, z, BlockId.Rail);
    world.world.setBlock(cartX + 1, y, z, BlockId.Dirt);
    const cart = world.gameplay.minecarts.spawn(cartX, y, z);
    expect(cart).toBeDefined();
    expect(world.gameplay.minecarts.insertTnt(cart!, BlockId.Tnt)).toBe(true);
    expect(world.gameplay.minecarts.explodeNow(cart!)).toBe(true);
    world.tick();
    const cartNeighbor = world.world.getBlock(cartX + 1, y, z);
    if (mode === 'anarchy') expect(cartNeighbor).toBe(BlockId.Air);
    else expect(cartNeighbor).toBe(BlockId.Dirt);
  });

  it('serves the server mode on /status', async () => {
    const dataDir = await tempDir();
    dirs.push(dataDir);
    const server = new AnarchyServer(configFor(dataDir, { SERVER_MODE: 'survival' }));
    servers.push(server);
    await server.start();
    const response = await fetch(`http://127.0.0.1:${server.port}/status`);
    const status = await response.json() as {
      name: string;
      world: string;
      mode: string;
      ready: boolean;
      online: number;
      maxPlayers: number;
      tickRate: number;
    };
    expect(status).toMatchObject({
      name: 'Frontier Cubes Survival',
      world: 'survival',
      mode: 'survival',
      ready: true,
      online: 0,
      tickRate: 20,
    });
    expect(status.maxPlayers).toBeGreaterThan(0);
  });

  it('points the local client at the mode preset port', () => {
    expect(anarchyClientUrl('')).toBe('ws://127.0.0.1:2567');
    expect(anarchyClientUrl('?server=anarchy')).toBe('ws://127.0.0.1:2567');
    expect(anarchyClientUrl('?server=survival')).toBe('ws://127.0.0.1:2568');
    expect(anarchyClientUrl('?server=peaceful')).toBe('ws://127.0.0.1:2569');
    expect(anarchyStatusUrl('?server=peaceful')).toBe('http://127.0.0.1:2569/status');
    expect(anarchyClientUrl('?server=survival&anarchyPort=2700')).toBe('ws://127.0.0.1:2700');
    expect(anarchyClientUrl('?anarchyUrl=ws://example.test:9')).toBe('ws://example.test:9');
    expect(anarchyClientUrl('?server=nope')).toBe('ws://127.0.0.1:2567');
  });

  it('keeps the local launch script on the same ports and world ids', async () => {
    const script = await readFile(new URL('../../scripts/dev-server-mode.mjs', import.meta.url), 'utf8');
    expect(script).toContain("anarchy: { SERVER_MODE: 'anarchy', PORT: '2567', WORLD: 'anarchy' }");
    expect(script).toContain("survival: { SERVER_MODE: 'survival', PORT: '2568', WORLD: 'survival' }");
    expect(script).toContain("peaceful: { SERVER_MODE: 'peaceful', PORT: '2569', WORLD: 'peaceful' }");
  });
});
