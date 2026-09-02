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
import { applyAuthoritativeContainerSlots } from '../../src/net/onlineContainerSync';
import { VoxelWorld } from '../../src/world/World';
import type { ServerInventoryMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-chest-sync-'));
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

function inventoryMessages(sink: MemorySink): ServerInventoryMessage[] {
  return sink.payloads.filter(isInventoryMessage);
}

function lastInventory(sink: MemorySink): ServerInventoryMessage | undefined {
  const messages = inventoryMessages(sink);
  return messages[messages.length - 1];
}

function windowSlot(message: ServerInventoryMessage | undefined, index: number): { itemId?: string; count?: number } | null {
  const slots = message?.window?.slots;
  if (!Array.isArray(slots)) return null;
  const slot = slots[index];
  if (!slot || typeof slot !== 'object') return null;
  return slot as { itemId?: string; count?: number };
}

describe('Anarchy online chest sync', () => {
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

  function join(world: WorldInstance, name = 'Sim') {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) return result;
    return { ...result, sink };
  }

  function placeChest(world: WorldInstance, player: ServerPlayer): { x: number; y: number; z: number } {
    world.setGameMode(player, 'creative');
    const x = Math.floor(player.controller.position.x) + 1;
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z) + 1;
    world.world.setBlock(x, y, z, BlockId.Air);
    const look = lookAngles(player.controller.position, x, y, z);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    expect(world.tryPlace(player, x, y, z, BlockId.Chest)).toEqual({ ok: true });
    return { x, y, z };
  }

  function openChest(world: WorldInstance, player: ServerPlayer, x: number, y: number, z: number): void {
    world.applyInventoryAction(player, {
      type: 'inventory_action',
      action: 'open',
      kind: 'chest',
      x,
      y,
      z,
    });
  }

  it('put updates open window.slots for the actor and a second viewer', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    const { x, y, z } = placeChest(world, a.player);
    b.player.controller.teleport([a.player.controller.position.x, a.player.controller.position.y, a.player.controller.position.z]);
    openChest(world, a.player, x, y, z);
    openChest(world, b.player, x, y, z);
    a.player.inventory.clear();
    a.player.inventory.addItem('diamond', 1);
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });

    expect(world.world.getChest(x, y, z).slots[0]?.itemId).toBe('diamond');
    expect(a.player.inventory.has('diamond', 1)).toBe(false);
    expect(windowSlot(lastInventory(a.sink), 0)?.itemId).toBe('diamond');
    expect(windowSlot(lastInventory(b.sink), 0)?.itemId).toBe('diamond');
    expect(lastInventory(a.sink)?.inventory).toBeTruthy();
    expect(lastInventory(b.sink)?.window?.kind).toBe('chest');

    const clientWorld = new VoxelWorld('viewer-gui');
    const openGuiChest = clientWorld.getChest(x, y, z);
    applyAuthoritativeContainerSlots(clientWorld, lastInventory(b.sink)?.window);
    expect(openGuiChest.slots[0]?.itemId).toBe('diamond');
  });

  it('take updates open window.slots for both clients and the actor inventory', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    const { x, y, z } = placeChest(world, a.player);
    b.player.controller.teleport([a.player.controller.position.x, a.player.controller.position.y, a.player.controller.position.z]);
    world.world.getChest(x, y, z).slots[0] = createItemStack('diamond', 1);
    openChest(world, a.player, x, y, z);
    openChest(world, b.player, x, y, z);
    a.player.inventory.clear();
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });

    expect(world.world.getChest(x, y, z).slots[0]).toBeNull();
    expect(a.player.inventory.has('diamond', 1)).toBe(true);
    expect(windowSlot(lastInventory(a.sink), 0)).toBeNull();
    expect(windowSlot(lastInventory(b.sink), 0)).toBeNull();
  });

  it('reopen snapshot matches the mutated chest', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const { x, y, z } = placeChest(world, joined.player);
    openChest(world, joined.player, x, y, z);
    joined.player.inventory.clear();
    joined.player.inventory.addItem('gold_ingot', 1);
    world.applyInventoryAction(joined.player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });
    world.applyInventoryAction(joined.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });
    world.applyInventoryAction(joined.player, { type: 'inventory_action', action: 'close' });
    openChest(world, joined.player, x, y, z);
    expect(windowSlot(lastInventory(joined.sink), 0)?.itemId).toBe('gold_ingot');
    expect(world.world.getChest(x, y, z).slots[0]?.itemId).toBe('gold_ingot');
  });

  it('concurrent take cannot duplicate the item', async () => {
    const world = await bootWorld();
    const a = join(world, 'A');
    const b = join(world, 'B');
    if ('error' in a || 'error' in b) throw new Error('join failed');
    const { x, y, z } = placeChest(world, a.player);
    b.player.controller.teleport([a.player.controller.position.x, a.player.controller.position.y, a.player.controller.position.z]);
    world.world.getChest(x, y, z).slots[0] = createItemStack('diamond', 1);
    openChest(world, a.player, x, y, z);
    openChest(world, b.player, x, y, z);
    a.player.inventory.clear();
    b.player.inventory.clear();
    world.applyInventoryAction(a.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });
    world.applyInventoryAction(b.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });

    const withA = a.player.cursor?.itemId === 'diamond' ? 1 : 0;
    const withB = b.player.cursor?.itemId === 'diamond' ? 1 : 0;
    expect(withA + withB).toBe(1);
    expect(world.world.getChest(x, y, z).slots[0]).toBeNull();
    expect(windowSlot(lastInventory(a.sink), 0)).toBeNull();
    expect(windowSlot(lastInventory(b.sink), 0)).toBeNull();
  });

  it('rejected closed-chest click does not mutate and still sends current state', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const { x, y, z } = placeChest(world, joined.player);
    world.world.getChest(x, y, z).slots[0] = createItemStack('diamond', 1);
    joined.player.window = { kind: 'inventory' };
    const before = inventoryMessages(joined.sink).length;
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
    });
    expect(world.world.getChest(x, y, z).slots[0]?.itemId).toBe('diamond');
    expect(joined.player.cursor).toBeNull();
    expect(inventoryMessages(joined.sink).length).toBeGreaterThan(before);
    expect(lastInventory(joined.sink)?.window?.kind).toBe('inventory');
  });

  it('full inventory shift-take leaves the chest item and refreshes window.slots', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const { x, y, z } = placeChest(world, joined.player);
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      joined.player.inventory.setSlot(slot, createItemStack('dirt', 64));
    }
    world.world.getChest(x, y, z).slots[0] = createItemStack('diamond', 1);
    openChest(world, joined.player, x, y, z);
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
      shift: true,
    });
    expect(world.world.getChest(x, y, z).slots[0]?.itemId).toBe('diamond');
    expect(joined.player.inventory.has('diamond', 1)).toBe(false);
    expect(windowSlot(lastInventory(joined.sink), 0)?.itemId).toBe('diamond');
  });

  it('invalid slot click refreshes GUI state without stealing the item', async () => {
    const world = await bootWorld();
    const joined = join(world);
    if ('error' in joined) throw new Error(joined.error);
    const { x, y, z } = placeChest(world, joined.player);
    world.world.getChest(x, y, z).slots[0] = createItemStack('diamond', 1);
    openChest(world, joined.player, x, y, z);
    world.applyInventoryAction(joined.player, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-99',
      button: 'left',
    });
    expect(world.world.getChest(x, y, z).slots[0]?.itemId).toBe('diamond');
    expect(windowSlot(lastInventory(joined.sink), 0)?.itemId).toBe('diamond');
  });

  it('persists chest contents across server restart', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = new WorldInstance(testConfig(dir));
    worlds.push(first);
    await first.initialize();
    const joined = first.join({ sink: new MemorySink(), name: 'Keeper' });
    if ('error' in joined) throw new Error(joined.error);
    const { x, y, z } = placeChest(first, joined.player);
    openChest(first, joined.player, x, y, z);
    joined.player.inventory.clear();
    joined.player.inventory.addItem('diamond', 1);
    first.applyInventoryAction(joined.player, { type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left' });
    first.applyInventoryAction(joined.player, { type: 'inventory_action', action: 'click', key: 'container-0', button: 'left' });
    await first.save();
    await first.stop();
    worlds.pop();

    const second = new WorldInstance(testConfig(dir));
    worlds.push(second);
    await second.initialize();
    expect(second.world.getChest(x, y, z).slots[0]?.itemId).toBe('diamond');
    const resumeSink = new MemorySink();
    const resumed = second.join({
      sink: resumeSink,
      name: 'Keeper',
      sessionToken: joined.player.sessionToken,
    });
    if ('error' in resumed) throw new Error(resumed.error);
    openChest(second, resumed.player, x, y, z);
    expect(windowSlot(lastInventory(resumeSink), 0)?.itemId).toBe('diamond');
  });
});
