import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { getTntProfile } from '../../src/world/tnt';
import { loadServerConfig } from '../../server/config';
import { migrateClaimStore } from '../../server/services/claims';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-tnt-types-'));
}

function testConfig(dataDir: string) {
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
    operators: ['Op'],
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

describe('Anarchy TNT types vs claims', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dataDir = await tempDir();
    dirs.push(dataDir);
    const world = new WorldInstance(testConfig(dataDir));
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

  function loadClaims(world: WorldInstance) {
    return migrateClaimStore(world.pluginStore.load('claims/claims', { claims: [] }));
  }

  function lookAt(player: ServerPlayer, x: number, y: number, z: number): void {
    const from = player.controller.position;
    const dx = x + 0.5 - from.x;
    const dy = y + 0.5 - (from.y + PLAYER_EYE_HEIGHT);
    const dz = z + 0.5 - from.z;
    player.controller.yaw = Math.atan2(-dx, -dz);
    player.controller.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  function prepareCell(world: WorldInstance, player: ServerPlayer, x: number, y: number, z: number): void {
    player.controller.teleport([x + 0.5, y, z + 2.5]);
    world.world.setBlock(x, y, z, BlockId.Air);
    world.world.setBlock(x, y, z - 1, BlockId.Dirt);
    lookAt(player, x, y, z);
  }

  function placeAnchor(
    world: WorldInstance,
    player: ServerPlayer,
    x: number,
    y: number,
    z: number,
    blockId: number,
  ): void {
    world.setGameMode(player, 'creative');
    prepareCell(world, player, x, y, z);
    expect(world.tryPlace(player, x, y, z, blockId)).toEqual({ ok: true });
  }

  function originOf(player: ServerPlayer): { x: number; y: number; z: number } {
    return {
      x: Math.floor(player.controller.position.x) + 4,
      y: Math.floor(player.controller.position.y),
      z: Math.floor(player.controller.position.z) + 4,
    };
  }

  function detonate(
    world: WorldInstance,
    x: number,
    y: number,
    z: number,
    blockId: BlockId,
  ): void {
    world.world.setBlock(x, y, z, blockId);
    expect(world.gameplay.redstone.primeTnt(x, y, z, 0.05)).toBeDefined();
    world.tick();
  }

  it('ordinary TNT never breaks iron/gold/diamond block-claim anchors', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const { x, y, z } = originOf(ada.player);
    placeAnchor(world, ada.player, x, y, z, BlockId.IronBlock);
    placeAnchor(world, ada.player, x + 31, y, z, BlockId.GoldBlock);
    placeAnchor(world, ada.player, x + 82, y, z, BlockId.DiamondBlock);
    expect(loadClaims(world).claims).toHaveLength(3);

    detonate(world, x + 1, y, z, BlockId.Tnt);
    detonate(world, x + 32, y, z, BlockId.Tnt);
    detonate(world, x + 83, y, z, BlockId.Tnt);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.IronBlock);
    expect(world.world.getBlock(x + 31, y, z)).toBe(BlockId.GoldBlock);
    expect(world.world.getBlock(x + 82, y, z)).toBe(BlockId.DiamondBlock);
    expect(loadClaims(world).claims).toHaveLength(3);
  });

  it('powerful TNT breaks all three anchors and deletes those block-claims', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const { x, y, z } = originOf(ada.player);
    placeAnchor(world, ada.player, x, y, z, BlockId.IronBlock);
    placeAnchor(world, ada.player, x + 31, y, z, BlockId.GoldBlock);
    placeAnchor(world, ada.player, x + 82, y, z, BlockId.DiamondBlock);

    detonate(world, x + 1, y, z, BlockId.TntPowerful);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(loadClaims(world).claims.map((claim) => claim.anchor?.block).sort()).toEqual(['diamond_block', 'gold_block']);

    detonate(world, x + 32, y, z, BlockId.TntPowerful);
    expect(world.world.getBlock(x + 31, y, z)).toBe(BlockId.Air);
    expect(loadClaims(world).claims.map((claim) => claim.anchor?.block)).toEqual(['diamond_block']);

    detonate(world, x + 83, y, z, BlockId.TntPowerful);
    expect(world.world.getBlock(x + 82, y, z)).toBe(BlockId.Air);
    expect(loadClaims(world).claims).toEqual([]);
  });

  it('destructive TNT also breaks every block-claim anchor and removes the claim', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const { x, y, z } = originOf(ada.player);
    placeAnchor(world, ada.player, x, y, z, BlockId.IronBlock);
    placeAnchor(world, ada.player, x + 31, y, z, BlockId.GoldBlock);
    placeAnchor(world, ada.player, x + 82, y, z, BlockId.DiamondBlock);

    detonate(world, x + 1, y, z, BlockId.TntDestructive);
    detonate(world, x + 32, y, z, BlockId.TntDestructive);
    detonate(world, x + 83, y, z, BlockId.TntDestructive);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(world.world.getBlock(x + 31, y, z)).toBe(BlockId.Air);
    expect(world.world.getBlock(x + 82, y, z)).toBe(BlockId.Air);
    expect(loadClaims(world).claims).toEqual([]);
  });

  it('does not destroy blocks inside a regular /claim for any TNT type', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const { x, y, z } = originOf(ada.player);
    ada.player.controller.teleport([x + 0.5, y, z + 0.5]);
    chat(world, ada, '/claim pos1');
    ada.player.controller.teleport([x + 4.5, y + 3, z + 4.5]);
    chat(world, ada, '/claim pos2');
    expect(chat(world, ada, '/claim create garden').some((line) => line.includes("Claim 'garden' created"))).toBe(true);

    world.world.setBlock(x + 2, y, z + 2, BlockId.Dirt);
    world.world.setBlock(x + 6, y, z + 2, BlockId.Dirt);
    detonate(world, x + 6, y, z + 3, BlockId.Tnt);
    expect(world.world.getBlock(x + 2, y, z + 2)).toBe(BlockId.Dirt);

    world.world.setBlock(x + 6, y, z + 2, BlockId.Dirt);
    detonate(world, x + 6, y, z + 3, BlockId.TntPowerful);
    expect(world.world.getBlock(x + 2, y, z + 2)).toBe(BlockId.Dirt);

    world.world.setBlock(x + 6, y, z + 2, BlockId.Dirt);
    detonate(world, x + 6, y, z + 3, BlockId.TntDestructive);
    expect(world.world.getBlock(x + 2, y, z + 2)).toBe(BlockId.Dirt);
    expect(loadClaims(world).claims.some((claim) => claim.name === 'garden' && !claim.anchor)).toBe(true);
  });

  it('chains ordinary TNT into powerful TNT that keeps the powerful blast', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const { x, y, z } = originOf(ada.player);
    world.world.getChunk(Math.floor((x + 8) / 16), Math.floor(z / 16));
    world.world.setBlock(x + 5, y, z, BlockId.Dirt);
    world.world.setBlock(x + 1, y, z, BlockId.TntPowerful);
    detonate(world, x, y, z, BlockId.Tnt);
    const chained = world.gameplay.redstone.primedTnt.find((entity) => entity.blockId === BlockId.TntPowerful);
    expect(chained).toBeDefined();
    expect(getTntProfile(chained!.blockId).radius).toBe(6);
    expect(getTntProfile(chained!.blockId).canBreakBlockClaims).toBe(true);
    chained!.velocity.set(0, 0, 0);
    chained!.fuseSeconds = 0.05;
    world.tick();
    expect(world.world.getBlock(x + 5, y, z)).toBe(BlockId.Air);
  });
});
