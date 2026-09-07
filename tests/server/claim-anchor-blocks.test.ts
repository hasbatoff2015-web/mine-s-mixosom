import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { MAX_WORLD_Y, PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { BLOCK_CLAIM_OVERLAP_MESSAGE } from '../../server/services/claimAnchors';
import { DEFAULT_CLAIM_FLAGS, migrateClaimStore } from '../../server/services/claims';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-claim-anchors-'));
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

function lookAngles(
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

describe('Anarchy claim-anchor blocks', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dir?: string): Promise<WorldInstance> {
    const dataDir = dir ?? await tempDir();
    if (!dir) dirs.push(dataDir);
    const world = new WorldInstance(testConfig(dataDir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function chat(world: WorldInstance, player: ReturnType<typeof join>, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return resultLines(player.sink);
  }

  function loadClaims(world: WorldInstance) {
    return migrateClaimStore(world.pluginStore.load('claims/claims', { claims: [] }));
  }

  function lookAt(player: ServerPlayer, x: number, y: number, z: number): void {
    const look = lookAngles(player.controller.position, x, y, z);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
  }

  function prepareCell(world: WorldInstance, player: ServerPlayer, x: number, y: number, z: number): void {
    player.controller.teleport([x + 0.5, y, z + 2.5]);
    world.world.setBlock(x, y, z, BlockId.Air);
    lookAt(player, x, y, z);
  }

  function placeAnchor(
    world: WorldInstance,
    player: ServerPlayer,
    x: number,
    y: number,
    z: number,
    blockId: number,
  ): { ok: true } | { ok: false; reason: string } {
    world.setGameMode(player, 'creative');
    prepareCell(world, player, x, y, z);
    return world.tryPlace(player, x, y, z, blockId);
  }

  function originOf(player: ServerPlayer): { x: number; y: number; z: number } {
    return {
      x: Math.floor(player.controller.position.x) + 4,
      y: Math.floor(player.controller.position.y),
      z: Math.floor(player.controller.position.z) + 4,
    };
  }

  it('creates full-height cuboid block-claims with radii 10/20/30, default flags and per-player names', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const { x, y, z } = originOf(ada.player);

    expect(placeAnchor(world, ada.player, x, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    expect(placeAnchor(world, ada.player, x + 31, y, z, BlockId.GoldBlock)).toEqual({ ok: true });
    expect(placeAnchor(world, ada.player, x + 82, y, z, BlockId.DiamondBlock)).toEqual({ ok: true });
    expect(placeAnchor(world, bob.player, x, y, z + 80, BlockId.IronBlock)).toEqual({ ok: true });

    const store = loadClaims(world);
    expect(store.blockClaimSeq).toEqual({ ada: 3, bob: 1 });
    const adaClaims = store.claims.filter((claim) => claim.owner === 'ada').sort((a, b) => a.name.localeCompare(b.name));
    const bobClaims = store.claims.filter((claim) => claim.owner === 'bob');
    expect(adaClaims.map((claim) => claim.name)).toEqual(['1', '2', '3']);
    expect(bobClaims.map((claim) => claim.name)).toEqual(['1']);

    const iron = adaClaims[0]!;
    const gold = adaClaims[1]!;
    const diamond = adaClaims[2]!;
    expect(iron.anchor).toEqual({ x, y, z, block: 'iron_block' });
    expect(gold.anchor).toEqual({ x: x + 31, y, z, block: 'gold_block' });
    expect(diamond.anchor).toEqual({ x: x + 82, y, z, block: 'diamond_block' });
    expect(iron.volume).toEqual({ minX: x - 10, maxX: x + 10, minY: 0, maxY: MAX_WORLD_Y, minZ: z - 10, maxZ: z + 10 });
    expect(gold.volume.maxX - gold.volume.minX).toBe(40);
    expect(diamond.volume.maxX - diamond.volume.minX).toBe(60);
    expect(iron.flags).toEqual({});
    expect(iron.priority).toBe(0);
    expect(iron.members).toEqual([]);

    ada.player.controller.teleport([x + 0.5, y, z + 0.5]);
    const info = chat(world, ada, '/claim info 1');
    expect(info).toEqual(expect.arrayContaining([
      'Claim: 1',
      'Owner: ada',
      'Type: block',
      `Anchor: ${x},${y},${z} iron_block`,
      'Radius: 10',
      'block-break: false',
      'block-place: false',
      'pvp: false',
      'explosions: true',
    ]));
    expect(info.some((line) => line === `mob-spawn: ${DEFAULT_CLAIM_FLAGS['mob-spawn']}`)).toBe(true);
  });

  it('protects the block-claim from foreigners and lets the owner break only that anchor', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const { x, y, z } = originOf(ada.player);

    expect(placeAnchor(world, ada.player, x, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    expect(placeAnchor(world, ada.player, x + 21, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    world.world.setBlock(x + 1, y, z, BlockId.Dirt);
    world.setGameMode(bob.player, 'creative');
    prepareCell(world, bob.player, x + 2, y, z);
    bob.sink.payloads.length = 0;
    expect(world.tryPlace(bob.player, x + 2, y, z, BlockId.Dirt)).toEqual({ ok: false, reason: 'cancelled' });
    expect(resultLines(bob.sink)).toContain('This land is claimed.');
    expect(world.tryBreak(bob.player, x + 1, y, z)).toEqual({ ok: false, reason: 'cancelled' });
    expect(world.tryBreak(bob.player, x, y, z)).toEqual({ ok: false, reason: 'cancelled' });

    world.setGameMode(ada.player, 'creative');
    ada.player.controller.teleport([x + 1.5, y, z + 0.5]);
    expect(world.tryBreak(ada.player, x + 1, y, z)).toEqual({ ok: true });
    expect(loadClaims(world).claims.map((claim) => claim.name).sort()).toEqual(['1', '2']);

    ada.player.controller.teleport([x + 0.5, y, z + 0.5]);
    expect(world.tryBreak(ada.player, x, y, z)).toEqual({ ok: true });
    const remaining = loadClaims(world).claims;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe('2');
    expect(remaining[0]!.anchor).toEqual({ x: x + 21, y, z, block: 'iron_block' });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
  });

  it('denies overlapping block-claims, including own diamond vs iron, but allows a regular claim overlap', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const { x, y, z } = originOf(ada.player);

    expect(placeAnchor(world, ada.player, x, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    ada.sink.payloads.length = 0;
    expect(placeAnchor(world, ada.player, x + 20, y, z, BlockId.IronBlock)).toEqual({ ok: false, reason: 'cancelled' });
    expect(resultLines(ada.sink)).toContain(BLOCK_CLAIM_OVERLAP_MESSAGE);
    expect(world.world.getBlock(x + 20, y, z)).toBe(BlockId.Air);

    ada.sink.payloads.length = 0;
    expect(placeAnchor(world, ada.player, x + 5, y, z + 5, BlockId.DiamondBlock)).toEqual({ ok: false, reason: 'cancelled' });
    expect(resultLines(ada.sink)).toContain(BLOCK_CLAIM_OVERLAP_MESSAGE);

    ada.player.controller.teleport([x + 80.5, y, z + 0.5]);
    chat(world, ada, '/claim pos1');
    ada.player.controller.teleport([x + 88.5, y + 4, z + 8.5]);
    chat(world, ada, '/claim pos2');
    expect(chat(world, ada, '/claim create garden').some((line) => line.includes("Claim 'garden' created"))).toBe(true);

    bob.sink.payloads.length = 0;
    expect(placeAnchor(world, bob.player, x + 84, y, z + 4, BlockId.DiamondBlock)).toEqual({ ok: false, reason: 'cancelled' });
    expect(resultLines(bob.sink)).toContain('This land is claimed.');
    expect(world.world.getBlock(x + 84, y, z + 4)).toBe(BlockId.Air);

    expect(placeAnchor(world, ada.player, x + 84, y, z + 4, BlockId.IronBlock)).toEqual({ ok: true });
    const store = loadClaims(world);
    expect(store.claims.some((claim) => claim.name === 'garden' && !claim.anchor)).toBe(true);
    expect(store.claims.some((claim) => claim.anchor?.block === 'iron_block' && claim.anchor.x === x + 84)).toBe(true);

    const iron = store.claims.find((claim) => claim.anchor?.block === 'iron_block' && claim.anchor.x === x)!;
    ada.player.controller.teleport([iron.volume.minX + 0.5, y, iron.volume.minZ + 0.5]);
    chat(world, ada, '/claim pos1');
    ada.player.controller.teleport([iron.volume.maxX + 0.5, y + 3, iron.volume.maxZ + 0.5]);
    chat(world, ada, '/claim pos2');
    expect(chat(world, ada, '/claim create overlay').some((line) => line.includes("Claim 'overlay' created"))).toBe(true);
  });

  it('keeps anchors across restart without duplicating leftover blocks, and OP can break them', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = await boot(dir);
    const ada = join(first, 'Ada');
    const { x, y, z } = originOf(ada.player);
    expect(placeAnchor(first, ada.player, x, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    first.world.setBlock(x + 21, y, z, BlockId.IronBlock);
    const token = ada.player.sessionToken;
    await first.save();
    await first.stop();
    worlds.pop();

    const second = await boot(dir);
    const restored = loadClaims(second);
    expect(restored.claims).toHaveLength(1);
    expect(restored.claims[0]!.anchor).toEqual({ x, y, z, block: 'iron_block' });
    expect(restored.blockClaimSeq).toEqual({ ada: 1 });

    const resumed = join(second, 'Ada', token);
    const bob = join(second, 'Bob');
    second.setGameMode(bob.player, 'creative');
    bob.player.controller.teleport([x + 0.5, y, z + 0.5]);
    expect(second.tryBreak(bob.player, x, y, z)).toEqual({ ok: false, reason: 'cancelled' });
    resumed.player.controller.teleport([x + 0.5, y, z + 0.5]);
    expect(chat(second, resumed, '/claim info 1').some((line) => line === 'Type: block')).toBe(true);

    const op = join(second, 'Op');
    second.setGameMode(op.player, 'creative');
    op.player.controller.teleport([x + 0.5, y, z + 0.5]);
    expect(second.tryBreak(op.player, x, y, z)).toEqual({ ok: true });
    expect(loadClaims(second).claims).toHaveLength(0);
    expect(second.world.getBlock(x, y, z)).toBe(BlockId.Air);
  });

  it('does not reuse deleted block-claim numbers or delete another claim when the leftover block is broken', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const { x, y, z } = originOf(ada.player);
    expect(placeAnchor(world, ada.player, x, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    expect(placeAnchor(world, ada.player, x + 21, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    expect(chat(world, ada, '/claim delete 2').some((line) => line.includes("Deleted claim '2'"))).toBe(true);
    expect(world.world.getBlock(x + 21, y, z)).toBe(BlockId.IronBlock);
    expect(loadClaims(world).claims).toHaveLength(1);

    world.setGameMode(ada.player, 'creative');
    ada.player.controller.teleport([x + 21.5, y, z + 0.5]);
    expect(world.tryBreak(ada.player, x + 21, y, z)).toEqual({ ok: true });
    expect(loadClaims(world).claims.map((claim) => claim.name)).toEqual(['1']);

    expect(placeAnchor(world, ada.player, x + 21, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    expect(loadClaims(world).claims.map((claim) => claim.name).sort()).toEqual(['1', '3']);
    expect(loadClaims(world).blockClaimSeq).toEqual({ ada: 3 });
  });

  it('rolls back a racing place and returns the item in survival', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const { x, y, z } = originOf(ada.player);
    world.setGameMode(ada.player, 'survival');
    ada.player.inventory.clear();
    expect(ada.player.inventory.addItem('iron_block', 1)).toBe(0);
    world.events.on('blockPlace', (event) => {
      if (event.blockId !== BlockId.IronBlock) return;
      const current = migrateClaimStore(world.pluginStore.load('claims/claims', { claims: [] }));
      current.claims.push({
        id: 'race',
        name: 'race',
        owner: 'other',
        worldId: world.worldId,
        volume: {
          minX: x - 10, maxX: x + 10, minY: 0, maxY: MAX_WORLD_Y, minZ: z - 10, maxZ: z + 10,
        },
        members: [],
        priority: 0,
        flags: {},
        anchor: { x: x + 40, y, z, block: 'iron_block' },
      });
      world.pluginStore.save('claims/claims', current);
    });
    ada.sink.payloads.length = 0;
    prepareCell(world, ada.player, x, y, z);
    expect(world.tryPlace(ada.player, x, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(ada.player.inventory.has('iron_block', 1)).toBe(true);
    expect(resultLines(ada.sink)).toContain(BLOCK_CLAIM_OVERLAP_MESSAGE);
    const live = loadClaims(world).claims.filter((claim) => claim.owner === 'ada');
    expect(live).toEqual([]);
  });
});
