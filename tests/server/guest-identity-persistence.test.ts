import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/config';
import type { ServerMessage } from '../../shared/protocol';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import type { ConnectedSink } from '../../server/WorldInstance';
import { FsWorldStore } from '../../server/FsWorldStore';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function memorySink(): ConnectedSink {
  return { send() {} };
}

function testConfig(dataDir: string, world = 'anarchy') {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: world,
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '600000',
    }, process.cwd()),
    dataDir,
    chunkViewRadius: 1,
    persistIntervalMs: 600_000,
  };
}

async function openWorld(dataDir: string, world = 'anarchy'): Promise<WorldInstance> {
  const instance = new WorldInstance(testConfig(dataDir, world));
  await instance.initialize();
  return instance;
}

async function durableJoin(world: WorldInstance, name: string, sessionToken?: string, freshGuest = false) {
  const result = await world.join({
    sink: memorySink(),
    name,
    ...(sessionToken ? { sessionToken } : {}),
    ...(freshGuest ? { freshGuest: true } : {}),
    durableFresh: true,
  });
  return result;
}

describe('guest identity persistence', () => {
  it('keeps the same player id, inventory, OP and home across a restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-guest-'));
    dirs.push(dataDir);
    const first = await openWorld(dataDir);
    const created = await durableJoin(first, 'Keeper');
    if ('error' in created) throw new Error(created.error);
    const playerId = created.player.id;
    const token = created.player.sessionToken;
    created.player.inventory.clear();
    created.player.inventory.addItem('diamond', 3);
    created.player.selectedSlot = 2;
    expect(first.permissions.op(playerId)).toBe(true);
    expect(first.homes.set(playerId, 'base', { worldId: first.worldId, x: 4, y: 5, z: 6 }, 4).ok).toBe(true);
    const friend = await durableJoin(first, 'Friend');
    if ('error' in friend) throw new Error(friend.error);
    expect(first.friends.request(playerId, 'Friend').ok).toBe(true);
    expect(first.friends.request(friend.player.id, 'Keeper').ok).toBe(true);
    expect(first.friends.isFriend(playerId, friend.player.id)).toBe(true);
    const playersBefore = JSON.parse(await readFile(join(dataDir, 'anarchy', 'players.json'), 'utf8')) as {
      players: Record<string, { sessionToken?: string }>;
    };
    expect(playersBefore.players[playerId]?.sessionToken).toBe(token);
    await first.stop();

    const second = await openWorld(dataDir);
    const resumed = await durableJoin(second, 'Keeper', token);
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.player.id).toBe(playerId);
    expect(resumed.player.sessionToken).toBe(token);
    expect(resumed.player.inventory.has('diamond', 3)).toBe(true);
    expect(resumed.player.selectedSlot).toBe(2);
    expect(second.permissions.isOperator(playerId)).toBe(true);
    expect(second.homes.get(playerId, 'base')?.x).toBe(4);
    expect(second.friends.isFriend(playerId, friend.player.id)).toBe(true);
    expect(Object.keys(JSON.parse(await readFile(join(dataDir, 'anarchy', 'players.json'), 'utf8')).players)).toEqual(
      expect.arrayContaining([playerId, friend.player.id]),
    );
    await second.stop();
  });

  it('does not mint a player for an unknown token', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-guest-'));
    dirs.push(dataDir);
    const world = await openWorld(dataDir);
    const created = await durableJoin(world, 'Ada');
    if ('error' in created) throw new Error(created.error);
    const before = await readFile(join(dataDir, 'anarchy', 'players.json'), 'utf8');
    const denied = await durableJoin(world, 'Ada', '11111111-1111-4111-8111-111111111111');
    expect(denied).toMatchObject({ code: 'unknown_guest' });
    expect(world.players.size).toBe(1);
    expect(await readFile(join(dataDir, 'anarchy', 'players.json'), 'utf8')).toBe(before);
    expect(created.player.inventory.has('diamond', 1)).toBe(false);
    await world.stop();
  });

  it('does not welcome a new guest when the first save fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-guest-'));
    dirs.push(dataDir);
    const world = await openWorld(dataDir);
    const existing = await durableJoin(world, 'Old');
    if ('error' in existing) throw new Error(existing.error);
    const store = (world as unknown as { worldStore: FsWorldStore }).worldStore;
    const original = store.savePlayers.bind(store);
    store.savePlayers = async () => {
      throw new Error('disk full');
    };
    const failed = await durableJoin(world, 'New');
    expect(failed).toMatchObject({ code: 'identity_unavailable' });
    expect(world.players.has(existing.player.id)).toBe(true);
    expect([...world.players.values()].some((player) => player.name === 'New')).toBe(false);
    store.savePlayers = original;
    const disk = JSON.parse(await readFile(join(dataDir, 'anarchy', 'players.json'), 'utf8')) as {
      players: Record<string, { name?: string }>;
    };
    expect(Object.values(disk.players).map((row) => row.name)).toEqual(['Old']);
    await world.stop();
  });

  it('does not copy OP or a home to another player with the same nickname', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-guest-'));
    dirs.push(dataDir);
    const world = await openWorld(dataDir);
    const owner = await durableJoin(world, 'XASAN');
    const other = await durableJoin(world, 'XASAN');
    if ('error' in owner || 'error' in other) throw new Error('join failed');
    expect(owner.player.id).not.toBe(other.player.id);
    world.permissions.op(owner.player.id);
    expect(world.homes.set(owner.player.id, 'base', { worldId: world.worldId, x: 9, y: 8, z: 7 }, 4).ok).toBe(true);
    await world.stop();
    const restarted = await openWorld(dataDir);
    const resumed = await durableJoin(restarted, 'XASAN', other.player.sessionToken);
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.player.id).toBe(other.player.id);
    expect(restarted.permissions.isOperator(resumed.player.id)).toBe(false);
    expect(restarted.permissions.isOperator(owner.player.id)).toBe(true);
    expect(restarted.homes.list(resumed.player.id)).toEqual([]);
    expect(restarted.homes.get(owner.player.id, 'base')?.x).toBe(9);
    await restarted.stop();
  });

  it('resumes one id for two joins with the same token', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-guest-'));
    dirs.push(dataDir);
    const world = await openWorld(dataDir);
    const first = await durableJoin(world, 'Solo');
    if ('error' in first) throw new Error(first.error);
    first.player.inventory.addItem('diamond', 2);
    const left = world.join({ sink: memorySink(), name: 'Solo', sessionToken: first.player.sessionToken });
    if ('error' in left) throw new Error('resume failed');
    const staleConnection = left.player.connectionId;
    const right = world.join({ sink: memorySink(), name: 'Solo', sessionToken: first.player.sessionToken });
    if ('error' in right) throw new Error('resume failed');
    expect(left.player.id).toBe(first.player.id);
    expect(right.player.id).toBe(first.player.id);
    expect(world.players.size).toBe(1);
    expect(right.player.inventory.has('diamond', 2)).toBe(true);
    world.disconnect(first.player.id, true, staleConnection);
    expect(right.player.connected).toBe(true);
    await world.stop();
  });

  it('writes the guest before welcome and restores it without the periodic save', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-guest-'));
    dirs.push(dataDir);
    const server = new AnarchyServer(testConfig(dataDir));
    await server.start();
    const welcome = await new Promise<Extract<ServerMessage, { type: 'welcome' }>>((resolve, reject) => {
      const socket = new WebSocket(server.wsUrl());
      const messages: ServerMessage[] = [];
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, name: 'Early' }));
      });
      socket.on('message', (data) => {
        const message = JSON.parse(String(data)) as ServerMessage;
        messages.push(message);
        if (message.type === 'welcome' || message.type === 'error') {
          socket.close();
          if (message.type === 'welcome') resolve(message);
          else reject(new Error(message.message));
        }
      });
      socket.on('error', reject);
    });
    const disk = JSON.parse(await readFile(join(dataDir, 'anarchy', 'players.json'), 'utf8')) as {
      players: Record<string, { sessionToken?: string }>;
    };
    expect(disk.players[welcome.playerId]?.sessionToken).toBe(welcome.sessionToken);
    await server.stop();
    const restarted = await openWorld(dataDir);
    const resumed = await durableJoin(restarted, 'Early', welcome.sessionToken);
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.player.id).toBe(welcome.playerId);
    await restarted.stop();
  });

  it('rotates only the selected player credential offline', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-guest-'));
    dirs.push(dataDir);
    const world = await openWorld(dataDir);
    const keeper = await durableJoin(world, 'Keeper');
    const other = await durableJoin(world, 'Other');
    if ('error' in keeper || 'error' in other) throw new Error('join failed');
    keeper.player.inventory.addItem('diamond', 4);
    const keeperId = keeper.player.id;
    const otherToken = other.player.sessionToken;
    await world.stop();
    const worldDir = join(dataDir, 'anarchy');
    const dry = await runNode(['scripts/recover-guest.mjs', 'rotate', '--world', worldDir, '--player', keeperId]);
    expect(dry.code).toBe(0);
    expect(dry.out).not.toContain('recovery-token:');
    const applied = await runNode(['scripts/recover-guest.mjs', 'rotate', '--world', worldDir, '--player', keeperId, '--apply']);
    expect(applied.code).toBe(0);
    const tokenLine = applied.out.split('\n').find((line) => line.startsWith('recovery-token: '));
    const nextToken = tokenLine?.slice('recovery-token: '.length).trim();
    expect(nextToken && nextToken !== keeper.player.sessionToken).toBe(true);
    const disk = JSON.parse(await readFile(join(worldDir, 'players.json'), 'utf8')) as {
      players: Record<string, { sessionToken?: string; inventory?: { slots?: unknown[] } }>;
    };
    expect(disk.players[keeperId]?.sessionToken).toBe(nextToken);
    expect(disk.players[other.player.id]?.sessionToken).toBe(otherToken);
    expect(JSON.stringify(disk.players[keeperId]?.inventory)).toContain('diamond');
    const restarted = await openWorld(dataDir);
    const old = await durableJoin(restarted, 'Keeper', keeper.player.sessionToken);
    expect(old).toMatchObject({ code: 'unknown_guest' });
    const recovered = await durableJoin(restarted, 'Keeper', nextToken);
    if ('error' in recovered) throw new Error(recovered.error);
    expect(recovered.player.id).toBe(keeperId);
    expect(recovered.player.inventory.has('diamond', 4)).toBe(true);
    await restarted.stop();
  });
});

function runNode(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd() });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}
