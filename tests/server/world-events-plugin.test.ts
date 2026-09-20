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
import { VoxelWorld } from '../../src/world/World';
import { CHUNK_SIZE, floorDiv } from '../../src/core/constants';

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
    expect(chat(world, op, '/events status').some((line) => line.includes('Europe/Moscow'))).toBe(true);

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
    const modsBefore = world.world.serializeModifications();

    const spawned = world.worldEvents.forceSpawn({ at: { x, y, z }, yaw: 0 });
    expect(spawned.ok).toBe(true);
    if (!spawned.ok || !('event' in spawned)) return;
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.EventChest);
    expect(world.world.serializeModifications()).toEqual(modsBefore);
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
    await world.save();
    expect(world.world.getBlock(x, y, z)).not.toBe(BlockId.EventChest);
    expect(world.world.getBlock(marker.x, marker.y, marker.z)).toBe(BlockId.GoldBlock);
    expect(world.world.serializeModifications()).toEqual(modsBefore);
  });

  it('denies user and block-anchor claims that overlap the event column, then allows them after cleanup', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    world.worldEvents.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, unlockDelayMinutes: 5, durationMinutes: 30 });
    const x = 40;
    const z = 40;
    const y = world.world.surfaceY(x, z) + 1;
    const spawned = world.worldEvents.forceSpawn({ at: { x, y, z }, yaw: 0 });
    expect(spawned.ok && 'event' in spawned).toBe(true);
    expect(chat(world, op, '/claim list').some((line) => line.includes('You have no claims.'))).toBe(true);

    const above = world.events.emit('blockPlace', world.events.createBlockPlace(op.player.id, x, y + 8, z, BlockId.Stone));
    expect(above.cancelled).toBe(true);
    const below = world.events.emit('blockBreak', world.events.createBlockBreak(op.player.id, x, y - 4, z, BlockId.Stone));
    expect(below.cancelled).toBe(true);

    op.player.controller.teleport([x, y, z]);
    chat(world, op, '/claim pos1');
    op.player.controller.teleport([x + 3, y + 6, z + 3]);
    chat(world, op, '/claim pos2');
    expect(chat(world, op, '/claim create eventzone').some((line) => line.includes('ивентовой локацией'))).toBe(true);

    op.player.controller.teleport([x + 80, y, z + 80]);
    chat(world, op, '/claim pos1');
    op.player.controller.teleport([x + 82, y + 4, z + 82]);
    chat(world, op, '/claim pos2');
    expect(chat(world, op, '/claim create nearbyok').some((line) => line.includes("Claim 'nearbyok' created"))).toBe(true);

    const diamond = world.events.emit(
      'blockPlace',
      world.events.createBlockPlace(op.player.id, x + 20, y, z, BlockId.DiamondBlock),
    );
    expect(diamond.cancelled).toBe(true);

    world.economy.deposit(op.player.id, 20_000, 'ADMIN_GIVE');
    world.handleClanAction(op.player, { type: 'clan_action', action: 'set_name', name: 'Foxes' });
    world.handleClanAction(op.player, { type: 'clan_action', action: 'select_icon', icon: 'swords' });
    world.handleClanAction(op.player, { type: 'clan_action', action: 'confirm_create' });
    expect(world.clan.playerClan(op.player.id)?.name).toBe('Foxes');
    world.world.setBlock(x, y + 3, z, BlockId.Dirt);
    op.player.controller.teleport([x + 0.5, y + 4, z + 0.5]);
    world.handleClanAction(op.player, { type: 'clan_action', action: 'set_base' });
    world.handleClanAction(op.player, { type: 'clan_action', action: 'confirm_set_base' });
    expect(world.clan.playerClan(op.player.id)?.base).toBeUndefined();

    world.worldEvents.forceCleanup();
    await world.save();
    op.player.controller.teleport([x, y, z]);
    chat(world, op, '/claim pos1');
    op.player.controller.teleport([x + 3, y + 6, z + 3]);
    chat(world, op, '/claim pos2');
    expect(chat(world, op, '/claim create afterevent').some((line) => line.includes("Claim 'afterevent' created"))).toBe(true);

    op.player.controller.teleport([x + 200, y, z + 200]);
    chat(world, op, '/claim pos1');
    op.player.controller.teleport([x + 210, y + 8, z + 210]);
    chat(world, op, '/claim pos2');
    expect(chat(world, op, '/claim create overlap-a').some((line) => line.includes("Claim 'overlap-a' created"))).toBe(true);
    op.player.controller.teleport([x + 205, y, z + 205]);
    chat(world, op, '/claim pos1');
    op.player.controller.teleport([x + 215, y + 8, z + 215]);
    chat(world, op, '/claim pos2');
    expect(chat(world, op, '/claim create overlap-b').some((line) => line.includes("Claim 'overlap-b' created"))).toBe(true);
  });

  it('reconnects and late-joins the same shrine without persistent modifications', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    world.worldEvents.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC', unlockDelayMinutes: 5 });
    const x = 24;
    const z = 24;
    const y = world.world.surfaceY(x, z) + 1;
    op.player.controller.teleport([x + 0.5, y, z + 0.5]);
    world.setView(op.player, floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), 2);
    const persistentBefore = world.world.serializeModifications();
    expect(world.worldEvents.forceSpawn({ at: { x, y, z }, yaw: 0 }).ok).toBe(true);
    expect(world.world.serializeModifications()).toEqual(persistentBefore);
    expect(world.networkModifications()).not.toEqual(persistentBefore);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.EventChest);

    const token = op.player.sessionToken;
    const previousConnection = op.player.connectionId;
    expect(op.player.knownChunks.size).toBeGreaterThan(0);
    world.disconnect(op.player.id);
    expect(op.player.knownChunks.size).toBe(0);

    const resumedSink = new MemorySink();
    const resumed = world.join({ sink: resumedSink, name: 'Op', sessionToken: token });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.resumed).toBe(true);
    expect(resumed.player).toBe(op.player);
    expect(resumed.player.connectionId).not.toBe(previousConnection);
    const chunkData = resumedSink.payloads.filter((payload) => (
      payload && typeof payload === 'object' && (payload as { type?: string }).type === 'chunk_data'
    ));
    expect(chunkData.length).toBeGreaterThan(0);
    const eventChunk = chunkData.find((payload) => {
      const message = payload as { cx?: number; cz?: number; modifications?: Record<string, number> };
      return message.cx === floorDiv(x, CHUNK_SIZE) && message.cz === floorDiv(z, CHUNK_SIZE);
    }) as { modifications?: Record<string, number> } | undefined;
    expect(eventChunk).toBeDefined();
    expect(Object.values(eventChunk!.modifications ?? {})).toContain(BlockId.EventChest);

    const reconnectClient = restoreOnlineClient(world);
    reconnectClient.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), true);
    expect(reconnectClient.getBlock(x, y, z)).toBe(BlockId.EventChest);
    expect(reconnectClient.getBlockState(x, y, z)).toEqual(world.world.getBlockState(x, y, z));

    const bob = join(world, 'Bob');
    void bob;
    const lateClient = restoreOnlineClient(world);
    lateClient.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), true);
    expect(lateClient.getBlock(x, y, z)).toBe(BlockId.EventChest);
    expect(lateClient.getBlock(x, y - 1, z)).toBe(world.world.getBlock(x, y - 1, z));

    const afterResume = resumedSink.payloads.filter((payload) => (
      payload && typeof payload === 'object' && (payload as { type?: string }).type === 'chunk_data'
    )).length;
    world.tick();
    world.tick();
    const afterTicks = resumedSink.payloads.filter((payload) => (
      payload && typeof payload === 'object' && (payload as { type?: string }).type === 'chunk_data'
    )).length;
    expect(afterTicks).toBe(afterResume);

    world.worldEvents.forceCleanup();
    await world.save();
    expect(world.world.serializeModifications()).toEqual(persistentBefore);
    expect(world.networkModifications()).toEqual(persistentBefore);
    const cleaned = restoreOnlineClient(world);
    cleaned.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), true);
    expect(cleaned.getBlock(x, y, z)).not.toBe(BlockId.EventChest);
    expect(cleaned.getBlock(x, y, z)).toBe(world.world.getBlock(x, y, z));
  });

  it('restores overlay after restart via storedPlayers without persisting it', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = new WorldInstance(testConfig(dir));
    worlds.push(first);
    await first.initialize();
    await first.loadPlugins();
    await first.plugins.enableAll();
    first.worldEvents.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC', unlockDelayMinutes: 5 });
    const op = join(first, 'Op');
    const x = 24;
    const z = 24;
    const y = first.world.surfaceY(x, z) + 1;
    op.player.controller.teleport([x + 0.5, y, z + 0.5]);
    first.setView(op.player, floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), 2);
    expect(first.worldEvents.forceSpawn({ at: { x, y, z }, yaw: 0 }).ok).toBe(true);
    const persistent = first.world.serializeModifications();
    const token = op.player.sessionToken;
    first.disconnect(op.player.id);
    await first.save();
    await first.stop();
    worlds.splice(worlds.indexOf(first), 1);

    const second = new WorldInstance(testConfig(dir));
    worlds.push(second);
    await second.initialize();
    await second.loadPlugins();
    await second.plugins.enableAll();
    expect(second.world.serializeModifications()).toEqual(persistent);
    expect(second.world.getBlock(x, y, z)).toBe(BlockId.EventChest);
    expect(second.networkModifications()).not.toEqual(persistent);

    const sink = new MemorySink();
    const resumed = second.join({ sink, name: 'Op', sessionToken: token });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.resumed).toBe(true);
    expect(resumed.player.knownChunks.size).toBeGreaterThan(0);
    const eventChunk = sink.payloads.find((payload) => {
      const message = payload as { type?: string; cx?: number; cz?: number; modifications?: Record<string, number> };
      return message.type === 'chunk_data'
        && message.cx === floorDiv(x, CHUNK_SIZE)
        && message.cz === floorDiv(z, CHUNK_SIZE);
    }) as { modifications?: Record<string, number> } | undefined;
    expect(Object.values(eventChunk?.modifications ?? {})).toContain(BlockId.EventChest);

    const client = restoreOnlineClient(second);
    client.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), true);
    expect(client.getBlock(x, y, z)).toBe(BlockId.EventChest);
    expect(client.getBlockState(x, y, z)).toEqual(second.world.getBlockState(x, y, z));
    expect(second.world.serializeModifications()).toEqual(persistent);
  });
});

function restoreOnlineClient(instance: WorldInstance): VoxelWorld {
  const client = new VoxelWorld(instance.seed);
  client.restore({
    timeOfDay: instance.world.timeOfDay,
    modifications: instance.networkModifications(),
    chests: {},
    furnaces: {},
    blockStates: instance.blockStates(),
  });
  return client;
}
