import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack, restoredRemainingDurability } from '../../src/inventory';
import { ItemId, REPAIR_POTION_LOST_FRACTION, getItemDefinition } from '../../src/items';
import type { ClientInputMessage } from '../../shared/protocol';
import {
  BUYER_EXAMPLE_REPAIR_POTION_ITEM,
  BUYER_EXAMPLE_REPAIR_POTION_PRICE,
} from '../../shared/buyers';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { BuyerService } from '../../server/services/buyer';
import { EconomyService, ECONOMY_INITIAL_BALANCE } from '../../server/services/economy';
import { HologramNetwork } from '../../server/services/holograms';
import { JsonFileStore } from '../../server/services/jsonStore';

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
}

function input(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input', seq, forward: 0, right: 0, jump: false, sneak: false, sprint: false,
    descend: false, flySprint: false, yaw: 0, pitch: 0, selectedSlot: 0, ...extra,
  };
}

function lastInventory(sink: MemorySink): {
  readonly type: 'inventory';
  readonly inventory: ReturnType<Inventory['serialize']>;
} | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as { type?: string };
    if (payload?.type === 'inventory') {
      return payload as {
        type: 'inventory';
        inventory: ReturnType<Inventory['serialize']>;
      };
    }
  }
  return undefined;
}

function durabilityOf(itemId: string): number {
  const item = getItemDefinition(itemId);
  if (!('durability' in item) || item.durability === undefined) {
    throw new Error(`${itemId} has no durability`);
  }
  return item.durability;
}

describe('repair potion server authority', { timeout: 20_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-repair-potion-'));
    dirs.push(dir);
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '8', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
      }, process.cwd()),
      dataDir: dir, port: 0, chunkViewRadius: 1, persistIntervalMs: 60_000,
    });
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'RepairTester' });
    if ('error' in joined) throw new Error(joined.error);
    world.setGameMode(joined.player, 'survival');
    joined.player.controller.teleport([8.5, 70, 8.5]);
    return { world, player: joined.player, sink };
  }

  function drink(world: WorldInstance, player: ServerPlayer) {
    world.applyInput(player, input(1, { selectedSlot: 0, use: true }));
    expect(world.interact(player, undefined, 1, 1, 0)).toEqual({ ok: true });
    for (let tick = 0; tick < 31; tick += 1) world.tick();
  }

  it('repairs durability items from the captured slot and syncs inventory', async () => {
    const { world, player, sink } = await boot();
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack(ItemId.PotionRepair, 2));
    player.inventory.setSlot(1, createItemStack(ItemId.IronSword, 1, { durability: 20 }));
    player.inventory.setSlot(15, createItemStack(ItemId.IronPickaxe, 1, { durability: 40 }));
    player.inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack(ItemId.IronHelmet, 1, { durability: 30 }));
    player.inventory.setSlot(8, createItemStack(ItemId.Apple, 4));
    sink.payloads.length = 0;
    drink(world, player);

    const swordMax = durabilityOf(ItemId.IronSword);
    const pickMax = durabilityOf(ItemId.IronPickaxe);
    const helmMax = durabilityOf(ItemId.IronHelmet);
    expect(player.inventory.count(ItemId.PotionRepair)).toBe(1);
    expect(player.inventory.count(ItemId.GlassBottle)).toBe(1);
    expect(player.inventory.getSlot(1)?.durability).toBe(restoredRemainingDurability(20, swordMax, REPAIR_POTION_LOST_FRACTION));
    expect(player.inventory.getSlot(15)?.durability).toBe(restoredRemainingDurability(40, pickMax, REPAIR_POTION_LOST_FRACTION));
    expect(player.inventory.armor.head?.durability).toBe(restoredRemainingDurability(30, helmMax, REPAIR_POTION_LOST_FRACTION));
    expect(player.inventory.getSlot(8)).toEqual({ itemId: ItemId.Apple, count: 4 });

    const snapshot = lastInventory(sink);
    expect(snapshot).toBeDefined();
    const synced = Inventory.deserialize(snapshot!.inventory);
    expect(synced.count(ItemId.PotionRepair)).toBe(1);
    expect(synced.getSlot(1)?.durability).toBe(player.inventory.getSlot(1)?.durability);
    expect(synced.armor.head?.durability).toBe(player.inventory.armor.head?.durability);
  });

  it('still consumes the potion when nothing is damaged', async () => {
    const { world, player } = await boot();
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack(ItemId.PotionRepair, 1));
    player.inventory.setSlot(2, createItemStack(ItemId.DiamondSword));
    drink(world, player);
    expect(player.inventory.count(ItemId.PotionRepair)).toBe(0);
    expect(player.inventory.getSlot(2)).toEqual({ itemId: ItemId.DiamondSword, count: 1 });
    expect(player.inventory.count(ItemId.GlassBottle)).toBe(1);
  });
});

describe('repair potion buyer assortment', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('lets a configured buyer sell the repair potion at the documented example price', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-repair-buyer-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const holograms = new HologramNetwork(() => undefined);
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    buyer.create({ name: 'Алхимик', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    expect(buyer.configure('aabbccdd', {
      itemId: BUYER_EXAMPLE_REPAIR_POTION_ITEM,
      pricePerItem: BUYER_EXAMPLE_REPAIR_POTION_PRICE,
    }).ok).toBe(true);

    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.PotionRepair, 3));
    expect(buyer.openTrade('p1', 'aabbccdd', inventory).ok).toBe(true);
    expect(buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 0,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    const sold = buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    });
    expect(sold.ok).toBe(true);
    expect(inventory.count(ItemId.PotionRepair)).toBe(0);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE + 3 * BUYER_EXAMPLE_REPAIR_POTION_PRICE);
  });
});
