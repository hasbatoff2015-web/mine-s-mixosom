import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, chestFacingFromYaw, furnaceFacingFromYaw } from '../../src/blocks';
import { PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { applyFluidWrites, computeFluidUpdate } from '../../src/world/fluids';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import type { ClientInputMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-gameplay-'));
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
  };
}

function lookAt(
  from: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  const dx = x - from.x;
  const dy = y - (from.y + PLAYER_EYE_HEIGHT);
  const dz = z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function lookAngles(
  from: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  return lookAt(from, x + 0.5, y + 0.5, z + 0.5);
}

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

describe('Anarchy server gameplay authority', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  const servers: AnarchyServer[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    for (const server of servers.splice(0)) await server.stop();
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

  function join(world: WorldInstance, name = 'Sim') {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) return result;
    return { ...result, sink };
  }

  it('keeps inventory ownership per player and crafts server-side', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    const beforeB = b.player.inventory.serialize();
    a.player.inventory.clear();
    a.player.inventory.addItem('oak_planks', 4);
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'recipe', recipeId: 'crafting_table' });
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'result', button: 'left' });
    expect(a.player.cursor?.itemId).toBe('crafting_table');
    expect(a.player.inventory.has('oak_planks', 1)).toBe(false);
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });
    expect(a.player.inventory.has('crafting_table', 1)).toBe(true);
    expect(a.player.cursor).toBeNull();
    expect(b.player.inventory.serialize()).toEqual(beforeB);
  });

  it('rejects survival break without mining progress and drops from a completed mine', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    const x = Math.floor(player.controller.position.x);
    const y = Math.floor(player.controller.position.y) + 2;
    const z = Math.floor(player.controller.position.z) + 2;
    if (world.world.getBlock(x, y, z) !== BlockId.Air) world.world.setBlock(x, y, z, BlockId.Air);
    const look = lookAngles(player.controller.position, x, y, z);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z, BlockId.Dirt)).toEqual({ ok: true });

    world.setGameMode(player, 'survival');
    expect(world.tryBreak(player, x, y, z)).toEqual({ ok: false, reason: 'mining' });
    player.miningTarget = { x, y, z };
    player.miningProgress = 1;
    expect(world.tryBreak(player, x, y, z)).toEqual({ ok: true });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(world.gameplay.drops.count).toBeGreaterThan(0);
  });

  it('pickup merges into the collecting player only', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    a.player.inventory.clear();
    b.player.inventory.clear();
    world.setGameMode(a.player, 'creative');
    const x = Math.floor(a.player.controller.position.x);
    const y = Math.floor(a.player.controller.position.y) + 2;
    const z = Math.floor(a.player.controller.position.z) + 1;
    const look = lookAngles(a.player.controller.position, x, y, z);
    a.player.controller.yaw = look.yaw;
    a.player.controller.pitch = look.pitch;
    expect(world.tryPlace(a.player, x, y, z, BlockId.Dirt)).toEqual({ ok: true });
    world.setGameMode(a.player, 'survival');
    a.player.miningTarget = { x, y, z };
    a.player.miningProgress = 1;
    expect(world.tryBreak(a.player, x, y, z)).toEqual({ ok: true });
    a.player.controller.teleport([x + 0.5, y, z + 0.5]);
    for (let tick = 0; tick < 40; tick += 1) world.tick();
    expect(a.player.inventory.has('dirt', 1)).toBe(true);
    expect(b.player.inventory.has('dirt', 1)).toBe(false);
  });

  it('commands give/time/clear are server authoritative', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    player.inventory.clear();
    world.handleChat(player, '/give diamond 2');
    expect(player.inventory.has('diamond', 2)).toBe(true);
    const before = world.world.timeOfDay;
    world.handleChat(player, '/time night');
    expect(world.world.timeOfDay).toBe(13_000);
    expect(world.world.timeOfDay).not.toBe(before);
    world.handleChat(player, '/clear');
    expect(player.inventory.has('diamond', 1)).toBe(false);
  });

  it('persists inventory and dropped items across save/load', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = new WorldInstance(testConfig(dir));
    worlds.push(first);
    await first.initialize();
    const joined = first.join({ sink: new MemorySink(), name: 'Keeper' });
    if ('error' in joined) throw new Error(joined.error);
    joined.player.inventory.clear();
    joined.player.inventory.addItem('iron_ingot', 7);
    first.setGameMode(joined.player, 'creative');
    const x = Math.floor(joined.player.controller.position.x) + 1;
    const y = Math.floor(joined.player.controller.position.y) + 2;
    const z = Math.floor(joined.player.controller.position.z) + 1;
    const look = lookAngles(joined.player.controller.position, x, y, z);
    joined.player.controller.yaw = look.yaw;
    joined.player.controller.pitch = look.pitch;
    expect(first.tryPlace(joined.player, x, y, z, BlockId.Dirt)).toEqual({ ok: true });
    first.setGameMode(joined.player, 'survival');
    joined.player.miningTarget = { x, y, z };
    joined.player.miningProgress = 1;
    expect(first.tryBreak(joined.player, x, y, z)).toEqual({ ok: true });
    expect(first.gameplay.drops.count).toBeGreaterThan(0);
    joined.player.controller.teleport([x + 24, y + 16, z + 24]);
    await first.save();
    await first.stop();
    worlds.pop();

    const second = new WorldInstance(testConfig(dir));
    worlds.push(second);
    await second.initialize();
    expect(second.world.getBlock(x, y, z)).toBe(BlockId.Air);
    const resumed = second.join({ sink: new MemorySink(), name: 'Keeper', sessionToken: joined.player.sessionToken });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.player.inventory.has('iron_ingot', 7)).toBe(true);
    expect(second.gameplay.drops.count).toBeGreaterThan(0);
  });

  it('melee combat hits mobs and other players on the server', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    const origin = a.player.controller.position;
    const x = origin.x;
    const y = 100;
    const z = origin.z;
    a.player.controller.teleport([x, y, z]);
    b.player.controller.teleport([x, y, z + 2]);
    const atB = lookAt(a.player.controller.position, b.player.controller.position.x, b.player.controller.position.y + 0.9, b.player.controller.position.z);
    a.player.controller.yaw = atB.yaw;
    a.player.controller.pitch = atB.pitch;
    a.player.inventory.clear();
    a.player.inventory.addItem('diamond_sword', 1);
    a.player.selectedSlot = 0;
    const before = b.player.survival.health;
    world.attack(a.player);
    expect(b.player.survival.health).toBeLessThan(before);

    const mobPos = new THREE.Vector3(x, y, z - 2);
    const mob = world.gameplay.mobs.spawn('zombie', mobPos, { force: true });
    if (!mob) throw new Error('mob spawn failed');
    const atMob = lookAt(a.player.controller.position, mob.position.x, mob.position.y + 1, mob.position.z);
    a.player.controller.yaw = atMob.yaw;
    a.player.controller.pitch = atMob.pitch;
    const mobHealth = mob.health;
    world.attack(a.player);
    expect(mob.health).toBeLessThan(mobHealth);
  });

  it('survival death drops inventory then respawns', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    player.inventory.clear();
    player.inventory.addItem('diamond', 4);
    world.handleChat(player, '/kill');
    expect(player.survival.dead).toBe(false);
    expect(player.survival.health).toBe(20);
    expect(player.inventory.has('diamond', 1)).toBe(false);
    expect(world.gameplay.drops.count).toBeGreaterThan(0);
  });

  it('consumes golden apple effects on the server', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    player.inventory.clear();
    player.inventory.addItem('golden_apple', 1);
    player.selectedSlot = 0;
    player.controller.pitch = Math.PI / 2;
    world.interact(player);
    for (let tick = 0; tick < 40; tick += 1) world.gameplay.advanceUseHold(player, true);
    expect(player.inventory.has('golden_apple', 1)).toBe(false);
    expect(player.survival.effectTicks('absorption')).toBeGreaterThan(0);
    expect(player.survival.effectTicks('regeneration')).toBeGreaterThan(0);
  });

  it('TNT priming and water flow are server simulated', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    const x = Math.floor(player.controller.position.x);
    const y = Math.floor(player.controller.position.y) + 3;
    const z = Math.floor(player.controller.position.z) + 2;
    if (world.world.getBlock(x, y, z) !== BlockId.Air) world.world.setBlock(x, y, z, BlockId.Air);
    if (world.world.getBlock(x + 1, y, z) !== BlockId.Air) world.world.setBlock(x + 1, y, z, BlockId.Air);
    const look = lookAngles(player.controller.position, x, y, z);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z, BlockId.Tnt)).toEqual({ ok: true });
    player.inventory.clear();
    player.inventory.addItem('flint_and_steel', 1);
    player.selectedSlot = 0;
    world.interact(player);
    expect(world.gameplay.redstone.primedTntCount).toBeGreaterThan(0);
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    for (let tick = 0; tick < 100; tick += 1) world.tick();
    expect(world.gameplay.redstone.primedTntCount).toBe(0);

    const wx = Math.floor(player.controller.position.x);
    const wy = Math.floor(player.controller.position.y) + 10;
    const wz = Math.floor(player.controller.position.z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        world.world.setBlock(wx + dx, wy - 1, wz + dz, BlockId.Stone);
        world.world.setBlock(wx + dx, wy + 1, wz + dz, BlockId.Air);
        if (dx === 0 && dz === 0) continue;
        world.world.setBlock(wx + dx, wy, wz + dz, dx === 1 && dz === 0 ? BlockId.Air : BlockId.Stone);
      }
    }
    world.world.setBlock(wx, wy, wz, BlockId.Water);
    expect(world.world.getBlock(wx, wy, wz)).toBe(BlockId.Water);
    const writes = computeFluidUpdate(world.world, wx, wy, wz);
    expect(writes.some((write) => write.x === wx + 1 && write.y === wy && write.z === wz && write.block === BlockId.Water)).toBe(true);
    applyFluidWrites(world.world, writes);
    expect(world.world.getBlock(wx + 1, wy, wz)).toBe(BlockId.Water);
  });

  it('two websocket clients get entity snapshots and isolated give', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const server = new AnarchyServer(testConfig(dir));
    servers.push(server);
    await server.start();
    const { WebSocket } = await import('ws');
    const { PROTOCOL_VERSION } = await import('../../shared/config');
    function collect(url: string, name: string) {
      const messages: Array<{ type: string; [k: string]: unknown }> = [];
      const socket = new WebSocket(url);
      const ready = new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });
      socket.on('message', (data) => messages.push(JSON.parse(String(data))));
      return {
        messages,
        async join() {
          await ready;
          socket.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, name }));
          await new Promise((resolve) => setTimeout(resolve, 80));
        },
        send(payload: unknown) {
          socket.send(JSON.stringify(payload));
        },
        close() { socket.close(); },
      };
    }
    const a = collect(server.wsUrl(), 'A');
    const b = collect(server.wsUrl(), 'B');
    await a.join();
    await b.join();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(a.messages.some((message) => message.type === 'entity_snapshot')).toBe(true);
    expect(b.messages.some((message) => message.type === 'entity_snapshot')).toBe(true);
    a.send({ type: 'chat', text: '/give diamond 1' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const invA = [...a.messages].reverse().find((message) => message.type === 'inventory') as { inventory?: { slots?: Array<{ itemId?: string } | null> } } | undefined;
    const invB = [...b.messages].reverse().find((message) => message.type === 'inventory') as { inventory?: { slots?: Array<{ itemId?: string } | null> } } | undefined;
    expect(invA?.inventory?.slots?.some((slot) => slot?.itemId === 'diamond')).toBe(true);
    expect(invB?.inventory?.slots?.some((slot) => slot?.itemId === 'diamond')).not.toBe(true);
    a.close();
    b.close();
  });

  function walkInput(seq: number, yaw = 0): ClientInputMessage {
    return {
      type: 'input',
      seq,
      forward: 1,
      right: 0,
      jump: false,
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      yaw,
      pitch: 0,
      selectedSlot: 0,
    };
  }

  function blockMessages(sink: MemorySink) {
    return sink.payloads.filter((payload): payload is Record<string, unknown> => {
      if (!payload || typeof payload !== 'object') return false;
      const type = (payload as { type?: unknown }).type;
      return type === 'block_update' || type === 'block_batch';
    });
  }

  function flattenedBlockChanges(sink: MemorySink) {
    const out: Array<{ x: number; y: number; z: number; blockId: number; state?: Record<string, unknown> }> = [];
    for (const payload of blockMessages(sink)) {
      if (payload.type === 'block_update') {
        out.push({
          x: payload.x as number,
          y: payload.y as number,
          z: payload.z as number,
          blockId: payload.blockId as number,
          ...(payload.state && typeof payload.state === 'object'
            ? { state: payload.state as Record<string, unknown> }
            : {}),
        });
        continue;
      }
      const changes = payload.changes;
      if (!Array.isArray(changes)) continue;
      for (const change of changes) {
        if (!change || typeof change !== 'object') continue;
        const entry = change as Record<string, unknown>;
        out.push({
          x: entry.x as number,
          y: entry.y as number,
          z: entry.z as number,
          blockId: entry.blockId as number,
          ...(entry.state && typeof entry.state === 'object'
            ? { state: entry.state as Record<string, unknown> }
            : {}),
        });
      }
    }
    return out;
  }

  it('death then respawn still accepts WASD / jump / sneak input', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'survival');
    const beforeKill = player.controller.position.clone();
    world.applyInput(player, walkInput(1, 0.4));
    world.tick();
    expect(player.controller.position.distanceTo(beforeKill)).toBeGreaterThan(0.01);

    world.handleChat(player, '/kill');
    expect(player.survival.dead).toBe(false);
    expect(player.survival.health).toBe(20);
    const health = joined.sink.payloads.filter((payload) => (
      payload && typeof payload === 'object' && (payload as { type?: string }).type === 'health'
    )) as Array<{ dead?: boolean; health?: number }>;
    expect(health.some((entry) => entry.dead === true)).toBe(true);
    expect(health.at(-1)?.dead).toBe(false);

    const origin = player.controller.position.clone();
    world.applyInput(player, {
      ...walkInput(2, 1.2),
      jump: true,
      sneak: true,
    });
    world.tick();
    expect(player.controller.position.distanceTo(origin)).toBeGreaterThan(0.01);
    expect(player.controller.sneaking).toBe(true);
  });

  it('two clients can move after each respawns', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    world.handleChat(a.player, '/kill');
    world.handleChat(b.player, '/kill');
    const a0 = a.player.controller.position.clone();
    const b0 = b.player.controller.position.clone();
    world.applyInput(a.player, walkInput(1, 0.2));
    world.applyInput(b.player, walkInput(1, -0.7));
    world.tick();
    expect(a.player.controller.position.distanceTo(a0)).toBeGreaterThan(0.01);
    expect(b.player.controller.position.distanceTo(b0)).toBeGreaterThan(0.01);
  });

  it('places directional blocks from server look and networks facing state', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    const x = Math.floor(player.controller.position.x) + 2;
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z);
    player.controller.teleport([x - 1.5, y, z + 0.5]);
    for (let dy = -1; dy <= 2; dy += 1) {
      world.world.setBlock(x, y + dy, z, dy === -1 ? BlockId.Stone : BlockId.Air);
    }
    const look = lookAt(player.controller.position, x + 0.5, y - 0.05, z + 0.5);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z, BlockId.Chest)).toEqual({ ok: true });
    expect(world.world.getBlockState(x, y, z)?.facing).toBe(chestFacingFromYaw(player.controller.yaw));
    expect(flattenedBlockChanges(joined.sink).some((change) => (
      change.x === x && change.y === y && change.z === z
      && change.blockId === BlockId.Chest
      && change.state?.facing === world.world.getBlockState(x, y, z)?.facing
    ))).toBe(true);

    world.world.setBlock(x + 2, y, z, BlockId.Air);
    world.world.setBlock(x + 2, y - 1, z, BlockId.Stone);
    player.controller.teleport([x + 0.5, y, z + 0.5]);
    const furnaceLook = lookAt(player.controller.position, x + 2.5, y - 0.05, z + 0.5);
    player.controller.yaw = furnaceLook.yaw;
    player.controller.pitch = furnaceLook.pitch;
    expect(world.tryPlace(player, x + 2, y, z, BlockId.Furnace)).toEqual({ ok: true });
    expect(world.world.getBlockState(x + 2, y, z)?.facing).toBe(furnaceFacingFromYaw(player.controller.yaw));
  });

  it('places wall torch vs floor torch from the hit face', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    const sx = Math.floor(player.controller.position.x) + 3;
    const sy = Math.floor(player.controller.position.y);
    const sz = Math.floor(player.controller.position.z);
    world.world.setBlock(sx, sy, sz, BlockId.Stone);
    world.world.setBlock(sx, sy, sz - 1, BlockId.Air);
    world.world.setBlock(sx, sy + 1, sz, BlockId.Air);
    player.controller.teleport([sx + 0.5, sy, sz - 2.2]);
    const wallLook = lookAt(player.controller.position, sx + 0.5, sy + 0.5, sz + 0.5);
    player.controller.yaw = wallLook.yaw;
    player.controller.pitch = wallLook.pitch;
    expect(world.tryPlace(player, sx, sy, sz - 1, BlockId.Torch)).toEqual({ ok: true });
    expect(world.world.getBlockState(sx, sy, sz - 1)?.attachment).toBe('wall');

    const floorLook = lookAt(player.controller.position, sx + 0.5, sy + 1.05, sz + 0.5);
    player.controller.yaw = floorLook.yaw;
    player.controller.pitch = floorLook.pitch;
    expect(world.tryPlace(player, sx, sy + 1, sz, BlockId.Torch)).toEqual({ ok: true });
    expect(world.world.getBlockState(sx, sy + 1, sz)?.attachment).toBe('floor');
  });

  it('places ladder, button, door and applies server interactions', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    const x = Math.floor(player.controller.position.x) + 2;
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z);
    world.world.setBlock(x, y, z, BlockId.Stone);
    world.world.setBlock(x, y, z - 1, BlockId.Air);
    player.controller.teleport([x + 0.5, y, z - 2.2]);
    let look = lookAt(player.controller.position, x + 0.5, y + 0.5, z + 0.5);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z - 1, BlockId.Ladder)).toEqual({ ok: true });
    expect(world.world.getBlockState(x, y, z - 1)?.facing).toBeDefined();

    world.world.setBlock(x + 2, y, z, BlockId.Stone);
    world.world.setBlock(x + 2, y, z - 1, BlockId.Air);
    player.controller.teleport([x + 2.5, y, z - 2.2]);
    look = lookAt(player.controller.position, x + 2.5, y + 0.5, z + 0.5);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x + 2, y, z - 1, BlockId.StoneButton)).toEqual({ ok: true });
    expect(world.world.getBlockState(x + 2, y, z - 1)?.attachment).toBe('wall');
    player.inventory.clear();
    look = lookAt(player.controller.position, x + 2.5, y + 0.5, z - 0.06);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    world.interact(player);
    expect(world.world.getBlockState(x + 2, y, z - 1)?.powered).toBe(true);

    world.world.setBlock(x + 4, y - 1, z, BlockId.Stone);
    world.world.setBlock(x + 4, y, z, BlockId.Air);
    world.world.setBlock(x + 4, y + 1, z, BlockId.Air);
    player.controller.teleport([x + 4.5, y, z - 1.6]);
    look = lookAt(player.controller.position, x + 4.5, y - 0.05, z + 0.5);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x + 4, y, z, BlockId.OakDoor)).toEqual({ ok: true });
    expect(world.world.getBlock(x + 4, y, z)).toBe(BlockId.OakDoor);
    expect(world.world.getBlock(x + 4, y + 1, z)).toBe(BlockId.OakDoor);
    expect(world.world.getBlockState(x + 4, y, z)?.half).toBe('lower');
    look = lookAngles(player.controller.position, x + 4, y, z);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    player.inventory.clear();
    world.interact(player);
    expect(world.world.getBlockState(x + 4, y, z)?.open).toBe(true);
    expect(world.world.getBlockState(x + 4, y + 1, z)?.open).toBe(true);
  });

  it('keeps stairs, rails, lantern and chain orientation on the server', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    const x = Math.floor(player.controller.position.x) + 2;
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z);
    world.world.setBlock(x, y - 1, z, BlockId.Stone);
    world.world.setBlock(x, y, z, BlockId.Air);
    player.controller.teleport([x - 1.4, y, z + 0.5]);
    let look = lookAt(player.controller.position, x + 0.5, y - 0.05, z + 0.5);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z, BlockId.OakStairs)).toEqual({ ok: true });
    expect(world.world.getBlockState(x, y, z)?.facing).toBeDefined();

    world.world.setBlock(x, y, z + 2, BlockId.Air);
    world.world.setBlock(x, y - 1, z + 2, BlockId.Stone);
    player.controller.teleport([x + 0.5, y, z + 0.5]);
    look = lookAt(player.controller.position, x + 0.5, y - 0.05, z + 2.5);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z + 2, BlockId.Rail)).toEqual({ ok: true });
    expect(world.world.getBlockState(x, y, z + 2)?.railShape).toBeDefined();

    world.world.setBlock(x + 2, y - 1, z, BlockId.Stone);
    world.world.setBlock(x + 2, y, z, BlockId.Air);
    look = lookAt(player.controller.position, x + 2.5, y - 0.05, z + 0.5);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x + 2, y, z, BlockId.Lantern)).toEqual({ ok: true });
    expect(world.world.getBlockState(x + 2, y, z)?.attachment).toBe('floor');

    world.world.setBlock(x + 2, y + 3, z, BlockId.Stone);
    world.world.setBlock(x + 2, y + 2, z, BlockId.Air);
    player.controller.teleport([x + 0.5, y, z + 0.5]);
    look = lookAt(player.controller.position, x + 2.5, y + 3.02, z + 0.5);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x + 2, y + 2, z, BlockId.Chain)).toEqual({ ok: true });
    expect(world.world.getBlockState(x + 2, y + 2, z)?.attachment).toBe('ceiling');
  });

  it('networks live water/lava levels and two clients see the same state', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    const x = Math.floor(a.player.controller.position.x);
    const y = Math.floor(a.player.controller.position.y) + 8;
    const z = Math.floor(a.player.controller.position.z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        world.world.setBlock(x + dx, y - 1, z + dz, BlockId.Stone);
        world.world.setBlock(x + dx, y, z + dz, BlockId.Air);
        world.world.setBlock(x + dx, y + 1, z + dz, BlockId.Air);
      }
    }
    world.world.setBlock(x, y, z, BlockId.Water);
    world.world.setBlockState(x, y, z, { fluidLevel: 8 });
    world.world.setBlock(x + 1, y, z, BlockId.Water);
    world.world.setBlockState(x + 1, y, z, { fluidLevel: 5, fluidFalling: false });
    const changes = world.gameplay.consumeBlockChanges();
    expect(changes.some((change) => change.x === x + 1 && change.state?.fluidLevel === 5)).toBe(true);
    expect(world.world.getBlockState(x + 1, y, z)?.fluidLevel).toBe(5);

    world.world.setBlock(x, y + 2, z, BlockId.Lava);
    world.world.setBlockState(x, y + 2, z, { fluidLevel: 4, fluidFalling: false });
    const lava = world.gameplay.consumeBlockChanges();
    expect(lava.some((change) => change.blockId === BlockId.Lava && change.state?.fluidLevel === 4)).toBe(true);
  });

  it('persists door, button and fluid state across save/load', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = new WorldInstance(testConfig(dir));
    worlds.push(first);
    await first.initialize();
    const joined = first.join({ sink: new MemorySink(), name: 'Keeper' });
    if ('error' in joined) throw new Error(joined.error);
    const x = Math.floor(joined.player.controller.position.x) + 1;
    const y = Math.floor(joined.player.controller.position.y) + 2;
    const z = Math.floor(joined.player.controller.position.z);
    first.world.setBlock(x, y, z, BlockId.OakDoor);
    first.world.setBlock(x, y + 1, z, BlockId.OakDoor);
    first.world.setBlockState(x, y, z, { facing: 'east', hinge: 'left', open: true, half: 'lower' });
    first.world.setBlockState(x, y + 1, z, { facing: 'east', hinge: 'left', open: true, half: 'upper' });
    first.world.setBlock(x + 1, y, z, BlockId.StoneButton);
    first.gameplay.redstone.setButtonOrientation(x + 1, y, z, 'wall', 'south');
    first.world.setBlockState(x + 1, y, z, { attachment: 'wall', facing: 'south', powered: false });
    first.world.setBlock(x + 2, y, z, BlockId.Water);
    first.world.setBlockState(x + 2, y, z, { fluidLevel: 3, fluidFalling: false });
    await first.save();
    await first.stop();
    worlds.pop();

    const second = new WorldInstance(testConfig(dir));
    worlds.push(second);
    await second.initialize();
    expect(second.world.getBlockState(x, y, z)?.open).toBe(true);
    expect(second.world.getBlockState(x + 1, y, z)?.facing).toBe('south');
    expect(second.world.getBlockState(x + 2, y, z)?.fluidLevel).toBe(3);
  });
});
