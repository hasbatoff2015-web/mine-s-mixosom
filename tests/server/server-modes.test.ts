import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_SERVER_PRESETS } from '../../shared/config';
import { anarchyClientUrl, anarchyStatusUrl, clientUrlForServer, statusUrlForServer } from '../../src/net/AnarchyClient';
import { BlockId } from '../../src/blocks';
import { PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { Vec3 } from '../../src/math/vec3';
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

  async function boot(mode?: ServerMode, worldId?: string, plugins = false): Promise<WorldInstance> {
    const dataDir = await tempDir();
    dirs.push(dataDir);
    const env: NodeJS.ProcessEnv = {};
    if (mode) env.SERVER_MODE = mode;
    if (worldId) env.WORLD = worldId;
    const world = new WorldInstance({
      ...configFor(dataDir, env),
      ...(plugins ? { loadBuiltinPlugins: true } : {}),
    });
    worlds.push(world);
    await world.initialize();
    if (plugins) {
      await world.loadPlugins();
      await world.plugins.enableAll();
    }
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
    // worldDirectory keeps the on-disk contract dataDir/<worldId> and normalizes
    // separators. mkdtemp on Windows returns backslashes, so compare the same form.
    const root = dataDir.replaceAll('\\', '/');
    expect(configs.map((config) => worldDirectory(config))).toEqual([
      `${root}/anarchy`,
      `${root}/survival`,
      `${root}/peaceful`,
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
      world.world.setBlock(x + 2, y, z, blockId);
      const primed = world.gameplay.redstone.primeTnt(x + 1, y, z, 0.05);
      if (mode === 'anarchy') {
        expect(primed).toBeDefined();
        for (let tick = 0; tick < 4; tick += 1) world.tick();
        expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
        expect(world.world.getBlock(x + 2, y, z)).toBe(BlockId.Air);
      } else {
        expect(primed).toBeUndefined();
        for (let tick = 0; tick < 4; tick += 1) world.tick();
        expect(world.world.getBlock(x, y, z)).toBe(BlockId.Dirt);
        expect(world.world.getBlock(x + 1, y, z)).toBe(blockId);
        expect(world.world.getBlock(x + 2, y, z)).toBe(blockId);
      }
      expect(world.gameplay.explosions.pendingCount).toBe(0);
    }

    const redstoneX = Math.floor(origin.x) + 4 + kinds.length * 16;
    world.world.setBlock(redstoneX, y, z, BlockId.Tnt);
    world.world.setBlock(redstoneX + 1, y, z, BlockId.RedstoneTorch);
    world.gameplay.redstone.notifyBlockChanged(redstoneX + 1, y, z);
    world.gameplay.redstone.flushPropagation();
    expect(world.world.getBlock(redstoneX, y, z)).toBe(mode === 'anarchy' ? BlockId.Air : BlockId.Tnt);

    const cartX = redstoneX + 16;
    world.world.setBlock(cartX, y - 1, z, BlockId.Stone);
    world.world.setBlock(cartX, y, z, BlockId.Rail);
    world.world.setBlock(cartX + 1, y, z, BlockId.Dirt);
    const cart = world.gameplay.minecarts.spawn(cartX, y, z);
    expect(cart).toBeDefined();
    expect(world.gameplay.minecarts.insertTnt(cart!, BlockId.Tnt)).toBe(true);
    const healthBeforeBlast = player.survival.health;
    if (mode === 'anarchy') {
      expect(world.gameplay.minecarts.explodeNow(cart!)).toBe(true);
      world.tick();
      expect(world.world.getBlock(cartX + 1, y, z)).toBe(BlockId.Air);
    } else {
      expect(world.gameplay.minecarts.explodeNow(cart!)).toBe(false);
      expect(world.gameplay.minecarts.primeTnt(cart!)).toBe(false);
      world.tick();
      expect(world.world.getBlock(cartX + 1, y, z)).toBe(BlockId.Dirt);
      expect(world.gameplay.minecarts.get(cart!.id)?.variant).toBe('tnt');
      expect(player.survival.health).toBe(healthBeforeBlast);
    }
  });

  it.each(['anarchy', 'survival', 'peaceful'] as const)('%s creeper does not waste itself when blasts are off', async (mode) => {
    const world = await boot(mode);
    const player = joinPlayer(world, 'Ada');
    const origin = player.controller.position;
    const x = Math.floor(origin.x) + 6;
    const y = Math.floor(origin.y);
    const z = Math.floor(origin.z);
    world.world.setBlock(x, y - 1, z, BlockId.Stone);
    world.world.setBlock(x + 1, y, z, BlockId.Dirt);
    player.controller.teleport([x + 0.2, origin.y, z + 0.2]);
    const creeper = world.gameplay.mobs.spawn('creeper', new Vec3(x + 0.5, y, z + 0.5), { force: true });
    expect(creeper).toBeDefined();
    const before = player.survival.health;
    for (let tick = 0; tick < 40; tick += 1) world.tick();
    const stillThere = world.gameplay.mobs.get(creeper!.id);
    if (mode === 'anarchy') {
      expect(stillThere?.alive).not.toBe(true);
      expect(world.world.getBlock(x + 1, y, z)).toBe(BlockId.Air);
    } else {
      expect(stillThere?.alive).toBe(true);
      expect(stillThere?.fuseSeconds ?? 0).toBe(0);
      expect(world.world.getBlock(x + 1, y, z)).toBe(BlockId.Dirt);
      expect(player.survival.health).toBe(before);
    }
  });

  it('puts a primed TNT block back when the mode forbids explosions', async () => {
    const world = await boot('anarchy');
    const player = joinPlayer(world, 'Ada');
    const origin = player.controller.position;
    const x = Math.floor(origin.x) + 4;
    const y = Math.floor(origin.y);
    const z = Math.floor(origin.z);
    world.world.setBlock(x, y, z, BlockId.Tnt);
    expect(world.gameplay.redstone.primeTnt(x, y, z, 5)).toBeDefined();
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    world.gameplay.serverMode = 'survival';
    world.tick();
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Tnt);
    expect(world.gameplay.redstone.primedTntCount).toBe(0);
  });

  function regionClaims(world: WorldInstance, x: number, z: number) {
    world.pluginStore.save('claims/claims', {
      claims: [
        {
          id: 'spawn',
          name: 'spawn',
          owner: '11111111-1111-4111-8111-111111111111',
          worldId: world.worldId,
          volume: { minX: x, minY: 90, minZ: z, maxX: x + 4, maxY: 110, maxZ: z + 8 },
          members: [],
          priority: 0,
          flags: { pvp: false, 'player-damage': true },
        },
        {
          id: 'arena',
          name: 'arena',
          owner: '11111111-1111-4111-8111-111111111111',
          worldId: world.worldId,
          volume: { minX: x, minY: 90, minZ: z, maxX: x + 4, maxY: 110, maxZ: z + 4 },
          members: [],
          priority: 10,
          flags: { pvp: true, 'player-damage': true },
        },
      ],
    });
  }

  function melee(world: WorldInstance, attackerName: string, victimName: string) {
    const attacker = joinPlayer(world, attackerName);
    const victim = joinPlayer(world, victimName);
    return { attacker, victim };
  }

  function swing(world: WorldInstance, attacker: ReturnType<typeof joinPlayer>, victim: ReturnType<typeof joinPlayer>) {
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
    const diag = world.gameplay.attack(attacker, [attacker, victim]);
    return { damaged: victim.survival.health < before, result: diag.result };
  }

  it.each(['anarchy', 'survival', 'peaceful'] as const)('%s arena, spawn and wilderness strikes', async (mode) => {
    const world = await boot(mode, undefined, true);
    const { attacker, victim } = melee(world, 'Ada', 'Bob');
    const x = Math.floor(attacker.controller.position.x) + 30;
    const z = Math.floor(attacker.controller.position.z) + 30;
    regionClaims(world, x, z);
    for (let dx = 0; dx <= 8; dx += 1) {
      for (let dz = 0; dz <= 8; dz += 1) {
        world.world.setBlock(x + dx, 99, z + dz, BlockId.Stone);
        for (let dy = 100; dy <= 103; dy += 1) world.world.setBlock(x + dx, dy, z + dz, BlockId.Air);
      }
    }
    attacker.controller.teleport([x + 0.5, 100, z + 0.5]);
    victim.controller.teleport([x + 0.5, 100, z + 2.5]);
    expect(swing(world, attacker, victim).damaged).toBe(true);
    for (let tick = 0; tick < 12; tick += 1) world.tick();

    attacker.controller.teleport([x + 2.5, 100, z + 6.5]);
    victim.controller.teleport([x + 2.5, 100, z + 4.2]);
    expect(swing(world, attacker, victim).result).toBe('blocked');
    for (let tick = 0; tick < 12; tick += 1) world.tick();

    attacker.controller.teleport([x + 6.6, 100, z + 2.5]);
    victim.controller.teleport([x + 4.2, 100, z + 2.5]);
    const outsideHit = swing(world, attacker, victim);
    expect(outsideHit.result).toBe(mode === 'peaceful' ? 'blocked' : 'hit');
  });

  it('peaceful arrows and owned wolves follow the same arena gate', async () => {
    const world = await boot('peaceful', undefined, true);
    const attacker = joinPlayer(world, 'Ada');
    const victim = joinPlayer(world, 'Bob');
    const x = Math.floor(attacker.controller.position.x) + 30;
    const z = Math.floor(attacker.controller.position.z) + 30;
    regionClaims(world, x, z);
    for (let dx = 0; dx <= 8; dx += 1) {
      for (let dz = 0; dz <= 10; dz += 1) world.world.setBlock(x + dx, 99, z + dz, BlockId.Stone);
    }
    attacker.controller.teleport([x + 0.5, 100, z + 0.5]);
    victim.controller.teleport([x + 0.5, 100, z + 2.5]);

    const shoot = () => {
      const target = new Vec3(
        victim.controller.position.x,
        victim.controller.position.y + 0.9,
        victim.controller.position.z,
      );
      const eye = attacker.controller.eyePosition();
      const direction = target.clone().sub(eye).normalize();
      eye.addScaledVector(direction, 0.35);
      world.gameplay.arrows.spawn(eye, direction, 8, 6, false, false, undefined, attacker.id, 0);
      const before = victim.survival.health;
      for (let tick = 0; tick < 15; tick += 1) world.tick();
      return victim.survival.health < before;
    };
    expect(shoot()).toBe(true);

    attacker.controller.teleport([x + 6.6, 100, z + 2.5]);
    victim.controller.teleport([x + 4.2, 100, z + 2.5]);
    victim.survival.heal(20);
    for (let tick = 0; tick < 20; tick += 1) world.tick();
    const outsideArrow = victim.survival.health;
    expect(shoot()).toBe(false);
    expect(victim.survival.health).toBe(outsideArrow);

    attacker.controller.teleport([x + 0.5, 100, z + 0.5]);
    victim.controller.teleport([x + 0.5, 100, z + 1.2]);
    const wolf = world.gameplay.mobs.spawn(
      'wolf',
      new Vec3(x + 0.5, 100, z + 0.9),
      { ownerId: attacker.id, force: true },
    );
    expect(wolf).toBeDefined();
    world.gameplay.mobs.assignOwnedWolfTarget(attacker.id, victim.id, 'player', 'assist');
    const beforeWolf = victim.survival.health;
    for (let tick = 0; tick < 8; tick += 1) world.tick();
    expect(victim.survival.health).toBeLessThan(beforeWolf);

    victim.controller.teleport([x + 4.2, 100, z + 2.5]);
    attacker.controller.teleport([x + 6.6, 100, z + 2.5]);
    wolf!.position.set(x + 4.5, 100, z + 2.5);
    world.gameplay.mobs.assignOwnedWolfTarget(attacker.id, victim.id, 'player', 'assist');
    const wildHealth = victim.survival.health;
    for (let tick = 0; tick < 8; tick += 1) world.tick();
    expect(victim.survival.health).toBeGreaterThanOrEqual(wildHealth);
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
    expect(clientUrlForServer('survival', '?server=anarchy')).toBe('ws://127.0.0.1:2568');
    expect(clientUrlForServer('peaceful', '?server=survival')).toBe('ws://127.0.0.1:2569');
    expect(statusUrlForServer('peaceful', '')).toBe('http://127.0.0.1:2569/status');
    expect(anarchyClientUrl('?server=survival')).toBe('ws://127.0.0.1:2567');
    expect(anarchyStatusUrl('?server=peaceful')).toBe('http://127.0.0.1:2567/status');
    expect(clientUrlForServer('survival', '?server=survival&anarchyPort=2700')).toBe('ws://127.0.0.1:2700');
    expect(anarchyClientUrl('?server=survival&anarchyPort=2700')).toBe('ws://127.0.0.1:2567');
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
