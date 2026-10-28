import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { readItemInstanceId } from '../../src/inventory/itemInstance';
import { ItemId } from '../../src/items';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, createStarterInventory, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import { RANK_LIMITS } from '../../shared/donationRanks';

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
      FC_OPERATORS: 'Ada',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Ada'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function lines(sink: MemorySink): string[] {
  const out: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) out.push(...record.lines);
    if (record.type === 'chat' && record.text) out.push(record.text);
  }
  return out;
}

describe('main merged onto the anti-dupe branch', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-merge-'));
    dirs.push(dataDir);
    const world = new WorldInstance(testConfig(dataDir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function enter(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const joined = world.join({ sink, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in joined) throw new Error(joined.error);
    return { ...joined, sink };
  }

  function chat(world: WorldInstance, player: ReturnType<typeof enter>, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return lines(player.sink);
  }

  it('ignores a nickname in FC_OPERATORS and keeps OP on the UUID', async () => {
    const world = await boot();
    const ada = enter(world, 'Ada');
    const copy = enter(world, 'Ada');
    expect(world.permissions.isOperator(ada.player.id)).toBe(false);
    expect(world.permissions.isOperator('Ada')).toBe(false);
    expect(world.permissions.ignoredOperators()).toContain('Ada');
    expect(chat(world, ada, '/kit create tools').some((line) => line.includes('прав'))).toBe(true);
    world.permissions.op(ada.player.id);
    expect(world.permissions.isOperator(ada.player.id)).toBe(true);
    expect(world.permissions.isOperator(copy.player.id)).toBe(false);
    expect(chat(world, copy, '/time set day').some((line) => line.includes('прав'))).toBe(true);
  });

  it('keeps a donation rank on the UUID and does not grant OP', async () => {
    const world = await boot();
    const ada = enter(world, 'Ada');
    const other = enter(world, 'Ada');
    world.permissions.op(enter(world, 'Op').player.id);
    world.donation.grant(ada.player.id, 'titan');
    expect(world.donation.effectiveRank(ada.player.id)).toBe('titan');
    expect(world.donation.limit(ada.player.id, 'auction')).toBe(RANK_LIMITS.titan.auction);
    expect(world.permissions.has(ada.player.id, 'server.admin')).toBe(false);
    expect(world.permissions.has(ada.player.id, 'donate.rank.titan')).toBe(true);
    expect(world.donation.effectiveRank(other.player.id)).toBe('default');
    ada.player.name = 'Renamed';
    expect(world.donation.effectiveRank(ada.player.id)).toBe('titan');
    expect(world.donation.effectiveRank(other.player.id)).toBe('default');
  });

  it('accounts a kit diamond grant once and mints a new God Sword id', async () => {
    const world = await boot();
    const op = enter(world, 'Op');
    world.permissions.op(op.player.id);
    op.player.inventory.clear();
    op.player.inventory.setSlot(0, createItemStack(ItemId.Diamond, 16));
    op.player.inventory.setSlot(1, createItemStack(ItemId.GodSword, 1));
    expect(chat(world, op, '/kit create prize').join('\n')).toContain('diamond');
    op.player.inventory.clear();
    const ada = enter(world, 'Ada');
    const bob = enter(world, 'Bob');
    expect(chat(world, ada, '/kit prize').some((line) => line.includes('Выдан набор'))).toBe(true);
    expect(ada.player.inventory.count(ItemId.Diamond)).toBe(16);
    const minted = (world as unknown as { resources: { minted: Record<string, number> } }).resources.minted;
    expect(minted.diamond).toBe(16);
    expect(chat(world, bob, '/kit prize').some((line) => line.includes('Выдан набор'))).toBe(true);
    expect(minted.diamond).toBe(32);
    const first = readItemInstanceId(ada.player.inventory.slots.find((stack) => stack?.itemId === ItemId.GodSword));
    const second = readItemInstanceId(bob.player.inventory.slots.find((stack) => stack?.itemId === ItemId.GodSword));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('gives the starter kit once and keeps cosmetic and receipt state', async () => {
    expect(createStarterInventory().count(ItemId.Diamond)).toBe(0);
    const world = await boot();
    const op = enter(world, 'Op');
    world.permissions.op(op.player.id);
    op.player.inventory.clear();
    op.player.inventory.setSlot(0, createItemStack(ItemId.Apple, 4));
    expect(chat(world, op, '/kit create start').join('\n')).toContain('apple');
    const ada = enter(world, 'Ada');
    expect(ada.player.inventory.count(ItemId.Apple)).toBe(4);
    const token = ada.player.sessionToken;
    ada.player.cosmeticPet = 'bee';
    ada.player.settlementReceipts.add('item:test-receipt');
    const playerId = ada.player.id;
    const dir = world.config.dataDir;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = new WorldInstance(testConfig(dir));
    worlds.push(again);
    await again.initialize();
    await again.loadPlugins();
    await again.plugins.enableAll();
    const resumed = enter(again, 'Ada', token);
    expect(resumed.player.id).toBe(playerId);
    expect(resumed.player.inventory.count(ItemId.Apple)).toBe(4);
    expect(resumed.player.cosmeticPet).toBe('bee');
    expect(resumed.player.settlementReceipts.has('item:test-receipt')).toBe(true);
    expect(chat(again, resumed, '/kit start').some((line) => line.includes('уже получен'))).toBe(true);
    expect(resumed.player.inventory.count(ItemId.Apple)).toBe(4);
  });
});
