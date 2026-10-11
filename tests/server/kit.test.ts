import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import { KitService, parseKitName, parseKitStore } from '../../server/services/kit';

function memoryService(initial?: unknown): { service: KitService; saved: { value: unknown } } {
  const saved = { value: initial };
  const service = new KitService(
    () => saved.value,
    (store) => { saved.value = store; },
  );
  service.load();
  return { service, saved };
}

describe('kit definitions', () => {
  it('rejects bad names, unknown items, and bad counts', () => {
    expect(parseKitName('Start')).toBe('start');
    expect(parseKitName('donor_1')).toBe('donor_1');
    expect(parseKitName('bad name')).toBeUndefined();
    expect(parseKitName('../kit')).toBeUndefined();
    expect(parseKitName('a'.repeat(25))).toBeUndefined();
    const { service } = memoryService();
    expect(service.create('nope name').ok).toBe(false);
    expect(service.create('donor').ok).toBe(true);
    expect(service.create('donor').ok).toBe(false);
    expect(service.addItem('donor', 'not_a_real_item', 1).ok).toBe(false);
    expect(service.addItem('donor', ItemId.Diamond, 0).ok).toBe(false);
    expect(service.addItem('donor', ItemId.Diamond, 1.5).ok).toBe(false);
    expect(service.addItem('donor', ItemId.Diamond, 10_000).ok).toBe(false);
    expect(service.addItem('missing', ItemId.Diamond, 1).ok).toBe(false);
    expect(service.remove('start').ok).toBe(false);
  });

  it('saves stacked counts and reloads them', () => {
    const { service, saved } = memoryService();
    expect(service.addItem('start', ItemId.Diamond, 64).ok).toBe(true);
    expect(service.addItem('start', ItemId.Diamond, 64).ok).toBe(true);
    expect(service.addItem('start', ItemId.IronIngot, 3).ok).toBe(true);
    const reloaded = memoryService(saved.value).service;
    expect(reloaded.get('start')?.items).toEqual([
      { itemId: ItemId.Diamond, count: 128 },
      { itemId: ItemId.IronIngot, count: 3 },
    ]);
    expect(reloaded.clear('start').ok).toBe(true);
    expect(reloaded.get('start')?.items).toEqual([]);
  });

  it('drops malformed store entries', () => {
    const store = parseKitStore({
      kits: [
        { name: 'Donor', items: [{ itemId: ItemId.Diamond, count: 2 }, { itemId: 'nope', count: 4 }, { itemId: 'stone', count: -1 }] },
        { name: 'donor', items: [{ itemId: 'dirt', count: 1 }] },
        null,
      ],
      receivedStart: ['ada', 'ada', ''],
      pendingStart: ['ada', 'bob'],
    });
    expect(store.kits).toEqual([{ name: 'donor', items: [{ itemId: ItemId.Diamond, count: 2 }] }]);
    expect(store.receivedStart).toEqual(['ada']);
    expect(store.pendingStart).toEqual(['bob']);
  });

  it('grants the start kit once, retries a failed give, and ignores a nested call', () => {
    const { service } = memoryService();
    service.addItem('start', ItemId.Diamond, 2);
    const given: number[] = [];
    const nested = service.grantStart('ada', () => {
      given.push(1);
      expect(service.grantStart('ada', () => {
        given.push(99);
        return true;
      })).toBe('busy');
      return true;
    });
    expect(nested).toBe('granted');
    expect(given).toEqual([1]);
    expect(service.hasReceivedStart('ada')).toBe(true);
    expect(service.grantStart('ada', () => {
      given.push(2);
      return true;
    })).toBe('already');
    expect(given).toEqual([1]);
    expect(service.shouldAutoGrantStart(false, 'ada')).toBe(false);
    expect(service.shouldAutoGrantStart(true, 'ada')).toBe(false);

    expect(service.grantStart('bob', () => false)).toBe('failed');
    expect(service.hasReceivedStart('bob')).toBe(false);
    expect(service.isPendingStart('bob')).toBe(true);
    expect(service.shouldAutoGrantStart(false, 'bob')).toBe(true);
    expect(service.grantStart('bob', () => {
      throw new Error('inventory unavailable');
    })).toBe('failed');
    expect(service.hasReceivedStart('bob')).toBe(false);
    expect(service.grantStart('bob', () => true)).toBe('granted');
    expect(service.hasReceivedStart('bob')).toBe(true);
    expect(service.isPendingStart('bob')).toBe(false);
    expect(service.shouldAutoGrantStart(false, 'cara')).toBe(false);
    expect(service.shouldAutoGrantStart(true, 'cara')).toBe(true);
  });
});

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-kit-'));
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

function countItem(player: ServerPlayer, itemId: string): number {
  let total = 0;
  for (const stack of player.inventory.slots) {
    if (stack?.itemId === itemId) total += stack.count;
  }
  return total;
}

describe('kit commands', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dataDir?: string): Promise<{ world: WorldInstance; dir: string }> {
    const dir = dataDir ?? await tempDir();
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return { world, dir };
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

  it('gives start once, persists it, and gates other kits by permission', async () => {
    const first = await boot();
    const world = first.world;
    const op = join(world, 'Op');
    expect(countItem(op.player, ItemId.Diamond)).toBe(0);
    expect(chat(world, op, '/kit edit start add diamond 2').some((line) => line.includes('diamond × 2'))).toBe(true);
    expect(chat(world, op, '/kit edit start add diamond 1').some((line) => line.includes('diamond × 3'))).toBe(true);
    expect(countItem(op.player, ItemId.Diamond)).toBe(0);

    const ada = join(world, 'Ada');
    expect(countItem(ada.player, ItemId.Diamond)).toBe(3);
    expect(chat(world, ada, '/kit start').some((line) => line.includes('уже получен'))).toBe(true);
    expect(countItem(ada.player, ItemId.Diamond)).toBe(3);
    world.events.emit('entityDeath', {
      entityId: ada.player.id,
      cause: 'melee',
      playerId: ada.player.id,
    });
    expect(world.respawn(ada.player)).toBe(false);
    expect(countItem(ada.player, ItemId.Diamond)).toBe(3);

    const token = ada.player.sessionToken;
    world.disconnect(ada.player.id);
    const adaAgain = join(world, 'Ada', token);
    expect(adaAgain.resumed).toBe(true);
    expect(countItem(adaAgain.player, ItemId.Diamond)).toBe(3);

    expect(chat(world, adaAgain, '/kit create donor').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, op, '/kit create donor').some((line) => line.includes('создан'))).toBe(true);
    expect(chat(world, op, '/kit edit donor add iron_ingot 5').some((line) => line.includes('iron_ingot × 5'))).toBe(true);
    expect(chat(world, op, '/kit edit donor add cobblestone 100').some((line) => line.includes('cobblestone × 100'))).toBe(true);
    expect(chat(world, op, '/kit info donor').join('\n')).toContain('cobblestone × 100');
    expect(chat(world, op, `/kit create ${'a'.repeat(25)}`).some((line) => line.includes('Некорректное имя'))).toBe(true);
    expect(chat(world, op, '/kit edit donor add not_a_real_item 1').some((line) => line.includes('Неизвестный предмет'))).toBe(true);
    expect(chat(world, op, '/kit edit donor add diamond 0').some((line) => line.includes('Количество'))).toBe(true);
    expect(chat(world, op, '/kit give Nobody donor').some((line) => line.includes('не найден'))).toBe(true);
    expect(chat(world, adaAgain, '/kit claim donor').some((line) => line.includes('permission'))).toBe(true);
    expect(countItem(adaAgain.player, ItemId.IronIngot)).toBe(0);

    world.permissions.grant(adaAgain.player.name, 'kit.claim.donor');
    expect(chat(world, adaAgain, '/kit claim donor').some((line) => line.includes('Выдан набор'))).toBe(true);
    expect(countItem(adaAgain.player, ItemId.IronIngot)).toBe(5);
    expect(chat(world, adaAgain, '/kit claim donor').some((line) => line.includes('Выдан набор'))).toBe(true);
    expect(countItem(adaAgain.player, ItemId.IronIngot)).toBe(10);

    for (let slot = 0; slot < adaAgain.player.inventory.slots.length; slot += 1) {
      adaAgain.player.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    }
    expect(chat(world, op, '/kit give Ada donor').some((line) => line.includes('выдан'))).toBe(true);
    expect(countItem(adaAgain.player, 'cobblestone')).toBe(adaAgain.player.inventory.slots.length * 64);
    expect(countItem(adaAgain.player, ItemId.IronIngot)).toBe(0);
    const spilledIron = world.gameplay.drops.entities
      .filter((drop) => drop.stack.itemId === ItemId.IronIngot)
      .reduce((sum, drop) => sum + drop.stack.count, 0);
    const spilledCobble = world.gameplay.drops.entities
      .filter((drop) => drop.stack.itemId === 'cobblestone')
      .reduce((sum, drop) => sum + drop.stack.count, 0);
    expect(spilledIron).toBe(5);
    expect(spilledCobble).toBe(100);

    const diamondsBeforeRestart = countItem(adaAgain.player, ItemId.Diamond);
    world.disconnect(adaAgain.player.id);
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const restarted = await boot(first.dir);
    const adaRestarted = join(restarted.world, 'Ada', token);
    expect(adaRestarted.resumed).toBe(true);
    expect(countItem(adaRestarted.player, ItemId.Diamond)).toBe(diamondsBeforeRestart);
    expect(chat(restarted.world, adaRestarted, '/kit start').some((line) => line.includes('уже получен'))).toBe(true);
    expect(countItem(adaRestarted.player, ItemId.Diamond)).toBe(diamondsBeforeRestart);
  });
});
