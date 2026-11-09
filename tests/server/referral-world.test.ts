import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { PROTOCOL_VERSION } from '../../shared/config';
import type { ServerMenuMessage, ServerMessage } from '../../shared/protocol';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig } from '../../server/config';
import { MemoryReferralRepository } from '../../server/referral/memoryRepository';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';

const dirs: string[] = [];
const worlds: WorldInstance[] = [];
const servers: AnarchyServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
  for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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
      PERSIST_INTERVAL_MS: '600000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 600_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function countItem(player: ServerPlayer, itemId: string): number {
  let total = 0;
  for (const stack of player.inventory.slots) {
    if (stack?.itemId === itemId) total += stack.count;
  }
  return total;
}

async function boot(repo: MemoryReferralRepository, dataDir?: string): Promise<WorldInstance> {
  const dir = dataDir ?? await mkdtemp(join(tmpdir(), 'fc-referral-world-'));
  if (!dataDir) dirs.push(dir);
  const world = new WorldInstance(testConfig(dir), { referralRepository: repo });
  worlds.push(world);
  await world.initialize();
  await world.loadPlugins();
  await world.plugins.enableAll();
  return world;
}

function enter(world: WorldInstance, name: string, sessionToken?: string) {
  const sink = new MemorySink();
  const result = world.join({ sink, name, sessionToken });
  if ('error' in result) throw new Error(result.error);
  return { ...result, sink };
}

async function settle(): Promise<void> {
  for (let step = 0; step < 30; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function menu(world: WorldInstance, player: ReturnType<typeof enter>, message: {
  action: 'open' | 'referral_accept' | 'referral_claim' | 'referral_refresh';
  screen?: 'friends-invites';
  name?: string;
}): Promise<ServerMenuMessage> {
  player.sink.payloads.length = 0;
  world.handleMenuAction(player.player, { type: 'menu_action', ...message });
  for (let step = 0; step < 50; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const found = [...player.sink.payloads].reverse().find((payload) => {
      const record = payload as { type?: string; screen?: string };
      return record.type === 'menu' && record.screen === 'friends-invites';
    }) as ServerMenuMessage | undefined;
    if (found?.referral) return found;
  }
  const seen = player.sink.payloads.map((payload) => {
    const record = payload as { type?: string; screen?: string; message?: string };
    return `${record.type ?? '?'}:${record.screen ?? ''}:${record.message ?? ''}`;
  });
  throw new Error(`referral menu was not sent (${seen.join(' | ')})`);
}

async function chat(world: WorldInstance, player: ReturnType<typeof enter>, text: string): Promise<string[]> {
  player.sink.payloads.length = 0;
  world.handleChat(player.player, text);
  await settle();
  const lines: string[] = [];
  for (const payload of player.sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text && record.text !== text) lines.push(record.text);
  }
  return lines;
}

describe('referral world integration', () => {
  it('accepts a code, gives referral_starter once, and keeps it after restart', async () => {
    const repo = new MemoryReferralRepository();
    const dir = await mkdtemp(join(tmpdir(), 'fc-referral-world-'));
    dirs.push(dir);
    const world = await boot(repo, dir);
    const ada = enter(world, 'Ada');
    const misha = enter(world, 'Misha');
    const opened = await menu(world, ada, { action: 'open', screen: 'friends-invites' });
    expect(opened.referral?.available).toBe(true);
    expect(opened.referral?.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(opened.referral?.activityNote).toContain('Анархии');
    const friends = await chat(world, ada, '/kit help');
    expect(friends.join('\n')).toContain('/kit');

    const accepted = await menu(world, misha, { action: 'referral_accept', name: opened.referral?.code });
    expect(accepted.message).toContain('Ada');
    expect(accepted.referral?.invitedBy).toBe('Ada');
    expect(accepted.referral?.kit.detail).toContain('Ожидает настройки');

    world.pluginStore.save('kit/store', {
      kits: [{ name: 'referral_starter', items: [{ itemId: 'stone', count: 4 }] }],
      receivedStart: [],
      pendingStart: [],
    });
    const before = countItem(misha.player, 'stone');
    const claimed = await menu(world, misha, { action: 'referral_claim' });
    expect(claimed.message).toBe('Стартовый набор получен.');
    expect(countItem(misha.player, 'stone')).toBe(before + 4);
    const again = await menu(world, misha, { action: 'referral_claim' });
    expect(again.message).toBe('Стартовый набор уже получен.');
    expect(countItem(misha.player, 'stone')).toBe(before + 4);

    const disk = JSON.parse(await readFile(join(dir, 'anarchy', 'players.json'), 'utf8')) as {
      players: Record<string, { referralKitReceipts?: string[]; inventory?: unknown }>;
    };
    expect(disk.players[misha.player.id]?.referralKitReceipts?.length).toBe(1);
    expect(JSON.stringify(disk.players[misha.player.id]?.inventory)).toContain('stone');

    const denied = await chat(world, misha, '/referral dev addtime Ada 10800');
    expect(denied.join('\n')).toContain('Недостаточно прав');
    world.permissions.op(ada.player.id);
    const devOff = await chat(world, ada, '/referral dev addtime Misha 60');
    expect(devOff.join('\n')).toContain('выключена');

    const token = misha.player.sessionToken;
    const id = misha.player.id;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const restarted = await boot(repo, dir);
    const back = enter(restarted, 'Misha', token);
    expect(back.player.id).toBe(id);
    expect(countItem(back.player, 'stone')).toBe(before + 4);
    const replay = await menu(restarted, back, { action: 'referral_claim' });
    expect(replay.message).toBe('Стартовый набор уже получен.');
    expect(countItem(back.player, 'stone')).toBe(before + 4);
  }, 120_000);

  it('leaves a full inventory pending and does not drop the kit', async () => {
    const repo = new MemoryReferralRepository();
    const world = await boot(repo);
    const ada = enter(world, 'Ada');
    const misha = enter(world, 'Misha');
    const opened = await menu(world, ada, { action: 'open', screen: 'friends-invites' });
    await menu(world, misha, { action: 'referral_accept', name: opened.referral?.code });
    world.pluginStore.save('kit/store', {
      kits: [{ name: 'referral_starter', items: [{ itemId: 'stone', count: 1 }] }],
      receivedStart: [],
      pendingStart: [],
    });
    for (let slot = 0; slot < misha.player.inventory.slots.length; slot += 1) {
      misha.player.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    }
    const claimed = await menu(world, misha, { action: 'referral_claim' });
    expect(claimed.message).toContain('Освободите место');
    expect(countItem(misha.player, 'stone')).toBe(0);
    expect(countItem(misha.player, 'cobblestone')).toBe(misha.player.inventory.slots.length * 64);
    expect(misha.player.referralKitReceipts.size).toBe(0);
  }, 120_000);
});

describe('referral resource recovery', () => {
  it('restores a monitored kit grant once after the ledger file is lost', async () => {
    const repo = new MemoryReferralRepository();
    const dir = await mkdtemp(join(tmpdir(), 'fc-referral-resource-'));
    dirs.push(dir);
    const world = await boot(repo, dir);
    const ada = enter(world, 'Ada');
    const misha = enter(world, 'Misha');
    const opened = await menu(world, ada, { action: 'open', screen: 'friends-invites' });
    await menu(world, misha, { action: 'referral_accept', name: opened.referral?.code });
    world.pluginStore.save('kit/store', {
      kits: [{ name: 'referral_starter', items: [{ itemId: ItemId.Diamond, count: 3 }, { itemId: 'stone', count: 2 }] }],
      receivedStart: [],
      pendingStart: [],
    });
    const before = countItem(misha.player, ItemId.Diamond);
    const claimed = await menu(world, misha, { action: 'referral_claim' });
    expect(claimed.message).toBe('Стартовый набор получен.');
    expect(countItem(misha.player, ItemId.Diamond)).toBe(before + 3);
    const ledgerPath = join(dir, 'anarchy', 'plugin-data', 'resource-accounting.json');
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as { minted: Record<string, number>; sourceKeys: string[] };
    const granted = ledger.minted[ItemId.Diamond] ?? 0;
    expect(granted).toBeGreaterThanOrEqual(3);
    const receipt = [...misha.player.referralKitReceipts][0];
    const reduced = granted - 3;
    ledger.minted[ItemId.Diamond] = reduced;
    ledger.sourceKeys = ledger.sourceKeys.filter((key) => !key.includes(receipt ?? 'missing'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    const token = misha.player.sessionToken;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const restarted = await boot(repo, dir);
    const back = enter(restarted, 'Misha', token);
    expect(countItem(back.player, ItemId.Diamond)).toBe(before + 3);
    const again = JSON.parse(await readFile(ledgerPath, 'utf8')) as { minted: Record<string, number> };
    expect(again.minted[ItemId.Diamond] ?? 0).toBe(reduced + 3);
    const replay = await menu(restarted, back, { action: 'referral_claim' });
    expect(replay.message).toBe('Стартовый набор уже получен.');
    expect(countItem(back.player, ItemId.Diamond)).toBe(before + 3);
    const afterReplay = JSON.parse(await readFile(ledgerPath, 'utf8')) as { minted: Record<string, number> };
    expect(afterReplay.minted[ItemId.Diamond] ?? 0).toBe(again.minted[ItemId.Diamond] ?? 0);
  }, 120_000);
});

describe('referral websocket', () => {
  it('joins, shows a code, and accepts it on another socket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-referral-ws-'));
    dirs.push(dir);
    const repo = new MemoryReferralRepository();
    const server = new AnarchyServer(testConfig(dir), { referralRepository: repo });
    servers.push(server);
    await server.start();

    const ada = await play(server, 'Ada');
    ada.socket.send(JSON.stringify({ type: 'menu_action', action: 'not_real' }));
    const opened = await waitMenu(ada.socket, () => {
      ada.socket.send(JSON.stringify({ type: 'menu_action', action: 'open', screen: 'friends-invites' }));
    });
    expect(opened.referral?.code).toBeTruthy();
    const misha = await play(server, 'Misha');
    const accepted = await waitMenu(misha.socket, () => {
      misha.socket.send(JSON.stringify({
        type: 'menu_action',
        action: 'referral_accept',
        name: opened.referral?.code,
      }));
    });
    expect(accepted.message).toContain('Ada');
    expect(accepted.referral?.invitedBy).toBe('Ada');
    ada.socket.close();
    misha.socket.close();
  }, 120_000);
});

function play(server: AnarchyServer, name: string): Promise<{ socket: WebSocket; welcome: Extract<ServerMessage, { type: 'welcome' }> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(server.wsUrl());
    const timer = setTimeout(() => reject(new Error(`join timeout ${name}`)), 20_000);
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === 'welcome') {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve({ socket, welcome: message });
      } else if (message.type === 'error') {
        clearTimeout(timer);
        socket.off('message', onMessage);
        reject(new Error(message.message));
      }
    };
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, name }));
    });
    socket.on('message', onMessage);
  });
}

function waitMenu(socket: WebSocket, send: () => void): Promise<ServerMenuMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('menu timeout')), 15_000);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === 'menu' && message.screen === 'friends-invites' && message.referral) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(message);
      }
    };
    socket.on('message', onMessage);
    send();
  });
}
