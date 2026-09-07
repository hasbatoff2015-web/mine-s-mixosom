import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { Inventory, createItemStack } from '../../src/inventory';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import type { ServerInventoryMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-portal-chest-'));
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

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function isInventoryMessage(payload: unknown): payload is ServerInventoryMessage {
  return Boolean(payload && typeof payload === 'object' && (payload as { type?: string }).type === 'inventory');
}

function lastInventory(sink: MemorySink): ServerInventoryMessage | undefined {
  const messages = sink.payloads.filter(isInventoryMessage);
  return messages[messages.length - 1];
}

function windowSlot(message: ServerInventoryMessage | undefined, index: number): { itemId?: string; count?: number } | null {
  const slots = message?.window?.slots;
  if (!Array.isArray(slots)) return null;
  const slot = slots[index];
  if (!slot || typeof slot !== 'object') return null;
  return slot as { itemId?: string; count?: number };
}

describe('Anarchy portal chest', () => {
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

  function join(world: WorldInstance, name = 'Sim', sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) return result;
    return { ...result, sink };
  }

  function placePortalChest(world: WorldInstance, player: ServerPlayer): { x: number; y: number; z: number } {
    world.setGameMode(player, 'creative');
    const x = Math.floor(player.controller.position.x) + 1;
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z) + 1;
    world.world.setBlock(x, y, z, BlockId.Air);
    const look = lookAngles(player.controller.position, x, y, z);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z, BlockId.PortalChest)).toEqual({ ok: true });
    return { x, y, z };
  }

  function openPortalChest(world: WorldInstance, player: ServerPlayer, x: number, y: number, z: number): void {
    const look = lookAngles(player.controller.position, x, y, z);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.interact(player).ok).toBe(true);
    expect(player.window.kind).toBe('portal-chest');
    expect(player.window.x).toBe(x);
    expect(player.window.y).toBe(y);
    expect(player.window.z).toBe(z);
  }

  function putDiamond(world: WorldInstance, player: ServerPlayer): void {
    player.inventory.clear();
    player.inventory.addItem('diamond', 10);
    world.applyInventoryAction(player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });
    world.applyInventoryAction(player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });
  }

  it('opens a 27-slot personal store that is not written into the world chest map', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error('join failed');
    const { x, y, z } = placePortalChest(world, joined.player);
    openPortalChest(world, joined.player, x, y, z);
    expect(joined.player.portalChest.slots).toHaveLength(27);
    expect(lastInventory(joined.sink)?.window?.kind).toBe('portal-chest');
    expect(lastInventory(joined.sink)?.window?.slots).toHaveLength(27);
    expect(world.world.chests.has(`${x},${y},${z}`)).toBe(false);
  });

  it('shows the same personal items at a second portal chest and never shares with another player', async () => {
    const world = await bootWorld();
    const a = join(world, 'Ada');
    const b = join(world, 'Bob');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    const first = placePortalChest(world, a.player);
    openPortalChest(world, a.player, first.x, first.y, first.z);
    putDiamond(world, a.player);
    expect(a.player.portalChest.slots[0]).toEqual(createItemStack('diamond', 10));
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'close' });

    const second = {
      x: first.x + 2,
      y: first.y,
      z: first.z,
    };
    world.world.setBlock(second.x, second.y, second.z, BlockId.Air);
    const look = lookAngles(a.player.controller.position, second.x, second.y, second.z);
    a.player.controller.yaw = look.yaw;
    a.player.controller.pitch = look.pitch;
    expect(world.tryPlace(a.player, second.x, second.y, second.z, BlockId.PortalChest)).toEqual({ ok: true });
    openPortalChest(world, a.player, second.x, second.y, second.z);
    expect(windowSlot(lastInventory(a.sink), 0)?.itemId).toBe('diamond');
    expect(windowSlot(lastInventory(a.sink), 0)?.count).toBe(10);

    b.player.controller.teleport([a.player.controller.position.x, a.player.controller.position.y, a.player.controller.position.z]);
    openPortalChest(world, b.player, first.x, first.y, first.z);
    expect(windowSlot(lastInventory(b.sink), 0)).toBeNull();
    b.player.inventory.clear();
    b.player.inventory.addItem('dirt', 64);
    world.applyInventoryAction(b.player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });
    world.applyInventoryAction(b.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });
    expect(b.player.portalChest.slots[0]?.itemId).toBe('dirt');
    expect(a.player.portalChest.slots[0]?.itemId).toBe('diamond');
    expect(windowSlot(lastInventory(a.sink), 0)?.itemId).toBe('diamond');
  });

  it('keeps personal contents when the physical block is broken and a new one is placed', async () => {
    const world = await bootWorld();
    const joined = join(world, 'Keeper');
    if ('error' in joined) throw new Error('join failed');
    const { x, y, z } = placePortalChest(world, joined.player);
    openPortalChest(world, joined.player, x, y, z);
    putDiamond(world, joined.player);
    world.applyInventoryAction(joined.player, { type: 'inventory_action', action: 'close' });
    expect(world.breakBlock(joined.player, x, y, z)).toEqual({ ok: true });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(world.world.chests.has(`${x},${y},${z}`)).toBe(false);
    expect(joined.player.portalChest.slots[0]).toEqual(createItemStack('diamond', 10));
    world.setGameMode(joined.player, 'creative');
    expect(world.tryPlace(joined.player, x, y, z, BlockId.PortalChest)).toEqual({ ok: true });
    openPortalChest(world, joined.player, x, y, z);
    expect(windowSlot(lastInventory(joined.sink), 0)?.itemId).toBe('diamond');
    expect(windowSlot(lastInventory(joined.sink), 0)?.count).toBe(10);
  });

  it('persists personal contents across disconnect, reconnect and server restart', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = new WorldInstance(testConfig(dir));
    worlds.push(first);
    await first.initialize();
    const joined = first.join({ sink: new MemorySink(), name: 'Keeper' });
    if ('error' in joined) throw new Error(joined.error);
    const { x, y, z } = placePortalChest(first, joined.player);
    openPortalChest(first, joined.player, x, y, z);
    putDiamond(first, joined.player);
    const token = joined.player.sessionToken;
    await first.save();
    await first.stop();
    worlds.pop();

    const second = new WorldInstance(testConfig(dir));
    worlds.push(second);
    await second.initialize();
    const resumeSink = new MemorySink();
    const resumed = second.join({ sink: resumeSink, name: 'Keeper', sessionToken: token });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.player.portalChest.slots[0]).toEqual(createItemStack('diamond', 10));
    const look = lookAngles(resumed.player.controller.position, x, y, z);
    resumed.player.controller.yaw = look.yaw;
    resumed.player.controller.pitch = look.pitch;
    expect(second.interact(resumed.player).ok).toBe(true);
    expect(windowSlot(lastInventory(resumeSink), 0)?.itemId).toBe('diamond');
  });

  it('still respects playerInteract cancellation for portal chests', async () => {
    const world = await bootWorld();
    world.plugins.register({
      name: 'deny-interact',
      onEnable(api) {
        api.registerEvent('playerInteract', (event) => event.cancel());
      },
    });
    await world.plugins.enableAll();
    const joined = join(world);
    if ('error' in joined) throw new Error('join failed');
    const { x, y, z } = placePortalChest(world, joined.player);
    const look = lookAngles(joined.player.controller.position, x, y, z);
    joined.player.controller.yaw = look.yaw;
    joined.player.controller.pitch = look.pitch;
    expect(world.interact(joined.player).ok).toBe(true);
    expect(joined.player.window.kind).toBe('inventory');
  });

  it('leaves ordinary chest sharing unchanged', async () => {
    const world = await bootWorld();
    const a = join(world, 'Ada');
    const b = join(world, 'Bob');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    world.setGameMode(a.player, 'creative');
    const x = Math.floor(a.player.controller.position.x) + 1;
    const y = Math.floor(a.player.controller.position.y);
    const z = Math.floor(a.player.controller.position.z) + 1;
    world.world.setBlock(x, y, z, BlockId.Air);
    const look = lookAngles(a.player.controller.position, x, y, z);
    a.player.controller.yaw = look.yaw;
    a.player.controller.pitch = look.pitch;
    expect(world.tryPlace(a.player, x, y, z, BlockId.Chest)).toEqual({ ok: true });
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'open', kind: 'chest', x, y, z });
    world.applyInventoryAction(b.player, { type: 'inventory_action', action: 'open', kind: 'chest', x, y, z });
    a.player.inventory.clear();
    a.player.inventory.addItem('diamond', 1);
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });
    expect(world.world.getChest(x, y, z).slots[0]?.itemId).toBe('diamond');
    expect(windowSlot(lastInventory(b.sink), 0)?.itemId).toBe('diamond');
  });

  it('lets two players keep distinct stores while both have the same physical portal chest open', async () => {
    const world = await bootWorld();
    const a = join(world, 'Ada');
    const b = join(world, 'Bob');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    const { x, y, z } = placePortalChest(world, a.player);
    b.player.controller.teleport([
      a.player.controller.position.x,
      a.player.controller.position.y,
      a.player.controller.position.z,
    ]);
    openPortalChest(world, a.player, x, y, z);
    openPortalChest(world, b.player, x, y, z);
    putDiamond(world, a.player);
    b.player.inventory.clear();
    b.player.inventory.addItem('dirt', 64);
    world.applyInventoryAction(b.player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });
    world.applyInventoryAction(b.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });
    expect(windowSlot(lastInventory(a.sink), 0)?.itemId).toBe('diamond');
    expect(windowSlot(lastInventory(b.sink), 0)?.itemId).toBe('dirt');
    expect(a.player.portalChest.slots[0]?.itemId).toBe('diamond');
    expect(b.player.portalChest.slots[0]?.itemId).toBe('dirt');
    expect(world.world.chests.has(`${x},${y},${z}`)).toBe(false);
  });

  it('applies existing claim place/break rules without sharing portal contents', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance({
      ...testConfig(dir),
      pluginDir: join(dir, 'no-plugins'),
      loadExamplePlugin: false,
      loadBuiltinPlugins: true,
    });
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();

    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    if ('error' in ada || 'error' in bob) throw new Error('join failed');

    const x = Math.floor(ada.player.controller.position.x) + 2;
    const y = Math.floor(ada.player.controller.position.y);
    const z = Math.floor(ada.player.controller.position.z) + 2;
    ada.player.controller.teleport([x + 0.5, y, z + 0.5]);
    world.handleChat(ada.player, '/claim pos1');
    ada.player.controller.teleport([x + 4.5, y + 4, z + 4.5]);
    world.handleChat(ada.player, '/claim pos2');
    world.handleChat(ada.player, '/claim create portalden');
    world.handleChat(ada.player, '/claim flag block-break false');
    world.handleChat(ada.player, '/claim flag block-place false');

    world.setGameMode(ada.player, 'creative');
    world.setGameMode(bob.player, 'creative');
    ada.player.controller.teleport([x + 1.5, y, z + 1.5]);
    world.world.setBlock(x + 1, y, z + 1, BlockId.Air);
    const lookAda = lookAngles(ada.player.controller.position, x + 1, y, z + 1);
    ada.player.controller.yaw = lookAda.yaw;
    ada.player.controller.pitch = lookAda.pitch;
    expect(world.tryPlace(ada.player, x + 1, y, z + 1, BlockId.PortalChest)).toEqual({ ok: true });

    bob.player.controller.teleport([x + 1.5, y, z + 1.5]);
    const lookBob = lookAngles(bob.player.controller.position, x + 2, y, z + 1);
    bob.player.controller.yaw = lookBob.yaw;
    bob.player.controller.pitch = lookBob.pitch;
    world.world.setBlock(x + 2, y, z + 1, BlockId.Air);
    expect(world.tryPlace(bob.player, x + 2, y, z + 1, BlockId.PortalChest)).toEqual({ ok: false, reason: 'cancelled' });
    expect(world.tryBreak(bob.player, x + 1, y, z + 1)).toEqual({ ok: false, reason: 'cancelled' });

    openPortalChest(world, ada.player, x + 1, y, z + 1);
    putDiamond(world, ada.player);
    openPortalChest(world, bob.player, x + 1, y, z + 1);
    expect(windowSlot(lastInventory(ada.sink), 0)?.itemId).toBe('diamond');
    expect(windowSlot(lastInventory(bob.sink), 0)).toBeNull();
    expect(ada.player.portalChest.slots[0]?.itemId).toBe('diamond');
    expect(bob.player.portalChest.slots[0]?.itemId).toBeUndefined();
  });
});
