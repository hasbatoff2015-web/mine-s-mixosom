import { writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDailyRewardsPlugin } from '../../server/builtin-plugins/dailyRewards';
import type { BuiltinPluginContext } from '../../server/builtin-plugins/context';
import { CommandRegistry, createConsoleCommandSender, type CommandResult, type CommandSender } from '../../server/commands';
import type { CurrencyPort } from '../../server/economy/currencyPort';
import type { DailyRewardPortResult } from '../../server/economy/dailyReward';
import { EventBus } from '../../server/events';
import { PluginManager, type PlayerView } from '../../server/PluginManager';
import { JsonFileStore } from '../../server/services/jsonStore';
import { PermissionService } from '../../server/services/permissions';
import { PluginConfigService } from '../../server/services/pluginConfig';

interface Harness {
  readonly events: EventBus;
  readonly plugins: PluginManager;
  readonly players: Array<PlayerView & { messages: string[]; connected: boolean }>;
  readonly calls: Array<{ playerId: string; claimDate: string; series: readonly number[] }>;
  readonly deposits: unknown[];
  readonly dir: string;
  instant: Date;
  setResult(result: DailyRewardPortResult | (() => DailyRewardPortResult | Promise<DailyRewardPortResult>)): void;
  idle(): Promise<void>;
  dispatch(raw: string, sender?: CommandSender): Promise<CommandResult>;
}

async function harness(backend: 'postgres' | 'legacy_json' = 'postgres', sweepMs = 60_000): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-daily-'));
  const store = new JsonFileStore(dir);
  const permissions = new PermissionService(store, []);
  permissions.load();
  const events = new EventBus();
  const commands = new CommandRegistry();
  commands.setPermissionCheck((sender, permission) => {
    if (sender.kind === 'console' || sender.hasPermission?.(permission) === true) return true;
    if (permission === 'operator') return permissions.isOperator(sender.playerId);
    return permissions.has(sender.playerId, permission);
  });
  const plugins = new PluginManager(events, commands);
  const players: Harness['players'] = [];
  const calls: Harness['calls'] = [];
  const pending: Promise<unknown>[] = [];
  const deposits: unknown[] = [];
  let nextResult: DailyRewardPortResult | (() => DailyRewardPortResult | Promise<DailyRewardPortResult>) = {
    ok: true,
    outcome: 'claimed',
    amount: 77,
    streakDay: 1,
    claimDate: '2026-11-09',
    balance: 177,
  };
  const economy = {
    backend,
    getBalance: () => 0,
    hasBalance: () => false,
    displayName: (playerId: string) => playerId,
    getKills: () => 0,
    rememberName: () => undefined,
    deposit: (...args: unknown[]) => {
      deposits.push(args);
      throw new Error('json deposit must not run');
    },
    withdraw: () => ({ ok: false }),
    transfer: () => ({ ok: false }),
    settle: () => ({ ok: false }),
    setBalance: () => ({ ok: false }),
    resetBalance: () => ({ ok: false }),
    rewardBlockBreak: () => ({ ok: false }),
    rewardMobKill: () => ({ ok: false }),
    rewardPlayerKill: () => ({ ok: false }),
    recordPvpKill: () => ({ ok: false, kills: 0 }),
    getTransactionHistory: () => [],
    getTopBalances: () => [],
    rankPlayers: () => [],
    markPlacedBlock: () => undefined,
    isPlacedBlock: () => false,
    clearPlacedBlock: () => undefined,
    clearPlacedCells: () => undefined,
    persistPlaced: () => undefined,
    load: () => undefined,
    persist: () => undefined,
    track: (work: Promise<unknown>) => {
      pending.push(work);
    },
    hasEconomicSource: async () => false,
    claimDailyReward: async (input: { playerId: string; claimDate: string; series: readonly number[] }) => {
      calls.push({ playerId: input.playerId, claimDate: input.claimDate, series: input.series });
      const produced = typeof nextResult === 'function' ? await nextResult() : nextResult;
      return { ...produced, claimDate: input.claimDate };
    },
  };
  if (backend !== 'postgres') delete (economy as { claimDailyReward?: unknown }).claimDailyReward;
  const config = new PluginConfigService(store);
  plugins.attachHost({
    status: () => ({
      worldId: 'world',
      seed: '1',
      readyState: 'READY',
      tickRate: 20,
      tickNumber: 0,
      playerCount: players.length,
      pluginApiVersion: 1,
    }),
    world: () => {
      throw new Error('daily rewards do not touch the world');
    },
    players: () => players,
    player: (idOrName: string) => players.find((entry) => entry.id === idOrName || entry.name.toLowerCase() === idOrName.toLowerCase()),
    broadcast: () => undefined,
    permissions: () => permissions,
    config: () => config,
  });
  const state: Harness = {
    events,
    plugins,
    players,
    calls,
    deposits,
    dir,
    instant: new Date('2026-11-09T20:59:50.000Z'),
    setResult: (result) => {
      nextResult = result;
    },
    idle: async () => {
      while (pending.length > 0) await Promise.all(pending.splice(0));
    },
    dispatch: async (raw, sender = createConsoleCommandSender()) => {
      const result = commands.dispatch(raw, sender).result;
      if (!result) return { ok: false, lines: ['missing'] };
      return result;
    },
  };
  const ctx = {
    economy: economy as unknown as CurrencyPort,
    serverMode: 'survival',
  } as BuiltinPluginContext;
  plugins.register(createDailyRewardsPlugin(ctx, { now: () => state.instant, sweepMs }));
  await plugins.enableAll();
  return state;
}

function player(id: string, name: string): PlayerView & { messages: string[]; connected: boolean } {
  const messages: string[] = [];
  return {
    id,
    name,
    connected: true,
    gamemode: 'survival',
    messages,
    health: () => 20,
    position: () => ({ x: 0, y: 64, z: 0 }),
    snapshot: () => {
      throw new Error('unused');
    },
    teleport: () => false,
    sendMessage: (text: string) => {
      messages.push(text);
    },
    give: () => ({ given: 0, leftover: 0 }),
    contents: () => [],
    removeItem: () => 0,
    clearInventory: () => 0,
    hasItem: () => false,
    kick: () => undefined,
  };
}

describe('daily rewards plugin', () => {
  const dirs: string[] = [];
  const open: PluginManager[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    for (const plugins of open.splice(0)) await plugins.disableAll();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('stays off on the JSON backend and does not deposit', async () => {
    const world = await harness('legacy_json');
    dirs.push(world.dir);
    open.push(world.plugins);
    const status = await world.dispatch('/dailyreward status');
    expect(status.lines.join('\n')).toContain('legacy_json');
    expect(status.lines.join('\n')).toContain('недоступно: нужен backend PostgreSQL');
    expect(status.lines.join('\n')).toContain('survival');
    expect(status.lines.join('\n')).toContain('Europe/Moscow');
    expect((await world.dispatch('/dailyreward set 1 50')).ok).toBe(true);
    const enabled = await world.dispatch('/dailyreward enable');
    expect(enabled.ok).toBe(false);
    expect(enabled.lines.join('\n')).toContain('PostgreSQL');
    const ada = player('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ada');
    world.players.push(ada);
    world.events.emit('playerJoin', { playerId: ada.id, name: ada.name, firstJoin: false });
    await world.idle();
    expect(world.calls).toEqual([]);
    expect(world.deposits).toEqual([]);
    expect(ada.messages).toEqual([]);
  });

  it('refuses a player without dailyreward.manage and accepts the console', async () => {
    const world = await harness();
    dirs.push(world.dir);
    open.push(world.plugins);
    const stranger: CommandSender = {
      kind: 'player',
      playerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Bea',
      gamemode: 'survival',
    };
    const denied = await world.dispatch('/dailyreward set 1 50', stranger);
    expect(denied.ok).toBe(false);
    expect(denied.lines[0]).toContain('Недостаточно прав');
    expect((await world.dispatch('/dailyreward set 1 50')).ok).toBe(true);
    expect((await world.dispatch('/dailyreward set 3 100')).ok).toBe(false);
    expect((await world.dispatch('/dailyreward set 2 80')).lines.join('\n')).toContain('День 2');
    const series = await world.dispatch('/dailyreward series');
    expect(series.lines).toEqual(['День 1: 50 Мегакоинов', 'День 2: 80 Мегакоинов']);
    expect((await world.dispatch('/dailyreward enable')).ok).toBe(true);
    const status = await world.dispatch('/dailyreward status');
    expect(status.lines.join('\n')).toContain('postgres');
    expect(status.lines.join('\n')).toContain('Готовность: готова');
    expect((await world.dispatch('/dailyreward disable')).lines.join('\n')).toContain('выключены');
  });

  it('does not pay from a damaged series until an admin replaces day 1', async () => {
    const world = await harness();
    dirs.push(world.dir);
    open.push(world.plugins);
    await writeFile(join(world.dir, 'config', 'daily-rewards.json'), `${JSON.stringify({
      enabled: true,
      seriesJson: '{bad',
    }, null, 2)}\n`);
    await world.plugins.reload('daily-rewards');
    const ada = player('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Ada');
    world.players.push(ada);
    world.events.emit('playerJoin', { playerId: ada.id, name: ada.name, firstJoin: true });
    await world.idle();
    expect(world.calls).toEqual([]);
    const status = await world.dispatch('/dailyreward status');
    expect(status.lines.join('\n')).toContain('повреждена');
    expect((await world.dispatch('/dailyreward enable')).ok).toBe(false);
    const replaced = await world.dispatch('/dailyreward set 1 40');
    expect(replaced.lines.join('\n')).toContain('Повреждённая серия заменена');
    expect((await world.dispatch('/dailyreward enable')).ok).toBe(true);
  });

  it('announces the committed amount once and retries a balance limit without marking the day', async () => {
    const world = await harness();
    dirs.push(world.dir);
    open.push(world.plugins);
    expect((await world.dispatch('/dailyreward set 1 50')).ok).toBe(true);
    expect((await world.dispatch('/dailyreward enable')).ok).toBe(true);
    const ada = player('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Ada');
    world.players.push(ada);
    world.setResult({ ok: false, reason: 'balance_limit' });
    world.events.emit('playerJoin', { playerId: ada.id, name: ada.name, firstJoin: false });
    await world.idle();
    expect(world.calls).toHaveLength(1);
    expect(ada.messages).toEqual(['Ежедневная награда не выдана: достигнут максимальный баланс.']);
    world.events.emit('playerJoin', { playerId: ada.id, name: ada.name, firstJoin: false });
    await world.idle();
    expect(ada.messages.filter((line) => line.includes('максимальный баланс'))).toHaveLength(1);
    world.setResult({
      ok: true,
      outcome: 'claimed',
      amount: 77,
      streakDay: 4,
      claimDate: '2026-11-09',
      balance: 177,
    });
    world.events.emit('playerJoin', { playerId: ada.id, name: ada.name, firstJoin: false });
    await world.idle();
    expect(ada.messages).toContain('🎁 Ежедневная награда получена!');
    expect(ada.messages).toContain('День серии: 4');
    expect(ada.messages).toContain('Начислено: 77 Мегакоинов.');
    const beforeReplay = ada.messages.length;
    const callsBeforeReplay = world.calls.length;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      world.events.emit('playerJoin', { playerId: ada.id, name: ada.name, firstJoin: false });
    }
    await world.idle();
    expect(ada.messages).toHaveLength(beforeReplay);
    expect(world.calls).toHaveLength(callsBeforeReplay);
  });

  it('pays a player who stays online after Moscow midnight and an offline player on the next join', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const world = await harness('postgres', 10_000);
    dirs.push(world.dir);
    open.push(world.plugins);
    await world.dispatch('/dailyreward set 1 50');
    await world.dispatch('/dailyreward set 2 90');
    await world.dispatch('/dailyreward enable');
    const online = player('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Online');
    const offline = player('abababab-abab-4aba-8aba-abababababab', 'Offline');
    world.players.push(online);
    world.setResult({
      ok: true,
      outcome: 'claimed',
      amount: 50,
      streakDay: 1,
      claimDate: '2026-11-09',
      balance: 150,
    });
    world.events.emit('playerJoin', { playerId: online.id, name: online.name, firstJoin: false });
    await world.idle();
    expect(world.calls.map((call) => call.claimDate)).toEqual(['2026-11-09']);
    world.instant = new Date('2026-11-09T21:00:05.000Z');
    world.setResult({
      ok: true,
      outcome: 'claimed',
      amount: 90,
      streakDay: 2,
      claimDate: '2026-11-10',
      balance: 240,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await world.idle();
    expect(world.calls.map((call) => `${call.playerId}:${call.claimDate}`)).toContain(`${online.id}:2026-11-10`);
    expect(world.calls.some((call) => call.playerId === offline.id)).toBe(false);
    expect(online.messages).toContain('День серии: 2');
    expect(online.messages).toContain('Начислено: 90 Мегакоинов.');
    world.players.push(offline);
    world.events.emit('playerJoin', { playerId: offline.id, name: offline.name, firstJoin: false });
    await world.idle();
    expect(world.calls.filter((call) => call.playerId === offline.id).map((call) => call.claimDate)).toEqual(['2026-11-10']);
  });

  it('does not message a player who disconnects and clears timers on disable and reload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const world = await harness('postgres', 10_000);
    dirs.push(world.dir);
    open.push(world.plugins);
    await world.dispatch('/dailyreward set 1 50');
    await world.dispatch('/dailyreward enable');
    const ada = player('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Ada');
    world.players.push(ada);
    let release: (result: DailyRewardPortResult) => void = () => undefined;
    world.setResult(() => new Promise<DailyRewardPortResult>((resolve) => {
      release = resolve;
    }));
    world.events.emit('playerJoin', { playerId: ada.id, name: ada.name, firstJoin: false });
    await Promise.resolve();
    ada.connected = false;
    release({
      ok: true,
      outcome: 'claimed',
      amount: 50,
      streakDay: 1,
      claimDate: '2026-11-09',
      balance: 150,
    });
    await world.idle();
    expect(ada.messages).toEqual([]);
    expect(world.calls).toHaveLength(1);
    const frozen = world.calls.length;
    await world.plugins.disable('daily-rewards');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(world.calls).toHaveLength(frozen);
    ada.connected = true;
    world.setResult({
      ok: true,
      outcome: 'already_claimed',
      amount: 50,
      streakDay: 1,
      claimDate: '2026-11-09',
      balance: 150,
    });
    await world.plugins.reload('daily-rewards');
    await vi.advanceTimersByTimeAsync(10_000);
    await world.idle();
    const afterReload = world.calls.length;
    expect(afterReload).toBe(frozen + 1);
    expect(ada.messages).toEqual([]);
    await vi.advanceTimersByTimeAsync(20_000);
    await world.idle();
    expect(world.calls).toHaveLength(afterReload);
  });
});
