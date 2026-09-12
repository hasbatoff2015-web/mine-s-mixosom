import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { parseClientMessage } from '../../shared/protocol';
import {
  BUYER_EXAMPLE_GOLDEN_APPLE_ITEM,
  BUYER_EXAMPLE_GOLDEN_APPLE_PRICE,
  BUYER_EXAMPLE_MELON_ITEM,
  BUYER_EXAMPLE_MELON_PRICE,
  BUYER_EXAMPLE_PUMPKIN_ITEM,
  BUYER_EXAMPLE_PUMPKIN_PRICE,
  BUYER_HOLOGRAM_Y_OFFSET,
  BUYER_ITEM_INVALID_ERROR,
  BUYER_MAX_PRICE,
  BUYER_NAME_TAKEN_ERROR,
  BUYER_NOT_CONFIGURED_ERROR,
  BUYER_PRICE_EMPTY_ERROR,
  BUYER_PRICE_RANGE_ERROR,
  BUYER_STALE_ERROR,
  BUYER_WRONG_ITEM_ERROR,
  buyerHologramName,
  buyerPayout,
  buyerPriceError,
  parseBuyerPrice,
  validateBuyerName,
} from '../../shared/buyers';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService, ECONOMY_INITIAL_BALANCE } from '../../server/services/economy';
import { HologramNetwork } from '../../server/services/holograms';
import { BuyerService, isBuyerConfigured } from '../../server/services/buyer';

describe('Buyer price parsing', () => {
  it('accepts integers 1…999999999 and rejects the rest', () => {
    expect(parseBuyerPrice(1)).toBe(1);
    expect(parseBuyerPrice('50')).toBe(50);
    expect(parseBuyerPrice(BUYER_MAX_PRICE)).toBe(BUYER_MAX_PRICE);
    expect(parseBuyerPrice(0)).toBeUndefined();
    expect(parseBuyerPrice(-1)).toBeUndefined();
    expect(parseBuyerPrice(1.5)).toBeUndefined();
    expect(parseBuyerPrice('1.5')).toBeUndefined();
    expect(parseBuyerPrice('1k')).toBeUndefined();
    expect(parseBuyerPrice('1M')).toBeUndefined();
    expect(parseBuyerPrice('')).toBeUndefined();
    expect(buyerPriceError('')).toBe(BUYER_PRICE_EMPTY_ERROR);
    expect(buyerPriceError('0')).toBe(BUYER_PRICE_RANGE_ERROR);
    expect(buyerPayout(32, 50)).toBe(1600);
  });

  it('validates unique-friendly names', () => {
    expect(validateBuyerName('Фермер').ok).toBe(true);
    expect(validateBuyerName('').ok).toBe(false);
    expect(validateBuyerName('a'.repeat(33)).ok).toBe(false);
  });
});

describe('BuyerService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(nextId: () => string = () => 'aabbccdd') {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const holograms = new HologramNetwork(() => undefined);
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, nextId);
    return { store, economy, holograms, buyer };
  }

  function fill(inventory: Inventory, itemId: string, count: number, slot = 0): void {
    inventory.setSlot(slot, createItemStack(itemId, count));
  }

  it('creates a unique named NPC at the given pose and hologram', async () => {
    const { buyer, holograms } = await setup();
    const created = buyer.create({
      name: 'Фермер',
      worldId: 'anarchy',
      x: 10.5,
      y: 64,
      z: -3.25,
      yaw: 1.2,
      pitch: -0.3,
    });
    expect(created.ok).toBe(true);
    expect(created.buyer?.name).toBe('Фермер');
    expect(created.buyer?.x).toBe(10.5);
    expect(created.buyer?.yaw).toBe(1.2);
    expect(created.buyer?.pitch).toBe(-0.3);
    expect(isBuyerConfigured(created.buyer!)).toBe(false);
    const hologram = holograms.get(buyerHologramName('aabbccdd'));
    expect(hologram?.lines[0]).toBe('Фермер');
    expect(hologram?.y).toBeCloseTo(64 + BUYER_HOLOGRAM_Y_OFFSET);
    expect(hologram).toMatchObject({
      font: 'sans',
      size: 1,
      style: 'bold',
      billboard: true,
      backgroundEnabled: true,
      kind: 'normal',
    });
    const dup = buyer.create({
      name: 'фермер',
      worldId: 'anarchy',
      x: 0, y: 64, z: 0, yaw: 0, pitch: 0,
    });
    expect(dup.ok).toBe(false);
    expect(dup.error).toBe(BUYER_NAME_TAKEN_ERROR);
  });

  it('persists create/config across a new service on the same store', async () => {
    const { store, economy, holograms, buyer } = await setup();
    buyer.create({ name: 'Арбузник', worldId: 'anarchy', x: 1, y: 70, z: 2, yaw: 0.5, pitch: 0 });
    expect(buyer.configure('aabbccdd', {
      itemId: BUYER_EXAMPLE_MELON_ITEM,
      pricePerItem: BUYER_EXAMPLE_MELON_PRICE,
      hologramText: 'ПРИЁМ АРБУЗОВ',
    }).ok).toBe(true);
    const again = new BuyerService(store, economy, holograms, () => 'anarchy');
    again.load();
    const restored = again.findByName('Арбузник');
    expect(restored?.itemId).toBe('melon');
    expect(restored?.pricePerItem).toBe(50);
    expect(restored?.x).toBe(1);
    expect(restored?.yaw).toBe(0.5);
    expect(restored?.hologramText).toBe('ПРИЁМ АРБУЗОВ');
  });

  it('changes item and price on the same NPC and rejects invalid values', async () => {
    const { buyer } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    expect(buyer.configure('aabbccdd', { itemId: 'not_an_item' }).error).toBe(BUYER_ITEM_INVALID_ERROR);
    expect(buyer.configure('aabbccdd', { pricePerItem: 0 }).ok).toBe(false);
    expect(buyer.configure('aabbccdd', {
      itemId: BUYER_EXAMPLE_PUMPKIN_ITEM,
      pricePerItem: BUYER_EXAMPLE_PUMPKIN_PRICE,
    }).ok).toBe(true);
    expect(buyer.configure('aabbccdd', {
      itemId: BUYER_EXAMPLE_GOLDEN_APPLE_ITEM,
      pricePerItem: BUYER_EXAMPLE_GOLDEN_APPLE_PRICE,
    }).ok).toBe(true);
    const npc = buyer.get('aabbccdd')!;
    expect(npc.itemId).toBe('golden_apple');
    expect(npc.pricePerItem).toBe(600);
    expect(npc.name).toBe('Фермер');
  });

  it('moves pose and hologram together, then deletes both', async () => {
    const { buyer, holograms } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    const moved = buyer.move('Фермер', { worldId: 'anarchy', x: 8, y: 71, z: 4, yaw: 2, pitch: 0.1 });
    expect(moved.ok).toBe(true);
    expect(moved.buyer?.x).toBe(8);
    expect(moved.buyer?.yaw).toBe(2);
    expect(holograms.get(buyerHologramName('aabbccdd'))?.x).toBe(8);
    expect(holograms.get(buyerHologramName('aabbccdd'))?.y).toBeCloseTo(71 + BUYER_HOLOGRAM_Y_OFFSET);
    expect(buyer.delete('Фермер').ok).toBe(true);
    expect(buyer.list()).toEqual([]);
    expect(holograms.get(buyerHologramName('aabbccdd'))).toBeUndefined();
  });

  it('sells the configured item atomically and rejects spoofed client fields', async () => {
    const { buyer, economy } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50 });
    const inventory = new Inventory();
    fill(inventory, 'pumpkin', 32);
    const open = buyer.openTrade('p1', 'aabbccdd', inventory);
    expect(open.ok).toBe(true);
    expect(buyer.handleAction('p1', inventory, {
      type: 'buyer_action',
      action: 'select_slot',
      slot: 0,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    expect(inventory.getSlot(0)).toBeNull();
    expect(buyer.session('p1')?.tradeSlot?.count).toBe(32);
    const spoof = buyer.handleAction('p1', inventory, {
      type: 'buyer_action',
      action: 'sell',
      price: 1,
      amount: 999,
    }, { edit: false, delete: false, use: true });
    expect(spoof.ok).toBe(true);
    expect(spoof.chat).toMatch(/1 600/);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE + 1600);
    expect(inventory.count('pumpkin')).toBe(0);
    expect(buyer.session('p1')?.tradeSlot).toBeNull();
    const again = buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    });
    expect(again.ok).toBe(false);
  });

  it('rejects the wrong item, restores on close, and ignores a stale NPC', async () => {
    const { buyer } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50 });
    const inventory = new Inventory();
    fill(inventory, 'melon', 16);
    fill(inventory, 'pumpkin', 8, 1);
    buyer.openTrade('p1', 'aabbccdd', inventory);
    const wrong = buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 0,
    }, { edit: false, delete: false, use: true });
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toBe(BUYER_WRONG_ITEM_ERROR);
    expect(inventory.getSlot(0)?.itemId).toBe('melon');
    expect(buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 1,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    expect(inventory.getSlot(1)).toBeNull();
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'close' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(inventory.count('pumpkin')).toBe(8);
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    }).error).toBe(BUYER_STALE_ERROR);
  });

  it('does not take items when payout is rejected', async () => {
    const { buyer, economy } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: BUYER_MAX_PRICE });
    economy.setBalance('p1', 1, 'ADMIN_SET');
    const inventory = new Inventory();
    fill(inventory, 'pumpkin', 2);
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: false, delete: false, use: true,
    });
    const sold = buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    });
    expect(sold.ok).toBe(false);
    expect(buyer.session('p1')?.tradeSlot?.count).toBe(2);
    expect(economy.getBalance('p1')).toBe(1);
  });

  it('unconfigured buyers cannot sell', async () => {
    const { buyer } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    const inventory = new Inventory();
    fill(inventory, 'pumpkin', 1);
    buyer.openTrade('p1', 'aabbccdd', inventory);
    const result = buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 0,
    }, { edit: false, delete: false, use: true });
    expect(result.error).toBe(BUYER_NOT_CONFIGURED_ERROR);
    expect(inventory.getSlot(0)?.itemId).toBe('pumpkin');
  });

  it('keeps rotation and position until move is called', async () => {
    const { buyer } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 3, y: 64, z: 5, yaw: 0.4, pitch: -0.2 });
    const before = { ...buyer.get('aabbccdd')! };
    expect(before.yaw).toBe(0.4);
    expect(before.x).toBe(3);
    expect(buyer.get('aabbccdd')).toMatchObject({ x: 3, y: 64, z: 5, yaw: 0.4, pitch: -0.2 });
  });

  it('parses buyer protocol intents and drops unknown actions', () => {
    expect(parseClientMessage({ type: 'buyer_interact', buyerId: 'aabbccdd' })).toMatchObject({
      type: 'buyer_interact',
      buyerId: 'aabbccdd',
    });
    expect(parseClientMessage({ type: 'buyer_action', action: 'sell', price: 1, amount: 99 })).toMatchObject({
      type: 'buyer_action',
      action: 'sell',
    });
    expect(parseClientMessage({ type: 'buyer_action', action: 'explode' }))
      .toEqual({ error: 'buyer_action.action invalid' });
    expect(parseClientMessage({ type: 'buyer_action', action: 'edit_hologram' })).toMatchObject({
      type: 'buyer_action',
      action: 'edit_hologram',
    });
  });

  it('picks an item from inventory, saves admin config, and ignores spoofed quantity', async () => {
    const { buyer, holograms } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    const inventory = new Inventory();
    fill(inventory, 'pumpkin', 17);
    expect(buyer.openAdmin('op', 'aabbccdd', inventory).ok).toBe(true);
    expect(buyer.handleAction('op', inventory, { type: 'buyer_action', action: 'pick_item' }, {
      edit: true, delete: true, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('op', inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: true, delete: true, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('op', inventory, {
      type: 'buyer_action', action: 'save', name: 'Фермер', price: '50', hologramText: 'ПРИЁМ ТЫКВ',
    }, { edit: true, delete: true, use: true }).ok).toBe(true);
    expect(buyer.get('aabbccdd')?.itemId).toBe('pumpkin');
    expect(buyer.get('aabbccdd')?.pricePerItem).toBe(50);
    expect(buyer.get('aabbccdd')?.hologramText).toBe('Фермер');
    expect(holograms.get(buyerHologramName('aabbccdd'))?.lines).toEqual(['Фермер']);
    buyer.openTrade('p1', 'aabbccdd', inventory);
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'set_amount', amount: 999 }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(buyer.session('p1')?.tradeSlot?.count).toBe(17);
    const snap = buyer.buildMessage('p1', inventory);
    expect(snap.quantity).toBe(17);
    expect(snap.total).toBe(850);
    expect(snap).not.toHaveProperty('health');
    expect(buyer.networkBuyers()[0]).not.toHaveProperty('hp');
  });

  it('rejects seeds and slices, and returns trade items if the NPC is deleted', async () => {
    const { buyer, holograms } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50, hologramText: 'ФЕРМЕР' });
    const hologram = holograms.get(buyerHologramName('aabbccdd'));
    expect(hologram?.lines).toEqual(['ФЕРМЕР']);
    expect(hologram?.lines.join(' ')).not.toMatch(/HP|20\/20|здоров/i);
    const inventory = new Inventory();
    fill(inventory, 'pumpkin_seeds', 8);
    fill(inventory, 'pumpkin', 4, 1);
    buyer.openTrade('p1', 'aabbccdd', inventory);
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: false, delete: false, use: true,
    }).error).toBe(BUYER_WRONG_ITEM_ERROR);
    expect(inventory.count('pumpkin_seeds')).toBe(8);
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'select_slot', slot: 1 }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(buyer.delete('Фермер').ok).toBe(true);
    expect(buyer.session('p1')).toBeUndefined();
    buyer.restoreOverflow('p1', inventory);
    expect(inventory.count('pumpkin')).toBe(4);
    expect(holograms.get(buyerHologramName('aabbccdd'))).toBeUndefined();
  });

  it('lets two buyers keep independent items and prices', async () => {
    let n = 0;
    const { buyer } = await setup(() => `id${n++}`);
    expect(buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 }).ok).toBe(true);
    expect(buyer.create({ name: 'Арбузник', worldId: 'anarchy', x: 4, y: 64, z: 1, yaw: 1, pitch: 0 }).ok).toBe(true);
    const farmer = buyer.findByName('Фермер')!;
    const melon = buyer.findByName('Арбузник')!;
    expect(buyer.configure(farmer.id, { itemId: 'pumpkin', pricePerItem: 50 }).ok).toBe(true);
    expect(buyer.configure(melon.id, { itemId: 'melon', pricePerItem: 50 }).ok).toBe(true);
    const pumpkinInv = new Inventory();
    fill(pumpkinInv, 'pumpkin', 2);
    buyer.openTrade('p1', farmer.id, pumpkinInv);
    expect(buyer.handleAction('p1', pumpkinInv, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    const melonInv = new Inventory();
    fill(melonInv, 'melon', 3);
    buyer.openTrade('p2', melon.id, melonInv);
    expect(buyer.handleAction('p2', melonInv, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('p1', pumpkinInv, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('p2', melonInv, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(pumpkinInv.count('pumpkin')).toBe(0);
    expect(melonInv.count('melon')).toBe(0);
  });

  it('keeps full hologram appearance across move, item/price change, and reload', async () => {
    const { store, economy, holograms, buyer } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0.4, pitch: 0 });
    const name = buyerHologramName('aabbccdd');
    const updated = holograms.updateAppearance(name, {
      type: 'hologram_update',
      name,
      lines: ['СКУПЩИК', 'ТЫКВА — 50 МК'],
      font: 'ui',
      size: 1.6,
      style: 'italic',
      kind: 'timer',
      timerDuration: 90,
      backgroundEnabled: false,
      backgroundWidth: 3.25,
      backgroundHeight: 1.1,
      billboard: false,
    }, { playerYaw: 0.75, nowMs: 5_000 });
    expect(updated).toMatchObject({
      lines: ['СКУПЩИК', 'ТЫКВА — 50 МК'],
      font: 'ui',
      size: 1.6,
      style: 'italic',
      kind: 'timer',
      timerDuration: 90,
      backgroundEnabled: false,
      backgroundWidth: 3.25,
      backgroundHeight: 1.1,
      billboard: false,
    });
    expect(updated?.yaw).toBeCloseTo(0.75);
    expect(updated?.timerStartedAt).toBe(5_000);
    buyer.captureHologramText('aabbccdd');
    expect(buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50 }).ok).toBe(true);
    const moved = buyer.move('Фермер', { worldId: 'anarchy', x: 8, y: 71, z: 4, yaw: 2, pitch: 0.1 });
    expect(moved.ok).toBe(true);
    expect(moved.buyer?.yaw).toBe(2);
    const afterMove = holograms.get(name);
    expect(afterMove).toMatchObject({
      x: 8,
      z: 4,
      lines: ['СКУПЩИК', 'ТЫКВА — 50 МК'],
      font: 'ui',
      size: 1.6,
      style: 'italic',
      kind: 'timer',
      timerDuration: 90,
      timerStartedAt: 5_000,
      backgroundEnabled: false,
      backgroundWidth: 3.25,
      backgroundHeight: 1.1,
      billboard: false,
    });
    expect(afterMove?.y).toBeCloseTo(71 + BUYER_HOLOGRAM_Y_OFFSET);
    expect(afterMove?.yaw).toBeCloseTo(0.75);
    const again = new BuyerService(store, economy, holograms, () => 'anarchy');
    again.load();
    again.ensureHolograms();
    const restored = holograms.get(name);
    expect(again.get('aabbccdd')?.itemId).toBe('pumpkin');
    expect(again.get('aabbccdd')?.pricePerItem).toBe(50);
    expect(again.get('aabbccdd')?.yaw).toBe(2);
    expect(restored).toMatchObject({
      lines: ['СКУПЩИК', 'ТЫКВА — 50 МК'],
      font: 'ui',
      size: 1.6,
      style: 'italic',
      kind: 'timer',
      billboard: false,
      backgroundEnabled: false,
    });
    expect(restored?.yaw).toBeCloseTo(0.75);
    holograms.remove(name);
    again.ensureHolograms();
    const migrated = holograms.get(name);
    expect(migrated?.lines[0]).toContain('СКУПЩИК');
    expect(migrated?.font).toBe('sans');
    expect(migrated?.billboard).toBe(true);
  });

  it('opens the bound hologram editor only for buyer.edit and does not recreate the hologram', async () => {
    const { buyer, holograms } = await setup();
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    const before = holograms.get(buyerHologramName('aabbccdd'));
    const inventory = new Inventory();
    expect(buyer.handleAction('op', inventory, { type: 'buyer_action', action: 'edit_hologram' }, {
      edit: true, delete: true, use: true,
    }).error).toBe(BUYER_STALE_ERROR);
    expect(buyer.openAdmin('op', 'aabbccdd', inventory).ok).toBe(true);
    expect(buyer.openTrade('p1', 'aabbccdd', inventory).ok).toBe(true);
    const denied = buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'edit_hologram' }, {
      edit: false, delete: false, use: true,
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/permission/i);
    expect(denied.openHologramEditor).toBeUndefined();
    const opened = buyer.handleAction('op', inventory, { type: 'buyer_action', action: 'edit_hologram' }, {
      edit: true, delete: true, use: true,
    });
    expect(opened.ok).toBe(true);
    expect(opened.openHologramEditor).toBe(true);
    expect(opened.buyer?.id).toBe('aabbccdd');
    expect(opened.buyer?.hologramName).toBe(buyerHologramName('aabbccdd'));
    expect(holograms.get(buyerHologramName('aabbccdd'))).toBe(before);
  });
});

