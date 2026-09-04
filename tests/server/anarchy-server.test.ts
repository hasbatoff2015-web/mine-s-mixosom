import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/config';
import { parseClientMessage, parseServerMessage, type ClientInputMessage, type ServerMessage } from '../../shared/protocol';
import { BlockId } from '../../src/blocks';
import { PLAYER_EYE_HEIGHT, PLAYER_NET_REACH } from '../../src/core/constants';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { SaveService } from '../../src/save/SaveService';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import { createItemStack } from '../../src/inventory';
import type { Plugin, ServerAPI } from '../../server/PluginManager';
import { inputSeqAfterReconnect } from '../../src/core/onlineSession';
import { captureBlockHitIntent, captureBowRelease } from '../../src/net/playerActions';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-anarchy-'));
}

function testConfig(dataDir: string, port = 0) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: String(port),
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
  };
}

class TestClient {
  readonly messages: ServerMessage[] = [];
  private socket: WebSocket | undefined;

  async connect(url: string, extra?: { name?: string; sessionToken?: string }): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
    const socket = new WebSocket(url);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.on('message', (data) => {
      this.messages.push(JSON.parse(String(data)) as ServerMessage);
    });
    this.send({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      ...(extra?.name ? { name: extra.name } : {}),
      ...(extra?.sessionToken ? { sessionToken: extra.sessionToken } : {}),
    });
    return this.waitFor('welcome');
  }

  send(payload: unknown): void {
    this.socket?.send(JSON.stringify(payload));
  }

  async waitFor<T extends ServerMessage['type']>(type: T, timeoutMs = 5000): Promise<Extract<ServerMessage, { type: T }>> {
    const existing = this.messages.find((message) => message.type === type);
    if (existing) return existing as Extract<ServerMessage, { type: T }>;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      const timer = setInterval(() => {
        const found = this.messages.find((message) => message.type === type);
        if (!found) return;
        clearInterval(timer);
        clearTimeout(timeout);
        resolve(found as Extract<ServerMessage, { type: T }>);
      }, 10);
    });
  }

  async waitForMatch<T extends ServerMessage['type']>(
    type: T,
    match: (message: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const existing = this.messages.find((message) => message.type === type && match(message as Extract<ServerMessage, { type: T }>));
    if (existing) return existing as Extract<ServerMessage, { type: T }>;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      const timer = setInterval(() => {
        const found = this.messages.find((message) => message.type === type && match(message as Extract<ServerMessage, { type: T }>));
        if (!found) return;
        clearInterval(timer);
        clearTimeout(timeout);
        resolve(found as Extract<ServerMessage, { type: T }>);
      }, 10);
    });
  }

  latest<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return [...this.messages].reverse().find((message) => message.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }

  close(): void {
    this.socket?.close();
  }
}

function lookAngles(
  from: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  const dx = x + 0.5 - from.x;
  const dy = y + 0.5 - (from.y + PLAYER_EYE_HEIGHT);
  const dz = z + 0.5 - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function moveInput(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input',
    seq,
    forward: 0,
    right: 0,
    jump: false,
    sneak: false,
    sprint: false,
    descend: false,
    flySprint: false,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    ...extra,
  };
}

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

describe('protocol validation', () => {
  it('rejects unknown message types and malformed action intents', () => {
    expect(parseClientMessage({ type: 'explode_world' })).toEqual({ error: 'unknown message type explode_world' });
    expect(parseClientMessage({ type: 'interact' })).toEqual({ error: 'unknown message type interact' });
    expect(parseClientMessage({ type: 'break_block', x: 1, y: 2, z: 3 })).toEqual({ error: 'unknown message type break_block' });
    expect(parseClientMessage({ type: 'place_block', x: 1, y: 2, z: 3 })).toEqual({ error: 'unknown message type place_block' });
    expect(parseClientMessage({
      type: 'block_use', actionSeq: 1, commandSeq: 2, selectedSlot: 3,
      targetX: 1, targetY: 2, targetZ: 3, targetBlockId: BlockId.Stone,
      faceX: 0, faceY: 1, faceZ: 0, hitX: 1.5, hitY: 3, hitZ: 3.5,
    })).toMatchObject({ type: 'block_use', actionSeq: 1, commandSeq: 2, selectedSlot: 3 });
    expect(parseClientMessage({
      type: 'block_use', actionSeq: 1, commandSeq: 1, selectedSlot: 0,
      targetX: 1.5, targetY: 2, targetZ: 3, targetBlockId: BlockId.Stone,
      faceX: 0, faceY: 1, faceZ: 0, hitX: 1.5, hitY: 3, hitZ: 3.5,
    })).toEqual({
      error: 'block_use block intent invalid',
    });
    expect(parseClientMessage({ type: 'inventory_action', action: 'yeet' })).toEqual({ error: 'inventory_action.action invalid' });
    expect(parseClientMessage({ type: 'attack' })).toEqual({ type: 'attack' });
    expect(parseClientMessage({ type: 'input', seq: 1, forward: 99, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false, yaw: 0, pitch: 0, selectedSlot: 3 })).toMatchObject({
      type: 'input',
      forward: 1,
      selectedSlot: 3,
    });
  });

  it('rejects unknown and malformed server messages instead of swallowing them', () => {
    expect(parseServerMessage({ type: 'teleport_all' })).toEqual({ error: 'unknown message type teleport_all' });
    expect(parseServerMessage({ type: 'player_state', tick: 1.5, players: [] })).toEqual({ error: 'player_state invalid' });
    expect(parseServerMessage({ type: 'block_result', ok: true, action: 'break', x: 1, y: 2, z: 3 })).toEqual({
      error: 'unknown message type block_result',
    });
  });
});

describe('local authoritative Anarchy server', { timeout: 20_000 }, () => {
  const servers: AnarchyServer[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<AnarchyServer> {
    const dir = await tempDir();
    dirs.push(dir);
    const server = new AnarchyServer(testConfig(dir));
    servers.push(server);
    await server.start();
    return server;
  }

  it('starts, loads Anarchy, and serves status', async () => {
    const server = await boot();
    expect(server.world.readyState).toBe('READY');
    expect(server.world.seed).toBe(ANARCHY_WORLD_SEED);
    const response = await fetch(`http://127.0.0.1:${server.port}/status`);
    const status = await response.json() as { ready: boolean; world: string; online: number };
    expect(status.ready).toBe(true);
    expect(status.world).toBe('anarchy');
    expect(status.online).toBe(0);
  });

  it('assigns authoritative spawn on join and resumes without duplicates', async () => {
    const server = await boot();
    const client = new TestClient();
    const welcome = await client.connect(server.wsUrl(), { name: 'Alpha' });
    expect(welcome.you.x).toBeCloseTo(server.world.spawn[0], 5);
    expect(welcome.you.y).toBeCloseTo(server.world.spawn[1], 5);
    expect(welcome.you.z).toBeCloseTo(server.world.spawn[2], 5);
    expect(welcome.seed).toBe(ANARCHY_WORLD_SEED);
    expect(server.world.onlineCount()).toBe(1);
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.world.onlineCount()).toBe(0);
    const resumed = new TestClient();
    const second = await resumed.connect(server.wsUrl(), { name: 'Alpha', sessionToken: welcome.sessionToken });
    expect(second.playerId).toBe(welcome.playerId);
    expect(server.world.onlineCount()).toBe(1);
    resumed.close();
  });

  it('live resume kicks the old socket and ignores its movement', async () => {
    const server = await boot();
    const first = new TestClient();
    const welcome = await first.connect(server.wsUrl(), { name: 'Alpha' });
    const second = new TestClient();
    const resumed = await second.connect(server.wsUrl(), { name: 'Alpha', sessionToken: welcome.sessionToken });
    expect(resumed.playerId).toBe(welcome.playerId);
    expect(server.world.onlineCount()).toBe(1);
    expect(server.activeSocketCount(welcome.playerId)).toBe(1);
    await first.waitForMatch('error', (message) => message.code === 'session_taken');

    const origin = server.world.players.get(welcome.playerId)!.controller.position.clone();
    first.send({
      type: 'input',
      seq: 1,
      forward: 1,
      right: 0,
      jump: false,
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      yaw: 0,
      pitch: 0,
      selectedSlot: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const afterStale = server.world.players.get(welcome.playerId)!.controller.position.clone();
    expect(afterStale.distanceTo(origin)).toBeLessThan(0.01);

    second.send({
      type: 'input',
      seq: 1,
      forward: 1,
      right: 0,
      jump: false,
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      yaw: 0,
      pitch: 0,
      selectedSlot: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterLive = server.world.players.get(welcome.playerId)!.controller.position.clone();
    expect(afterLive.distanceTo(origin)).toBeGreaterThan(0.05);

    first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.world.onlineCount()).toBe(1);
    expect(server.activeSocketCount(welcome.playerId)).toBe(1);
    second.close();
  });

  it('lets two clients see each other, movement, break and place', async () => {
    const server = await boot();
    const a = new TestClient();
    const b = new TestClient();
    const welcomeA = await a.connect(server.wsUrl(), { name: 'A' });
    const welcomeB = await b.connect(server.wsUrl(), { name: 'B' });
    expect(welcomeB.players.some((player) => player.id === welcomeA.playerId)).toBe(true);
    await a.waitFor('player_joined');
    expect(a.latest('player_joined')?.player.id).toBe(welcomeB.playerId);

    const start = { x: welcomeA.you.x, z: welcomeA.you.z };
    a.send({
      type: 'input',
      seq: 1,
      forward: 1,
      right: 0,
      jump: false,
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      yaw: 0,
      pitch: 0,
      selectedSlot: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const moved = b.latest('player_state')?.players.find((player) => player.id === welcomeA.playerId);
    expect(moved).toBeDefined();
    expect(Math.hypot((moved?.x ?? 0) - start.x, (moved?.z ?? 0) - start.z)).toBeGreaterThan(0.05);

    a.send({ type: 'chat', text: '/gamemode creative' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const serverPlayer = server.world.players.get(welcomeA.playerId)!;
    serverPlayer.inventory.setSlot(0, createItemStack('dirt', 64));
    const eye = serverPlayer.controller.eyePosition();
    const targetX = Math.floor(eye.x);
    const targetY = Math.floor(eye.y);
    const targetZ = Math.floor(eye.z) - 3;
    for (let z = targetZ; z <= Math.floor(eye.z); z += 1) {
      server.world.world.setBlock(targetX, targetY, z, BlockId.Air);
    }
    server.world.world.setBlock(targetX, targetY, targetZ, BlockId.Stone);
    let seq = 2;
    const placeLook = lookAngles(serverPlayer.controller.position, targetX, targetY, targetZ);
    const placeCommandSeq = seq;
    a.send(moveInput(placeCommandSeq, placeLook));
    seq += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const placeHit = server.world.world.raycast(
      serverPlayer.controller.eyePosition(),
      serverPlayer.controller.viewDirection(),
      PLAYER_NET_REACH,
    );
    expect(placeHit).toMatchObject({ x: targetX, y: targetY, z: targetZ });
    const px = placeHit!.x + placeHit!.normal.x;
    const py = placeHit!.y + placeHit!.normal.y;
    const pz = placeHit!.z + placeHit!.normal.z;
    server.world.world.setBlock(px, py, pz, BlockId.Air);
    a.send({
      type: 'block_use', actionSeq: 1, commandSeq: placeCommandSeq, selectedSlot: 0,
      ...captureBlockHitIntent(placeHit!),
    });
    await a.waitForMatch('action_result', (message) => message.actionSeq === 1 && message.action === 'block_use' && message.ok);
    expect(server.world.world.getBlock(px, py, pz)).toBe(BlockId.Dirt);
    expect(a.messages.some((message) => message.type === 'block_update' && message.x === px && message.y === py && message.z === pz && message.blockId === BlockId.Dirt)).toBe(true);
    expect(b.messages.some((message) => message.type === 'block_update' && message.x === px && message.y === py && message.z === pz && message.blockId === BlockId.Dirt)).toBe(true);

    const breakLook = lookAngles(serverPlayer.controller.position, px, py, pz);
    const breakCommandSeq = seq;
    a.send(moveInput(breakCommandSeq, { ...breakLook, mining: true }));
    seq += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const breakHit = server.world.world.raycast(
      serverPlayer.controller.eyePosition(),
      serverPlayer.controller.viewDirection(),
      PLAYER_NET_REACH,
    );
    expect(breakHit).toMatchObject({ x: px, y: py, z: pz });
    const breakIntent = captureBlockHitIntent(breakHit!);
    a.send({ type: 'break_start', actionSeq: 2, commandSeq: breakCommandSeq, selectedSlot: 0, ...breakIntent });
    await a.waitForMatch('action_result', (message) => message.actionSeq === 2 && message.ok);
    await a.waitForMatch('block_update', (message) => message.x === px && message.y === py && message.z === pz && message.blockId === BlockId.Air);
    expect(server.world.world.getBlock(px, py, pz)).toBe(BlockId.Air);
    expect(b.messages.some((message) => message.type === 'block_update' && message.x === px && message.y === py && message.z === pz && message.blockId === BlockId.Air)).toBe(true);

    server.world.world.setBlock(px + 80, py, pz, BlockId.Dirt);
    a.send({
      type: 'break_start', actionSeq: 3, commandSeq: breakCommandSeq, selectedSlot: 0,
      targetX: px + 80, targetY: py, targetZ: pz, targetBlockId: BlockId.Dirt,
      faceX: 0, faceY: 1, faceZ: 0,
      hitX: px + 80.5, hitY: py + 1, hitZ: pz + 0.5,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.world.world.getBlock(px + 80, py, pz)).toBe(BlockId.Dirt);
    expect(b.messages.some((message) => message.type === 'block_update'
      && message.x === px + 80 && message.y === py && message.z === pz && message.blockId === BlockId.Air)).toBe(false);
    expect(a.latest('action_result')).toMatchObject({ ok: false, action: 'break_start', reason: 'reach' });

    a.send({ type: 'chat', text: 'hello anarchy' });
    await b.waitFor('chat');
    expect(b.latest('chat')?.text).toBe('hello anarchy');

    a.close();
    b.close();
  });

  it('persists block changes across restart', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = new AnarchyServer(testConfig(dir));
    servers.push(first);
    await first.start();
    const client = new TestClient();
    const welcome = await client.connect(first.wsUrl(), { name: 'Builder' });
    client.send({ type: 'chat', text: '/gamemode creative' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const player = first.world.players.get(welcome.playerId)!;
    player.inventory.setSlot(0, createItemStack('cobblestone', 64));
    const eye = player.controller.eyePosition();
    const supportX = Math.floor(eye.x);
    const supportY = Math.floor(eye.y);
    const supportZ = Math.floor(eye.z) - 3;
    for (let lineZ = supportZ; lineZ <= Math.floor(eye.z); lineZ += 1) {
      first.world.world.setBlock(supportX, supportY, lineZ, BlockId.Air);
    }
    first.world.world.setBlock(supportX, supportY, supportZ, BlockId.Stone);
    const look = lookAngles(player.controller.position, supportX, supportY, supportZ);
    client.send(moveInput(1, look));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const hit = first.world.world.raycast(
      player.controller.eyePosition(),
      player.controller.viewDirection(),
      PLAYER_NET_REACH,
    );
    if (!hit) throw new Error('persistence target missing');
    const x = hit.x + hit.normal.x;
    const y = hit.y + hit.normal.y;
    const z = hit.z + hit.normal.z;
    first.world.world.setBlock(x, y, z, BlockId.Air);
    client.send({
      type: 'block_use', actionSeq: 1, commandSeq: 1, selectedSlot: 0,
      ...captureBlockHitIntent(hit),
    });
    await client.waitForMatch('action_result', (message) => message.ok && message.action === 'block_use');
    expect(first.world.world.getBlock(x, y, z)).toBe(BlockId.Cobblestone);
    client.close();
    await first.stop();
    servers.pop();

    const second = new AnarchyServer(testConfig(dir));
    servers.push(second);
    await second.start();
    expect(second.world.world.getBlock(x, y, z)).toBe(BlockId.Cobblestone);
    const again = new TestClient();
    const restored = await again.connect(second.wsUrl());
    const keyMods = Object.values(restored.modifications).some((chunk) => Object.values(chunk).includes(BlockId.Cobblestone));
    expect(keyMods).toBe(true);
    again.close();
  });

  it('exposes a plugin API without leaking the runtime', async () => {
    const server = await boot();
    let loaded: ServerAPI | undefined;
    const plugin: Plugin = {
      name: 'test-kit',
      onLoad(api) {
        loaded = api;
      },
      onEnable(api) {
        api.registerCommand({
          name: 'ping-plugin',
          usage: '/ping-plugin',
          description: 'plugin ping',
          execute: () => ({ ok: true, lines: ['pong'] }),
        });
      },
    };
    server.world.plugins.register(plugin);
    expect(loaded).toBeDefined();
    expect(Reflect.ownKeys(loaded!)).toEqual([
      'apiVersion',
      'getStatus',
      'getWorld',
      'getPlayers',
      'getPlayer',
      'broadcast',
      'registerCommand',
      'registerEvent',
      'scheduleOnce',
      'scheduleRepeating',
      'log',
    ]);
    expect(loaded!.apiVersion).toBe(1);
    await server.world.plugins.whenReady();
    expect((loaded as unknown as { world?: unknown }).world).toBeUndefined();
    expect((loaded as unknown as { runtime?: unknown }).runtime).toBeUndefined();
    const client = new TestClient();
    await client.connect(server.wsUrl());
    client.send({ type: 'chat', text: '/ping-plugin' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.messages.some((message) => message.type === 'chat' && message.text === 'pong')).toBe(true);
    const spawn = server.world.spawn;
    const tx = Math.floor(spawn[0]) + 3;
    const ty = Math.floor(spawn[1]);
    const tz = Math.floor(spawn[2]) + 3;
    expect(loaded!.getWorld().setBlock(tx, ty, tz, BlockId.Stone)).toBe(true);
    expect(server.world.world.getBlock(tx, ty, tz)).toBe(BlockId.Stone);
    client.close();
  });

  it('does not treat IndexedDB Anarchy as the online authority', async () => {
    const saves = new SaveService();
    await saves.saveWorld({
      schemaVersion: 1,
      summary: {
        id: 'anarchy',
        name: 'Анархия',
        seed: 'client-only',
        mode: 'survival',
        kind: 'server',
        createdAt: 1,
        updatedAt: 1,
        playTimeSeconds: 0,
      },
      timeOfDay: 0,
      weather: 'clear',
      player: {
        position: [1, 2, 3],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        health: 20,
        hunger: 20,
        saturation: 5,
        selectedSlot: 0,
        inventory: { version: 1, slots: Array.from({ length: 36 }, () => null), armor: { head: null, chest: null, legs: null, feet: null }, offhand: null },
      },
      modifications: { '0,0': { '1': BlockId.DiamondBlock } },
      chests: {},
      furnaces: {},
      droppedItems: [],
    });
    await saves.saveWorld({
      schemaVersion: 1,
      summary: {
        id: 'sp-keep',
        name: 'Одиночный',
        seed: 'sp',
        mode: 'survival',
        createdAt: 1,
        updatedAt: 1,
        playTimeSeconds: 0,
      },
      timeOfDay: 0,
      weather: 'clear',
      player: {
        position: [0.5, 70, 0.5],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        health: 20,
        hunger: 20,
        saturation: 5,
        selectedSlot: 0,
        inventory: { version: 1, slots: Array.from({ length: 36 }, () => null), armor: { head: null, chest: null, legs: null, feet: null }, offhand: null },
      },
      modifications: {},
      chests: {},
      furnaces: {},
      droppedItems: [],
    });
    const server = await boot();
    expect(server.world.seed).toBe(ANARCHY_WORLD_SEED);
    expect(server.world.world.serializeModifications()['0,0']?.['1']).not.toBe(BlockId.DiamondBlock);
    const list = await saves.listWorlds();
    expect(list.some((world) => world.id === 'sp-keep')).toBe(true);
    expect(list.some((world) => world.id === 'anarchy')).toBe(false);
  });
});

describe('WorldInstance foundation simulation', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function bootWorld(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    return world;
  }

  function join(world: WorldInstance, name = 'Sim'): ReturnType<WorldInstance['join']> {
    return world.join({ sink: new MemorySink(), name });
  }

  it('applies one input once per tick and ignores duplicate or stale seq', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const start = player.controller.position.clone();
    expect(world.applyInput(player, moveInput(1, { forward: 1 }))).toBe(true);
    world.tick();
    const afterFirst = player.controller.position.clone();
    expect(Math.hypot(afterFirst.x - start.x, afterFirst.z - start.z)).toBeGreaterThan(0.05);

    expect(world.applyInput(player, moveInput(1, { forward: 0 }))).toBe(false);
    expect(player.lastInput.forward).toBe(1);
    expect(world.applyInput(player, moveInput(0, { forward: 0 }))).toBe(false);
    expect(player.lastInputSeq).toBe(1);

    const beforeHeld = player.controller.position.clone();
    world.tick();
    expect(player.lastInput.seq).toBe(1);
    expect(Math.hypot(
      player.controller.position.x - beforeHeld.x,
      player.controller.position.z - beforeHeld.z,
    )).toBeGreaterThan(0.01);

    expect(world.applyInput(player, moveInput(2, { forward: 0 }))).toBe(true);
    expect(player.lastInput.forward).toBe(0);
    expect(player.lastInputSeq).toBe(2);
    world.tick();
    expect(player.lastInputSeq).toBe(2);
    expect(player.snapshot().inputSeq).toBe(2);
  });

  it('uses the latest movement state when multiple inputs arrive between ticks', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const start = player.controller.position.clone();
    expect(world.applyInput(player, moveInput(1, { forward: 1 }))).toBe(true);
    expect(world.applyInput(player, moveInput(2, { forward: 1 }))).toBe(true);
    expect(world.applyInput(player, moveInput(3, { forward: 1 }))).toBe(true);
    expect(player.lastInputSeq).toBe(3);
    expect(player).not.toHaveProperty('inputQueue');

    world.tick();
    expect(player.snapshot().inputSeq).toBe(3);
    const afterBurst = player.controller.position.clone();
    const firstStep = Math.hypot(afterBurst.x - start.x, afterBurst.z - start.z);
    expect(firstStep).toBeGreaterThan(0.05);
    expect(firstStep).toBeLessThan(0.35);

    world.tick();
    expect(player.snapshot().inputSeq).toBe(3);
    expect(Math.hypot(
      player.controller.position.x - afterBurst.x,
      player.controller.position.z - afterBurst.z,
    )).toBeGreaterThan(0.05);
  });

  it('catch-up simulates two physics ticks but broadcasts one player_state', async () => {
    const world = await bootWorld();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Sim' });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const start = player.controller.position.clone();
    world.applyInput(player, moveInput(1, { forward: 1 }));
    const beforeStates = sink.payloads.filter((payload) => (payload as { type?: string }).type === 'player_state').length;
    world.tickCatchUp(2);
    const after = Math.hypot(
      player.controller.position.x - start.x,
      player.controller.position.z - start.z,
    );
    expect(after).toBeGreaterThan(0.12);
    expect(after).toBeLessThan(0.55);
    const states = sink.payloads.filter((payload) => (payload as { type?: string }).type === 'player_state');
    expect(states.length - beforeStates).toBe(1);
    const last = states[states.length - 1] as {
      tick: number;
      physicsTicks?: number;
      players: Array<{ inputSeq: number }>;
    };
    expect(last.players[0]?.inputSeq).toBe(1);
    expect(last.physicsTicks).toBe(2);
  });

  it('sends applied movement rows only to their owning client', async () => {
    const world = await bootWorld();
    const sinkA = new MemorySink();
    const sinkB = new MemorySink();
    const a = world.join({ sink: sinkA, name: 'A' });
    const b = world.join({ sink: sinkB, name: 'B' });
    if ('error' in a || 'error' in b) throw new Error('join failed');
    world.applyInput(a.player, moveInput(1, { forward: 1 }));
    world.applyInput(b.player, moveInput(1, { right: 1 }));
    world.tick();
    const latest = (sink: MemorySink) => [...sink.payloads].reverse().find((payload) => (
      (payload as { type?: string }).type === 'player_state'
    )) as { players: Array<{ id: string; appliedTicks?: unknown[] }> };
    const stateA = latest(sinkA);
    const stateB = latest(sinkB);
    expect(stateA.players.find((player) => player.id === a.player.id)?.appliedTicks).toHaveLength(1);
    expect(stateA.players.find((player) => player.id === b.player.id)?.appliedTicks).toBeUndefined();
    expect(stateB.players.find((player) => player.id === b.player.id)?.appliedTicks).toHaveLength(1);
    expect(stateB.players.find((player) => player.id === a.player.id)?.appliedTicks).toBeUndefined();
  });

  it('predsim reports identical lockstep controllers and a coalesce gap', async () => {
    const world = await bootWorld();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Sim' });
    if ('error' in joined) throw new Error(joined.error);
    world.handleChat(joined.player, '/predsim 5');
    const result = [...sink.payloads].reverse().find((payload) => (
      payload as { type?: string }).type === 'command_result'
    ) as { ok: boolean; lines: string[] } | undefined;
    expect(result?.ok).toBe(true);
    expect(result?.lines.some((line) => line.includes('identical=yes'))).toBe(true);
    expect(result?.lines.some((line) => line.includes('coalesce clientTicks=2'))).toBe(true);
  });

  it('does not backlog 64 movement packets across seconds', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const start = player.controller.position.clone();
    for (let seq = 1; seq <= 64; seq += 1) {
      expect(world.applyInput(player, moveInput(seq, { forward: 1 }))).toBe(true);
    }
    world.tick();
    expect(player.snapshot().inputSeq).toBe(64);
    const afterOne = Math.hypot(
      player.controller.position.x - start.x,
      player.controller.position.z - start.z,
    );
    expect(afterOne).toBeGreaterThan(0.05);
    expect(afterOne).toBeLessThan(0.35);
  });

  it('stops on the latest idle packet instead of draining leftover walk inputs', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    for (let seq = 1; seq <= 8; seq += 1) {
      world.applyInput(player, moveInput(seq, { forward: 1 }));
      world.tick();
    }
    for (let seq = 9; seq <= 20; seq += 1) {
      world.applyInput(player, moveInput(seq, { forward: seq === 20 ? 0 : 1 }));
    }
    world.tick();
    expect(player.lastInput.forward).toBe(0);
    expect(player.snapshot().inputSeq).toBe(20);
    const before = player.controller.position.clone();
    world.tick();
    expect(Math.hypot(
      player.controller.position.x - before.x,
      player.controller.position.z - before.z,
    )).toBeLessThan(0.08);
  });

  it('latches a jump pulse that arrives before later non-jump packets in the same window', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const startY = player.controller.position.y;
    expect(world.applyInput(player, moveInput(1, { jump: true }))).toBe(true);
    expect(world.applyInput(player, moveInput(2, { jump: false, forward: 1 }))).toBe(true);
    world.tick();
    expect(player.controller.position.y).toBeGreaterThan(startY + 0.2);
  });

  it('fires a charged bow from an explicit release action, not an inferred input edge', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    player.inventory.setSlot(0, createItemStack('bow', 1));
    player.inventory.setSlot(1, createItemStack('arrow', 16));
    player.selectedSlot = 0;
    player.bowUseTicks = 1;
    for (let seq = 1; seq <= 8; seq += 1) {
      world.applyInput(player, moveInput(seq, { use: true }));
      world.tick();
    }
    expect(player.bowUseTicks).toBeGreaterThan(3);
    const arrowsBefore = world.gameplay.arrows.count;
    for (let seq = 9; seq <= 48; seq += 1) {
      world.applyInput(player, moveInput(seq, { forward: 1, use: seq < 48 }));
    }
    world.tick();
    expect(player.lastInput.use).toBe(false);
    expect(world.bowRelease(player, captureBowRelease(
      { actionSeq: 1, commandSeq: 48, selectedSlot: 0 },
      player.controller.yaw,
      player.controller.pitch,
    ))).toEqual({ ok: true });
    expect(player.bowUseTicks).toBe(0);
    expect(world.gameplay.arrows.count).toBeGreaterThan(arrowsBefore);
  });

  it('starts bow charge on interact immediately, before the next movement tick', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    player.inventory.setSlot(0, createItemStack('bow', 1));
    player.selectedSlot = 0;
    player.controller.pitch = -Math.PI / 2;
    for (let seq = 1; seq <= 12; seq += 1) {
      world.applyInput(player, moveInput(seq, { forward: 1, use: false }));
    }
    expect(player.bowUseTicks).toBe(0);
    expect(world.useItem(player, { actionSeq: 1, commandSeq: 12, selectedSlot: 0 })).toEqual({ ok: true });
    expect(player.bowUseTicks).toBeGreaterThan(0);
    const charged = player.bowUseTicks;
    world.applyInput(player, moveInput(13, { forward: 1, use: true }));
    expect(player.bowUseTicks).toBe(charged);
    world.tick();
    expect(player.bowUseTicks).toBe(charged + 1);
    expect(player.snapshot().inputSeq).toBe(13);
  });

  it('applies latest creative flight and SHIFT descend once per tick', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    world.applyInput(player, moveInput(1, { jump: true }));
    world.tick();
    world.applyInput(player, moveInput(2, { jump: false }));
    world.tick();
    world.applyInput(player, moveInput(3, { jump: true }));
    world.tick();
    expect(player.controller.isFlying).toBe(true);
    const startY = player.controller.position.y;
    for (let seq = 4; seq <= 11; seq += 1) {
      world.applyInput(player, moveInput(seq, { forward: 1, jump: true }));
    }
    world.tick();
    expect(player.snapshot().inputSeq).toBe(11);
    expect(player.controller.isFlying).toBe(true);
    const afterUp = player.controller.position.clone();
    expect(afterUp.y).toBeGreaterThan(startY + 0.05);

    for (let seq = 12; seq <= 19; seq += 1) {
      world.applyInput(player, moveInput(seq, { forward: 1, descend: true }));
    }
    world.tick();
    expect(player.snapshot().inputSeq).toBe(19);
    const afterFirstDescend = player.controller.position.y;
    world.tick();
    expect(player.snapshot().inputSeq).toBe(19);
    expect(player.controller.position.y).toBeLessThan(afterFirstDescend);
  });

  it('accepts a valid break, mutates the world, and rejects air/reach/bounds', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const origin = [
      Math.floor(player.controller.position.x),
      Math.floor(player.controller.position.y),
      Math.floor(player.controller.position.z),
    ] as const;
    let target: readonly [number, number, number] | undefined;
    for (let y = origin[1]; y >= origin[1] - 4 && !target; y -= 1) {
      for (let dx = -2; dx <= 2 && !target; dx += 1) {
        for (let dz = -2; dz <= 2 && !target; dz += 1) {
          const x = origin[0] + dx;
          const z = origin[2] + dz;
          const block = world.world.getBlock(x, y, z);
          if (block !== BlockId.Air) target = [x, y, z];
        }
      }
    }
    expect(target).toBeDefined();
    const [x, y, z] = target!;
    world.setGameMode(player, 'creative');
    const before = world.world.getBlock(x, y, z);
    expect(world.tryBreak(player, x, y, z)).toEqual({ ok: true });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(before).not.toBe(BlockId.Air);

    expect(world.tryBreak(player, x, y, z)).toEqual({ ok: false, reason: 'empty' });
    expect(world.tryBreak(player, x + 80, y, z)).toEqual({ ok: false, reason: 'reach' });
    expect(world.tryBreak(player, x, -1, z)).toEqual({ ok: false, reason: 'bounds' });
    expect(PLAYER_NET_REACH).toBeGreaterThan(5);
  });

  it('places in creative, consumes in survival, and rejects occupied/inventory/invalid', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const ox = Math.floor(player.controller.position.x);
    const oy = Math.floor(player.controller.position.y) + 3;
    const oz = Math.floor(player.controller.position.z) + 2;
    if (world.world.getBlock(ox, oy, oz) !== BlockId.Air) world.world.setBlock(ox, oy, oz, BlockId.Air);
    const look = lookAngles(
      { x: player.controller.position.x, y: player.controller.position.y, z: player.controller.position.z },
      ox, oy, oz,
    );
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;

    world.setGameMode(player, 'creative');
    expect(world.tryPlace(player, ox, oy, oz, BlockId.Cobblestone)).toEqual({ ok: true });
    expect(world.world.getBlock(ox, oy, oz)).toBe(BlockId.Cobblestone);
    expect(world.tryPlace(player, ox, oy, oz, BlockId.Dirt)).toEqual({ ok: false, reason: 'occupied' });

    world.world.setBlock(ox, oy, oz, BlockId.Air);
    world.setGameMode(player, 'survival');
    const beforeCount = player.inventory.getSlot(0)?.count ?? 0;
    expect(beforeCount).toBeGreaterThan(0);
    expect(world.tryPlace(player, ox, oy, oz)).toEqual({ ok: true });
    expect(world.world.getBlock(ox, oy, oz)).toBe(BlockId.Dirt);
    expect(player.inventory.getSlot(0)?.count).toBe(beforeCount - 1);

    player.inventory.setSlot(0, null);
    world.world.setBlock(ox, oy + 1, oz, BlockId.Air);
    const lookUp = lookAngles(
      { x: player.controller.position.x, y: player.controller.position.y, z: player.controller.position.z },
      ox, oy + 1, oz,
    );
    player.controller.yaw = lookUp.yaw;
    player.controller.pitch = lookUp.pitch;
    expect(world.tryPlace(player, ox, oy + 1, oz)).toEqual({ ok: false, reason: 'inventory' });
    expect(world.tryPlace(player, ox, -4, oz)).toEqual({ ok: false, reason: 'bounds' });
  });

  it('two simulated clients coexist and reconnect does not duplicate', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    expect(world.onlineCount()).toBe(2);
    expect(a.player.id).not.toBe(b.player.id);
    world.disconnect(a.player.id);
    expect(world.onlineCount()).toBe(1);
    const resumed = world.join({ sink: new MemorySink(), name: 'A', sessionToken: a.player.sessionToken });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.resumed).toBe(true);
    expect(resumed.player.id).toBe(a.player.id);
    expect(world.onlineCount()).toBe(2);
    expect(world.players.size).toBe(2);
  });

  it('resume after disconnect accepts WASD seq restarting at 1', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    expect(world.applyInput(player, moveInput(1, { forward: 1 }))).toBe(true);
    world.tick();
    expect(world.applyInput(player, moveInput(40, { forward: 1 }))).toBe(true);
    expect(player.lastInputSeq).toBe(40);
    world.disconnect(player.id);
    expect(player.lastInputSeq).toBe(inputSeqAfterReconnect());
    expect(player.lastInput.forward).toBe(0);

    const resumed = world.join({ sink: new MemorySink(), name: 'Sim', sessionToken: player.sessionToken });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.resumed).toBe(true);
    expect(resumed.player.id).toBe(player.id);
    expect(resumed.player.lastInputSeq).toBe(inputSeqAfterReconnect());
    const origin = resumed.player.controller.position.clone();
    expect(world.applyInput(resumed.player, moveInput(1, { forward: 1, yaw: 0.5 }))).toBe(true);
    world.tick();
    expect(resumed.player.controller.position.distanceTo(origin)).toBeGreaterThan(0.01);
  });

  it('multiple disconnect/resume cycles keep accepting seq 1', async () => {
    const world = await bootWorld();
    const joined = join(world, 'Loop');
    if ('error' in joined) throw new Error(joined.error);
    const token = joined.player.sessionToken;
    let seqOwner = joined.player;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(world.applyInput(seqOwner, moveInput(8 + cycle, { forward: 1 }))).toBe(true);
      world.disconnect(seqOwner.id);
      const again = world.join({ sink: new MemorySink(), name: 'Loop', sessionToken: token });
      if ('error' in again) throw new Error(again.error);
      expect(again.player.lastInputSeq).toBe(inputSeqAfterReconnect());
      const origin = again.player.controller.position.clone();
      expect(world.applyInput(again.player, moveInput(1, { forward: 1, yaw: cycle * 0.4 }))).toBe(true);
      world.tick();
      expect(again.player.controller.position.distanceTo(origin)).toBeGreaterThan(0.01);
      seqOwner = again.player;
    }
  });

  it('resuming a live player rejects the old connectionId and snapshots only the new sink', async () => {
    const world = await bootWorld();
    const sinkA = new MemorySink();
    const first = world.join({ sink: sinkA, name: 'Solo' });
    if ('error' in first) throw new Error(first.error);
    const connA = first.player.connectionId;
    expect(world.applyInput(first.player, moveInput(1, { forward: 1 }), { connectionId: connA })).toBe(true);
    world.tick();
    const sinkABefore = sinkA.payloads.filter((payload) => (payload as { type?: string }).type === 'player_state').length;

    const sinkB = new MemorySink();
    const second = world.join({ sink: sinkB, name: 'Solo', sessionToken: first.player.sessionToken });
    if ('error' in second) throw new Error(second.error);
    expect(second.resumed).toBe(true);
    expect(second.player.id).toBe(first.player.id);
    expect(second.player.connectionId).not.toBe(connA);
    expect(second.previousConnectionId).toBe(connA);
    expect(world.applyInput(second.player, moveInput(1, { forward: 0 }), { connectionId: connA })).toBe(false);
    expect(world.applyInput(second.player, moveInput(1, { forward: 1 }), { connectionId: second.player.connectionId })).toBe(true);
    const origin = second.player.controller.position.clone();
    world.tick();
    expect(second.player.controller.position.distanceTo(origin)).toBeGreaterThan(0.01);
    const afterA = sinkA.payloads.filter((payload) => (payload as { type?: string }).type === 'player_state').length;
    const afterB = sinkB.payloads.filter((payload) => (payload as { type?: string }).type === 'player_state').length;
    expect(afterA).toBe(sinkABefore);
    expect(afterB).toBeGreaterThan(0);
    world.disconnect(second.player.id, true, connA);
    expect(second.player.connected).toBe(true);
    world.disconnect(second.player.id, true, second.player.connectionId);
    expect(second.player.connected).toBe(false);
  });
});

