import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { Vec3 } from '../../src/math/vec3';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import {
  BLOCK_REWARDS,
  ECONOMY_INITIAL_BALANCE,
  ECONOMY_MAX_BALANCE,
  formatMegacoins,
} from '../../server/services/economy';
import { volumeFromCorners } from '../../server/services/selection';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-eco-plugin-'));
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

describe('Economy plugin', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dataDir?: string): Promise<WorldInstance> {
    const dir = dataDir ?? await tempDir();
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
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

  function breakNatural(world: WorldInstance, player: ReturnType<typeof join>, blockId: number): void {
    const x = Math.floor(player.player.controller.position.x) + 2;
    const y = Math.floor(player.player.controller.position.y);
    const z = Math.floor(player.player.controller.position.z);
    player.player.controller.teleport([x + 0.5, y, z + 0.5]);
    world.setGameMode(player.player, 'creative');
    world.world.setBlock(x, y, z, blockId);
    const result = world.gameplay.breakBlock(player.player, x, y, z);
    if (!result.ok) throw new Error(`break failed: ${result.reason}`);
  }

  it('shows /bal and /balance <player> in Russian', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    expect(chat(world, ada, '/bal')[0]).toBe(`Баланс: ${formatMegacoins(ECONOMY_INITIAL_BALANCE)}`);
    expect(chat(world, ada, '/balance Bob')[0]).toBe(`Баланс Bob: ${formatMegacoins(ECONOMY_INITIAL_BALANCE)}`);
    expect(chat(world, ada, '/balance Missing')[0]).toMatch(/не найден/);
  });

  it('pays another player, including an offline profile, and rejects self-pay', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.economy.deposit(ada.player.id, 500, 'ADMIN_GIVE');
    expect(chat(world, ada, '/pay Ada 10')[0]).toMatch(/самому себе/);
    expect(chat(world, ada, '/pay Bob 0')[0]).toMatch(/положительным/);
    expect(chat(world, ada, '/pay Bob 9999')[0]).toMatch(/Недостаточно/);
    const paid = chat(world, ada, '/pay Bob 500');
    expect(paid[0]).toBe('Вы перевели Bob 500 Мегакоинов.');
    expect(bob.sink.payloads.some((payload) => {
      const record = payload as { text?: string };
      return record.text === 'Bob получил 500 Мегакоинов от Ada.';
    })).toBe(true);
    expect(world.economy.getBalance(ada.player.id)).toBe(100);
    expect(world.economy.getBalance(bob.player.id)).toBe(600);

    world.disconnect(bob.player.id);
    world.economy.deposit(ada.player.id, 50, 'ADMIN_GIVE');
    expect(chat(world, ada, '/pay Bob 50')[0]).toBe('Вы перевели Bob 50 Мегакоинов.');
    expect(world.economy.getBalance(bob.player.id)).toBe(650);
  });

  it('lists baltop from current balances', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const steve = join(world, 'Steve');
    world.economy.setBalance(steve.player.id, 125_000, 'ADMIN_SET');
    world.economy.setBalance(ada.player.id, 98_500, 'ADMIN_SET');
    const lines = chat(world, ada, '/baltop');
    expect(lines[0]).toBe('Топ балансов:');
    expect(lines[1]).toBe('1. Steve — 125 000');
    expect(lines[2]).toBe('2. Ada — 98 500');
  });

  it('runs admin eco give/take/set/reset and transactions', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/eco give Ada 10')[0]).toMatch(/permission/);
    expect(chat(world, op, '/eco give Ada 1000')[0]).toMatch(/Выдано Ada 1 000 Мегакоинов/);
    expect(world.economy.getBalance(ada.player.id)).toBe(1100);
    expect(chat(world, op, '/eco take Ada 500')[0]).toMatch(/Снято Ada 500 Мегакоинов/);
    expect(chat(world, op, '/eco set Ada 25000')[0]).toMatch(/25 000 Мегакоинов/);
    expect(chat(world, op, '/eco reset Ada')[0]).toMatch(/сброшен: 100 Мегакоинов/);
    expect(world.economy.getBalance(ada.player.id)).toBe(100);
    expect(chat(world, op, '/eco balance Ada')[0]).toMatch(/Баланс Ada: 100 Мегакоинов/);
    const history = chat(world, ada, '/transactions');
    expect(history[0]).toBe('Последние транзакции:');
    expect(history.some((line) => line.includes('выдача') || line.includes('сброс') || line.includes('+') || line.includes('-'))).toBe(true);
    expect(chat(world, op, '/eco transactions Ada')[0]).toMatch(/История Ada/);
  });

  it('rewards natural blocks and not player-placed or TNT-destroyed blocks', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const before = world.economy.getBalance(ada.player.id);
    breakNatural(world, ada, BlockId.Stone);
    breakNatural(world, ada, BlockId.Dirt);
    breakNatural(world, ada, BlockId.Sand);
    breakNatural(world, ada, BlockId.Gravel);
    breakNatural(world, ada, BlockId.OakLog);
    breakNatural(world, ada, BlockId.CoalOre);
    breakNatural(world, ada, BlockId.DiamondOre);
    const expected = before
      + BLOCK_REWARDS[BlockId.Stone]!
      + BLOCK_REWARDS[BlockId.Dirt]!
      + BLOCK_REWARDS[BlockId.Sand]!
      + BLOCK_REWARDS[BlockId.Gravel]!
      + BLOCK_REWARDS[BlockId.OakLog]!
      + BLOCK_REWARDS[BlockId.CoalOre]!
      + BLOCK_REWARDS[BlockId.DiamondOre]!;
    expect(world.economy.getBalance(ada.player.id)).toBe(expected);

    const x = Math.floor(ada.player.controller.position.x) + 3;
    const y = Math.floor(ada.player.controller.position.y);
    const z = Math.floor(ada.player.controller.position.z);
    world.world.setBlock(x, y, z, BlockId.Air);
    ada.player.inventory.addItem('stone', 8);
    ada.player.selectedSlot = [...Array(9).keys()].find((slot) => ada.player.inventory.getSlot(slot)?.itemId === 'stone') ?? 0;
    world.events.emit('blockPlaced', { playerId: ada.player.id, x, y, z, blockId: BlockId.Stone });
    world.world.setBlock(x, y, z, BlockId.Stone);
    world.gameplay.breakBlock(ada.player, x, y, z);
    expect(world.economy.getBalance(ada.player.id)).toBe(expected);

    world.world.setBlock(x, y + 1, z, BlockId.DiamondOre);
    world.events.emit('blockBroken', { x, y: y + 1, z, blockId: BlockId.DiamondOre });
    expect(world.economy.getBalance(ada.player.id)).toBe(expected);
  });

  it('rewards AutoMine-generated blocks through the same EconomyService table', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const volume = volumeFromCorners({ x: 4, y: 40, z: 4 }, { x: 4, y: 40, z: 4 });
    const created = world.autoMine.create('ecomine', volume, world.worldId);
    if (!created.ok) throw new Error(created.error);
    for (let i = 0; i < 8; i += 1) world.tick();
    world.world.setBlock(4, 40, 4, BlockId.DiamondOre);
    world.economy.clearPlacedBlock(4, 40, 4);
    op.player.controller.teleport([4.5, 40, 4.5]);
    world.setGameMode(op.player, 'creative');
    const before = world.economy.getBalance(op.player.id);
    expect(world.gameplay.breakBlock(op.player, 4, 40, 4).ok).toBe(true);
    expect(world.economy.getBalance(op.player.id)).toBe(before + BLOCK_REWARDS[BlockId.DiamondOre]!);
  });

  it('rewards mob kills once and ignores unknown kinds', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const cow = world.gameplay.mobs.spawn('cow', new Vec3(
      ada.player.controller.position.x,
      ada.player.controller.position.y,
      ada.player.controller.position.z - 2,
    ), { force: true });
    const zombie = world.gameplay.mobs.spawn('zombie', new Vec3(
      ada.player.controller.position.x + 2,
      ada.player.controller.position.y,
      ada.player.controller.position.z,
    ), { force: true });
    if (!cow || !zombie) throw new Error('spawn failed');
    const before = world.economy.getBalance(ada.player.id);
    world.events.emit('entityDeath', {
      entityId: cow.id, cause: 'melee', playerId: ada.player.id, attackerId: ada.player.id, mobKind: 'cow',
    });
    world.events.emit('entityDeath', {
      entityId: cow.id, cause: 'melee', playerId: ada.player.id, attackerId: ada.player.id, mobKind: 'cow',
    });
    world.events.emit('entityDeath', {
      entityId: zombie.id, cause: 'melee', playerId: ada.player.id, attackerId: ada.player.id, mobKind: 'zombie',
    });
    world.events.emit('entityDeath', {
      entityId: 'ghost', cause: 'melee', playerId: ada.player.id, mobKind: 'wither',
    });
    expect(world.economy.getBalance(ada.player.id)).toBe(before + 4 + 10);
  });

  it('moves 10% on PvP, floors, and does not double-pay the same death', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const carl = join(world, 'Carl');
    world.economy.setBalance(bob.player.id, 57, 'ADMIN_SET');
    const adaBefore = world.economy.getBalance(ada.player.id);
    world.events.emit('entityDeath', {
      entityId: bob.player.id,
      cause: 'melee',
      playerId: bob.player.id,
      attackerId: ada.player.id,
    });
    expect(world.economy.getBalance(bob.player.id)).toBe(52);
    expect(world.economy.getBalance(ada.player.id)).toBe(adaBefore + 5);
    world.events.emit('entityDeath', {
      entityId: bob.player.id,
      cause: 'melee',
      playerId: bob.player.id,
      attackerId: ada.player.id,
    });
    expect(world.economy.getBalance(ada.player.id)).toBe(adaBefore + 5);
    world.economy.setBalance(bob.player.id, 200, 'ADMIN_SET');
    world.events.emit('entityDeath', {
      entityId: bob.player.id,
      cause: 'melee',
      playerId: bob.player.id,
      attackerId: carl.player.id,
    });
    expect(world.economy.getBalance(carl.player.id)).toBe(ECONOMY_INITIAL_BALANCE);
  });

  it('keeps balances after a server restart', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = await boot(dir);
    const ada = join(first, 'Ada');
    first.economy.deposit(ada.player.id, 250, 'ADMIN_GIVE');
    const token = ada.player.sessionToken;
    await first.stop();
    worlds.splice(worlds.indexOf(first), 1);
    const second = await boot(dir);
    const again = join(second, 'Ada', token);
    expect(second.economy.getBalance(again.player.id)).toBe(350);
    expect(second.economy.getTransactionHistory(again.player.id).some((tx) => tx.reason === 'ADMIN_GIVE')).toBe(true);
  });

  it('exposes a trader/auction-ready API without coupling to those plugins', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    expect(world.economy.withdraw(ada.player.id, 10, 'TRADER_PURCHASE').ok).toBe(true);
    expect(world.economy.deposit(ada.player.id, 15, 'TRADER_SELL').ok).toBe(true);
    expect(world.economy.withdraw(ada.player.id, 5, 'AUCTION_PURCHASE').ok).toBe(true);
    expect(world.economy.deposit(ada.player.id, 5, 'AUCTION_SALE').ok).toBe(true);
    expect(world.economy.getBalance(ada.player.id)).toBe(105);
    expect(ECONOMY_MAX_BALANCE).toBe(999_999_999);
  });
});
