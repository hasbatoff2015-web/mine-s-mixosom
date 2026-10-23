import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, createStarterInventory, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import { KitService, parseKitName, parseKitStore, snapshotKitItems } from '../../server/services/kit';

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
  it('copies inventory stacks and rejects bad or duplicate names', () => {
    expect(parseKitName('Start')).toBe('start');
    expect(parseKitName('bad name')).toBeUndefined();
    const copied = snapshotKitItems([
      { itemId: 'stone', count: 32 },
      null as unknown as { itemId: string; count: number },
      { itemId: 'stone', count: 16 },
      { itemId: 'not_a_real_item', count: 4 },
      { itemId: ItemId.IronSword, count: 1, durability: 40 },
      { itemId: 'torch', count: 0 },
    ]);
    expect(copied).toEqual([
      { itemId: 'stone', count: 48 },
      { itemId: ItemId.IronSword, count: 1, durability: 40 },
    ]);
    const { service } = memoryService();
    expect(service.createFromStacks('nope name', copied).ok).toBe(false);
    expect(service.createFromStacks('help', copied).ok).toBe(false);
    expect(service.createFromStacks('a'.repeat(25), copied).ok).toBe(false);
    const created = service.createFromStacks('tools', copied);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.kit.items).toEqual(copied);
    expect(service.createFromStacks('tools', copied).ok).toBe(false);
    const empty = service.createFromStacks('empty', []);
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.kit.items).toEqual([]);
    expect(service.remove('missing').ok).toBe(false);
    expect(service.remove('tools').ok).toBe(true);
    expect(service.get('tools')).toBeUndefined();
  });

  it('saves a copied kit and reloads it', () => {
    const { service, saved } = memoryService();
    expect(service.createFromStacks('start', [
      { itemId: ItemId.Diamond, count: 64 },
      { itemId: ItemId.Diamond, count: 64 },
      { itemId: ItemId.IronIngot, count: 3 },
    ]).ok).toBe(true);
    const reloaded = memoryService(saved.value).service;
    expect(reloaded.get('start')?.items).toEqual([
      { itemId: ItemId.Diamond, count: 128 },
      { itemId: ItemId.IronIngot, count: 3 },
    ]);
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
    expect(service.createFromStacks('start', [{ itemId: ItemId.Diamond, count: 2 }]).ok).toBe(true);
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

  function fill(player: ServerPlayer, stacks: readonly { itemId: string; count: number; durability?: number }[]): void {
    player.inventory.clear();
    stacks.forEach((stack, index) => {
      player.inventory.setSlot(index, createItemStack(stack.itemId, stack.count, stack.durability !== undefined
        ? { durability: stack.durability }
        : {}));
    });
  }

  it('copies the creator inventory and gives start only once', async () => {
    const first = await boot();
    const world = first.world;
    const op = join(world, 'Op');
    const fresh = createStarterInventory();
    for (const itemId of ['dirt', 'cobblestone', 'oak_planks', 'stone', 'oak_log', 'apple'] as const) {
      expect(fresh.count(itemId)).toBe(0);
      expect(countItem(op.player, itemId)).toBe(0);
    }
    expect(chat(world, op, '/kit help').some((line) => line.includes('/kit create'))).toBe(true);
    fill(op.player, [
      { itemId: 'stone', count: 32 },
      { itemId: 'dirt', count: 16 },
      { itemId: ItemId.IronSword, count: 1 },
    ]);
    expect(chat(world, op, '/kit create tools').join('\n')).toContain('stone × 32');
    expect(countItem(op.player, 'stone')).toBe(32);
    expect(countItem(op.player, 'dirt')).toBe(16);
    expect(countItem(op.player, ItemId.IronSword)).toBe(1);
    expect(chat(world, op, '/kit create tools').some((line) => line.includes('уже существует'))).toBe(true);
    expect(chat(world, op, `/kit create ${'a'.repeat(25)}`).some((line) => line.includes('Некорректное имя'))).toBe(true);
    fill(op.player, []);
    expect(chat(world, op, '/kit create bare').some((line) => line.includes('пуст'))).toBe(true);

    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/kit create tools').some((line) => line.includes('прав'))).toBe(true);
    const adaStone = countItem(ada.player, 'stone');
    expect(chat(world, ada, '/kit tools').some((line) => line.includes('Выдан набор'))).toBe(true);
    expect(countItem(ada.player, 'stone')).toBe(adaStone + 32);
    expect(chat(world, ada, '/kit tools').some((line) => line.includes('Выдан набор'))).toBe(true);
    expect(countItem(ada.player, 'stone')).toBe(adaStone + 64);
    expect(chat(world, op, '/kit give Nobody tools').some((line) => line.includes('не найден'))).toBe(true);

    fill(op.player, [{ itemId: ItemId.Diamond, count: 3 }]);
    expect(chat(world, op, '/kit create start').join('\n')).toContain('diamond × 3');
    const bob = join(world, 'Bob');
    expect(countItem(bob.player, ItemId.Diamond)).toBe(3);
    expect(chat(world, bob, '/kit start').some((line) => line.includes('уже получен'))).toBe(true);
    world.events.emit('entityDeath', { entityId: bob.player.id, cause: 'melee', playerId: bob.player.id });
    expect(world.respawn(bob.player)).toBe(false);
    expect(countItem(bob.player, ItemId.Diamond)).toBe(3);
    const token = bob.player.sessionToken;
    world.disconnect(bob.player.id);
    const bobAgain = join(world, 'Bob', token);
    expect(bobAgain.resumed).toBe(true);
    expect(countItem(bobAgain.player, ItemId.Diamond)).toBe(3);

    for (let slot = 0; slot < ada.player.inventory.slots.length; slot += 1) {
      ada.player.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    }
    expect(chat(world, op, '/kit give Ada tools').some((line) => line.includes('выдан'))).toBe(true);
    expect(countItem(ada.player, 'cobblestone')).toBe(ada.player.inventory.slots.length * 64);
    const spilled = (itemId: string) => world.gameplay.drops.entities
      .filter((drop) => drop.stack.itemId === itemId)
      .reduce((sum, drop) => sum + drop.stack.count, 0);
    expect(spilled('stone')).toBe(32);
    expect(spilled('dirt')).toBe(16);
    expect(spilled(ItemId.IronSword)).toBe(1);

    world.disconnect(bobAgain.player.id);
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const restarted = await boot(first.dir);
    const bobRestarted = join(restarted.world, 'Bob', token);
    expect(countItem(bobRestarted.player, ItemId.Diamond)).toBe(3);
    expect(chat(restarted.world, bobRestarted, '/kit start').some((line) => line.includes('уже получен'))).toBe(true);
  });
});
