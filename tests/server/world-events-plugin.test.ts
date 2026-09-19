import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ItemId } from '../../src/items';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import { DEFAULT_WORLD_EVENTS_CONFIG } from '../../server/services/worldEvents';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-world-events-'));
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

describe('world events plugin commands', () => {
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

  function holdItem(player: ServerPlayer, itemId: string): void {
    for (let slot = 0; slot < 36; slot += 1) {
      if (player.inventory.getSlot(slot)?.itemId === itemId) {
        player.selectedSlot = slot;
        return;
      }
    }
    throw new Error(`${itemId} not in inventory`);
  }

  it('gives a shared wand, saves a one-chest template, and keeps AutoMine on its own selection', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const op = join(world, 'Op');

    expect(chat(world, ada, '/wand').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, ada, '/events force spawn').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, op, '/events status').some((line) => line.includes('World events'))).toBe(true);

    const given = chat(world, op, '/wand');
    expect(given.some((line) => line.includes('Режим выделения включён'))).toBe(true);
    holdItem(op.player, ItemId.WoodenAxe);
    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 4, 40, 4, BlockId.Stone));
    world.events.emit('blockBreak', world.events.createBlockBreak(op.player.id, 6, 42, 6, BlockId.Stone));
    expect(chat(world, op, '/wand clear').some((line) => line.includes('Выделение очищено'))).toBe(true);

    world.world.setBlock(4, 40, 4, BlockId.StoneBricks);
    world.world.setBlock(6, 42, 6, BlockId.StoneBricks);
    world.world.setBlock(5, 41, 5, BlockId.Chest);
    chat(world, op, '/wand');
    holdItem(op.player, ItemId.WoodenAxe);
    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 4, 40, 4, BlockId.StoneBricks));
    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 6, 42, 6, BlockId.StoneBricks));
    const saved = chat(world, op, '/events template save shrine_test');
    expect(saved.some((line) => line.includes("Шаблон 'shrine_test' сохранён"))).toBe(true);
    expect(chat(world, op, '/events template list').some((line) => line.includes('shrine_test'))).toBe(true);
    expect(chat(world, op, '/events template info shrine_test').some((line) => line.includes('Якорь сундука'))).toBe(true);

    expect(world.selection.isWandActive(op.player.id)).toBe(true);
    chat(world, op, '/automine wand');
    expect(world.selection.isWandActive(op.player.id)).toBe(false);
    holdItem(op.player, ItemId.WoodenAxe);
    world.events.emit('playerInteract', world.events.createPlayerInteract(op.player.id, 10, 40, 10, BlockId.Stone));
    world.events.emit('blockBreak', world.events.createBlockBreak(op.player.id, 12, 42, 12, BlockId.Stone));
    const created = chat(world, op, '/automine create spawnmine');
    expect(created.some((line) => line.includes('Авто-шахта создана'))).toBe(true);
  });

  it('locks the event chest until unlock, then restores the world on cleanup', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    world.worldEvents.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, unlockDelayMinutes: 5, durationMinutes: 30 });

    const x = 24;
    const z = 24;
    const y = world.world.surfaceY(x, z) + 1;
    const marker = { x: 22, y: world.world.surfaceY(22, 22) + 1, z: 22 };
    world.world.setBlock(marker.x, marker.y, marker.z, BlockId.GoldBlock);

    const spawned = world.worldEvents.forceSpawn({ at: { x, y, z }, yaw: 0 });
    expect(spawned.ok).toBe(true);
    if (!spawned.ok) return;
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.EventChest);
    expect(world.worldEvents.isLockedChest(x, y, z)).toBe(true);

    const breakEvent = world.events.emit('blockBreak', world.events.createBlockBreak(op.player.id, x, y, z, BlockId.EventChest));
    expect(breakEvent.cancelled).toBe(true);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.EventChest);

    op.sink.payloads.length = 0;
    const interact = world.events.emit(
      'playerInteract',
      world.events.createPlayerInteract(op.player.id, x, y, z, BlockId.EventChest),
    );
    expect(interact.cancelled).toBe(true);
    expect(resultLines(op.sink).some((line) => line.includes('ещё закрыт'))).toBe(true);

    const loot = world.world.getChest(x, y, z).slots.map((slot) => slot && { ...slot });
    expect(loot.some((slot) => slot?.itemId === 'tnt_powerful')).toBe(true);

    world.worldEvents.tick(spawned.event.unlockAt + 1);
    expect(world.worldEvents.isLockedChest(x, y, z)).toBe(false);
    expect(world.world.getChest(x, y, z).slots).toEqual(loot);

    const open = world.events.emit(
      'playerInteract',
      world.events.createPlayerInteract(op.player.id, x, y, z, BlockId.EventChest),
    );
    expect(open.cancelled).toBe(false);

    expect(chat(world, op, '/events force cleanup').some((line) => line.includes('восстановлен'))).toBe(true);
    expect(world.world.getBlock(x, y, z)).not.toBe(BlockId.EventChest);
    expect(world.world.getBlock(marker.x, marker.y, marker.z)).toBe(BlockId.GoldBlock);
  });
});
