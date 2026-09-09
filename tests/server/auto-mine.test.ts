import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ItemId } from '../../src/items';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import { AUTOMINE_ALLOWED_BLOCKS, AUTOMINE_WAND_ITEM, cuboidSize, mineVolume } from '../../server/services/autoMine';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-automine-'));
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

describe('AutoMine plugin commands', () => {
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

  function holdWand(player: ServerPlayer): void {
    for (let slot = 0; slot < 36; slot += 1) {
      if (player.inventory.getSlot(slot)?.itemId === AUTOMINE_WAND_ITEM) {
        player.selectedSlot = slot;
        return;
      }
    }
    throw new Error('wand not in inventory');
  }

  function drain(world: WorldInstance, name: string, ticks = 120): void {
    for (let i = 0; i < ticks; i += 1) {
      if (!world.autoMine.isResetting(name)) return;
      world.tick();
    }
    throw new Error(`mine '${name}' still resetting`);
  }

  it('denies ordinary players and lets OP wand/create/info/list/reset/setters', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const op = join(world, 'Op');
    expect(chat(world, ada, '/automine wand').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, op, '/automine wand').some((line) => line.includes('инструмент'))).toBe(true);
    expect(op.player.inventory.has(ItemId.WoodenAxe, 1)).toBe(true);
    holdWand(op.player);

    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 10, 40, 10, BlockId.Stone));
    world.events.emit('blockBreak', world.events.createBlockBreak(op.player.id, 12, 42, 12, BlockId.Stone));
    const created = chat(world, op, '/automine create SpawnMine');
    expect(created.some((line) => line.includes('Авто-шахта создана'))).toBe(true);
    expect(created.some((line) => line.includes('3 × 3 × 3'))).toBe(true);
    drain(world, 'spawnmine');
    const mine = world.autoMine.get('spawnmine');
    expect(mine).toBeDefined();
    const size = cuboidSize(mineVolume(mine!));
    expect(size.blocks).toBe(27);
    for (let x = 10; x <= 12; x += 1) {
      for (let y = 40; y <= 42; y += 1) {
        for (let z = 10; z <= 12; z += 1) {
          expect(AUTOMINE_ALLOWED_BLOCKS.has(world.world.getBlock(x, y, z))).toBe(true);
        }
      }
    }

    expect(chat(world, op, '/automine create spawnmine').some((line) => line.includes('уже существует'))).toBe(true);
    expect(chat(world, op, '/automine info spawnmine').some((line) => line.includes('Авто-шахта: spawnmine'))).toBe(true);
    expect(chat(world, op, '/automine info spawnmine').some((line) => line.includes('не задан'))).toBe(true);
    expect(chat(world, op, '/automine list').some((line) => line.includes('spawnmine'))).toBe(true);

    op.player.controller.teleport([1.5, 70, 2.5]);
    op.player.controller.yaw = 0.75;
    op.player.controller.pitch = -0.25;
    expect(chat(world, op, '/automine setteleport spawnmine').some((line) => line.includes('Точка телепорта'))).toBe(true);
    expect(chat(world, op, '/automine setinterval spawnmine 5s').some((line) => line.includes('целым числом'))).toBe(true);
    expect(chat(world, op, '/automine setinterval spawnmine 30').some((line) => line.includes('30 сек'))).toBe(true);

    const inside = join(world, 'Inside');
    const outside = join(world, 'Outside');
    inside.player.controller.teleport([10.2, 40.1, 10.2]);
    outside.player.controller.teleport([20, 40, 20]);
    expect(chat(world, op, '/automine reset spawnmine').some((line) => line.includes('запущен'))).toBe(true);
    expect(inside.player.controller.position.x).toBeCloseTo(1.5, 5);
    expect(inside.player.controller.position.z).toBeCloseTo(2.5, 5);
    expect(inside.player.controller.yaw).toBeCloseTo(0.75, 5);
    expect(inside.player.controller.pitch).toBeCloseTo(-0.25, 5);
    expect(outside.player.controller.position.x).toBeCloseTo(20, 5);
    expect(chat(world, op, '/automine reset spawnmine').some((line) => line.includes('уже обновляется'))).toBe(true);
    drain(world, 'spawnmine');
  });

  it('persists mines and continues an overdue timer after restart without stacking resets', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    chat(world, op, '/automine wand');
    holdWand(op.player);
    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 4, 30, 4, BlockId.Stone));
    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 5, 31, 5, BlockId.Stone));
    chat(world, op, '/automine create restartmine');
    drain(world, 'restartmine');
    op.player.controller.teleport([0.5, 70, 0.5]);
    chat(world, op, '/automine setteleport restartmine');
    chat(world, op, '/automine setinterval restartmine 60');
    const stored = world.pluginStore.load<{ mines: Array<{ name: string; nextResetAt: number | null }> }>('automine/automines', { mines: [] });
    const entry = stored.mines.find((mine) => mine.name === 'restartmine');
    expect(entry?.nextResetAt).toBeGreaterThan(Date.now());
    entry!.nextResetAt = Date.now() - 5_000;
    world.pluginStore.save('automine/automines', stored);

    const dir = world.config.dataDir;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = new WorldInstance(testConfig(dir));
    worlds.push(again);
    await again.initialize();
    await again.loadPlugins();
    await again.plugins.enableAll();
    expect(again.autoMine.get('restartmine')).toBeDefined();
    again.autoMine.blocksPerTick = 1;
    again.autoMine.tick(Date.now());
    expect(again.autoMine.isResetting('restartmine')).toBe(true);
    again.autoMine.tick(Date.now());
    expect(again.autoMine.isResetting('restartmine')).toBe(true);
    drain(again, 'restartmine');
    const next = again.autoMine.get('restartmine')?.nextResetAt;
    expect(next).toBeGreaterThan(Date.now());
  });

  it('restores original blocks on delete and batches first fill', async () => {
    const world = await boot();
    world.autoMine.blocksPerTick = 3;
    const op = join(world, 'Op');
    world.world.setBlock(8, 25, 8, BlockId.Bricks);
    chat(world, op, '/automine wand');
    holdWand(op.player);
    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 8, 25, 8, BlockId.Bricks));
    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 9, 26, 9, BlockId.Stone));
    const created = chat(world, op, '/automine create tiny');
    expect(created.some((line) => line.includes('Авто-шахта создана'))).toBe(true);
    expect(world.autoMine.isResetting('tiny')).toBe(true);
    world.tick();
    expect(world.autoMine.isResetting('tiny')).toBe(true);
    drain(world, 'tiny');
    expect(AUTOMINE_ALLOWED_BLOCKS.has(world.world.getBlock(8, 25, 8))).toBe(true);
    expect(chat(world, op, '/automine delete tiny').some((line) => line.includes('удаляется'))).toBe(true);
    for (let i = 0; i < 40; i += 1) {
      if (!world.autoMine.get('tiny')) break;
      world.tick();
    }
    expect(world.autoMine.get('tiny')).toBeUndefined();
    expect(world.world.getBlock(8, 25, 8)).toBe(BlockId.Bricks);
  });
});
