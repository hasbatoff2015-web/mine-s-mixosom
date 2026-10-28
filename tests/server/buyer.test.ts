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
  BUYER_NOT_A_SELLER_ERROR,
  BUYER_STORE_KEY,
  BUYER_STALE_ERROR,
  BUYER_WRONG_ITEM_ERROR,
  SELLER_BUSY_ERROR,
  SELLER_CHOOSE_AMOUNT_ERROR,
  SELLER_NO_ROOM_ERROR,
  SELLER_NOT_A_BUYER_ERROR,
  SELLER_NOT_CONFIGURED_ERROR,
  buyerHologramName,
  buyerPayout,
  buyerPriceError,
  parseBuyerPrice,
  parseBuyerStock,
  validateBuyerName,
} from '../../shared/buyers';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService, ECONOMY_INITIAL_BALANCE } from '../../server/services/economy';
import { HologramNetwork } from '../../server/services/holograms';
import { BuyerService, isBuyerConfigured } from '../../server/services/buyer';
import type { CurrencyPort } from '../../server/economy/currencyPort';

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

  async function setup(
    nextId: () => string = () => 'aabbccdd',
    economyFactory?: (store: JsonFileStore) => EconomyService,
  ) {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = economyFactory ? economyFactory(store) : new EconomyService(store);
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
    expect(parseClientMessage({ type: 'buyer_action', action: 'buy', price: 1, amount: 99, role: 'seller' })).toMatchObject({
      type: 'buyer_action',
      action: 'buy',
      price: 1,
      amount: 99,
      role: 'seller',
    });
    expect(parseClientMessage({ type: 'buyer_action', action: 'set_stock', stock: '12' })).toMatchObject({
      type: 'buyer_action',
      action: 'set_stock',
      stock: '12',
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
    expect(denied.error).toMatch(/прав/);
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

  it('keeps an old buyers.json file as a buyer and still accepts a sale', async () => {
    const { store, economy, holograms } = await setup();
    store.save(BUYER_STORE_KEY, {
      buyers: [{
        id: 'legacy01',
        name: 'Старый',
        worldId: 'anarchy',
        x: 1,
        y: 64,
        z: 2,
        yaw: 0.2,
        pitch: 0,
        itemId: 'pumpkin',
        pricePerItem: 50,
        hologramName: 'buyer-legacy01',
        hologramText: 'Старый',
        createdAt: 1,
      }],
    });
    const again = new BuyerService(store, economy, holograms, () => 'anarchy');
    again.load();
    const npc = again.findByName('Старый');
    expect(npc?.role).toBe('buyer');
    expect(npc?.stock).toBeUndefined();
    const inventory = new Inventory();
    fill(inventory, 'pumpkin', 2);
    again.openTrade('p1', 'legacy01', inventory);
    expect(again.handleAction('p1', inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(again.handleAction('p1', inventory, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE + 100);
  });

  it('sells from server stock and ignores spoofed price, amount and a second buy', async () => {
    const { buyer, economy } = await setup();
    expect(buyer.create({
      name: 'Лавка',
      role: 'seller',
      worldId: 'anarchy',
      x: 0, y: 64, z: 0, yaw: 0, pitch: 0,
    }).buyer?.role).toBe('seller');
    expect(buyer.configure('aabbccdd', {
      itemId: 'pumpkin',
      pricePerItem: 50,
      role: 'seller',
      stock: 5,
    }).ok).toBe(true);
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    const view = buyer.buildMessage('p1', inventory);
    expect(view.role).toBe('seller');
    expect(view.title).toBe('Продавец Лавка');
    expect(view.quantity).toBe(1);
    expect(view.total).toBe(50);
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'set_amount', amount: 2 }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    const bought = buyer.handleAction('p1', inventory, {
      type: 'buyer_action',
      action: 'buy',
      price: 1,
      amount: 100,
      stock: 100,
    }, { edit: false, delete: false, use: true });
    expect(bought.ok).toBe(true);
    expect(bought.chat).toMatch(/100/);
    expect(inventory.count('pumpkin')).toBe(2);
    expect(buyer.get('aabbccdd')?.stock).toBe(5);
    expect(buyer.get('aabbccdd')?.pricePerItem).toBe(50);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 100);
    expect(economy.getTransactionHistory('p1')[0]).toMatchObject({
      reason: 'TRADER_PURCHASE',
      amount: 100,
      type: 'withdraw',
    });
    const again = buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'buy', amount: 2 }, {
      edit: false, delete: false, use: true,
    });
    expect(again.ok).toBe(false);
    expect(again.error).toBe(SELLER_CHOOSE_AMOUNT_ERROR);
    expect(buyer.get('aabbccdd')?.stock).toBe(5);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 100);
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    }).error).toBe(SELLER_NOT_A_BUYER_ERROR);
    expect(inventory.count('pumpkin')).toBe(2);
  });

  it('rejects a purchase before taking coins when balance or inventory cannot cover it', async () => {
    const { buyer, economy } = await setup();
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50, role: 'seller', stock: 1 });
    const first = new Inventory();
    const second = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', first);
    buyer.openTrade('p2', 'aabbccdd', second);
    expect(buyer.handleAction('p1', first, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('p2', second, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(first.count('pumpkin')).toBe(1);
    expect(second.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 50);
    expect(economy.getBalance('p2')).toBe(ECONOMY_INITIAL_BALANCE - 50);
    expect(buyer.get('aabbccdd')?.stock).toBe(1);

    buyer.openTrade('p2', 'aabbccdd', second);
    buyer.session('p2')!.orderQuantity = 3;
    const poor = buyer.handleAction('p2', second, { type: 'buyer_action', action: 'buy', price: 1 }, {
      edit: false, delete: false, use: true,
    });
    expect(poor.error).toBe('Недостаточно Мегакоинов.');
    expect(buyer.get('aabbccdd')?.stock).toBe(1);
    expect(economy.getBalance('p2')).toBe(ECONOMY_INITIAL_BALANCE - 50);

    const packed = new Inventory();
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      packed.setSlot(slot, createItemStack('cobblestone', 64));
    }
    buyer.openTrade('p3', 'aabbccdd', packed);
    buyer.session('p3')!.orderQuantity = 1;
    const noRoom = buyer.handleAction('p3', packed, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    });
    expect(noRoom.error).toBe(SELLER_NO_ROOM_ERROR);
    expect(packed.count('pumpkin')).toBe(0);
    expect(buyer.get('aabbccdd')?.stock).toBe(1);
    expect(economy.getBalance('p3')).toBe(ECONOMY_INITIAL_BALANCE);
  });

  it('does not let a second buyer pass the same reserved stock', async () => {
    class ReenterEconomy extends EconomyService {
      hook: (() => void) | undefined;
      override withdraw(
        playerId: string,
        amount: number,
        reason: string,
        relatedPlayerId?: string,
        pairId?: string,
      ) {
        const hook = this.hook;
        this.hook = undefined;
        hook?.();
        return super.withdraw(playerId, amount, reason, relatedPlayerId, pairId);
      }
    }
    const { buyer, economy } = await setup(() => 'aabbccdd', (store) => new ReenterEconomy(store));
    const reenter = economy as ReenterEconomy;
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 5 });
    const first = new Inventory();
    const second = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', first);
    buyer.openTrade('p2', 'aabbccdd', second);
    reenter.hook = () => {
      const raced = buyer.handleAction('p2', second, { type: 'buyer_action', action: 'buy', amount: 5 }, {
        edit: false, delete: false, use: true,
      });
      expect(raced.error).toBe(SELLER_BUSY_ERROR);
    };
    expect(buyer.handleAction('p1', first, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(buyer.get('aabbccdd')?.stock).toBe(5);
    expect(first.count('pumpkin')).toBe(1);
    expect(second.count('pumpkin')).toBe(0);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    expect(economy.getBalance('p2')).toBe(ECONOMY_INITIAL_BALANCE);
  });

  it('returns reserved stock when the withdraw fails and does not grant the item', async () => {
    class FlakyEconomy extends EconomyService {
      fail = true;
      override withdraw(
        playerId: string,
        amount: number,
        reason: string,
        relatedPlayerId?: string,
        pairId?: string,
      ) {
        if (this.fail) {
          this.fail = false;
          return { ok: false, error: 'Недостаточно Мегакоинов.', balance: this.getBalance(playerId) };
        }
        return super.withdraw(playerId, amount, reason, relatedPlayerId, pairId);
      }
    }
    const { store, buyer, economy } = await setup(() => 'aabbccdd', (store) => new FlakyEconomy(store));
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50, role: 'seller', stock: 5 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    const failed = buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    });
    expect(failed.ok).toBe(false);
    expect(inventory.count('pumpkin')).toBe(0);
    expect(buyer.get('aabbccdd')?.stock).toBe(5);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE);
    const saved = store.load<{ buyers: Array<{ stock?: number }>; purchases?: unknown[] }>(BUYER_STORE_KEY, { buyers: [] });
    expect(saved.purchases ?? []).toEqual([]);
    expect(saved.buyers[0]?.stock).toBe(5);
  });

  it('replays a paid reservation into owed items exactly once and restores an unpaid one', async () => {
    const { store, economy, holograms, buyer } = await setup();
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50, role: 'seller', stock: 5 });
    expect(economy.withdraw('p1', 50, 'TRADER_PURCHASE', 'aabbccdd', 'sp-paid').ok).toBe(true);
    const saved = store.load<{
      buyers: Array<{ stock?: number }>;
      purchases?: unknown[];
      returns?: Record<string, unknown>;
    }>(BUYER_STORE_KEY, { buyers: [] });
    saved.buyers[0]!.stock = 3;
    saved.purchases = [
      {
        id: 'sp-paid',
        playerId: 'p1',
        buyerId: 'aabbccdd',
        itemId: 'pumpkin',
        quantity: 1,
        unitPrice: 50,
        total: 50,
        phase: 'reserved',
        createdAt: 1,
      },
      {
        id: 'sp-open',
        playerId: 'p2',
        buyerId: 'aabbccdd',
        itemId: 'pumpkin',
        quantity: 1,
        unitPrice: 50,
        total: 50,
        phase: 'reserved',
        createdAt: 2,
      },
    ];
    store.save(BUYER_STORE_KEY, saved);
    const recovered = new BuyerService(store, economy, holograms, () => 'anarchy');
    recovered.load();
    expect(recovered.get('aabbccdd')?.stock).toBe(3);
    const replay = new BuyerService(store, economy, holograms, () => 'anarchy');
    replay.load();
    const inventory = new Inventory();
    replay.restoreOverflow('p1', inventory);
    replay.restoreOverflow('p2', inventory);
    expect(inventory.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 50);
    expect(economy.getBalance('p2')).toBe(ECONOMY_INITIAL_BALANCE);
    const once = new BuyerService(store, economy, holograms, () => 'anarchy');
    once.load();
    const again = new Inventory();
    once.restoreOverflow('p1', again);
    expect(again.count('pumpkin')).toBe(0);
  });

  it('requires seller stock, then can switch the same NPC back to a buyer', async () => {
    const { store, economy, holograms, buyer } = await setup();
    buyer.create({ name: 'Лавка', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    const inventory = new Inventory();
    fill(inventory, 'pumpkin', 4);
    buyer.openAdmin('op', 'aabbccdd', inventory);
    expect(buyer.handleAction('op', inventory, { type: 'buyer_action', action: 'set_role', role: 'seller' }, {
      edit: true, delete: true, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('op', inventory, { type: 'buyer_action', action: 'pick_item' }, {
      edit: true, delete: true, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('op', inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: true, delete: true, use: true,
    }).ok).toBe(true);
    expect(buyer.handleAction('op', inventory, {
      type: 'buyer_action', action: 'save', name: 'Лавка', price: '50', role: 'seller',
    }, { edit: true, delete: true, use: true }).ok).toBe(true);
    expect(buyer.get('aabbccdd')).toMatchObject({ role: 'seller', pricePerItem: 50, itemId: 'pumpkin' });
    expect(buyer.get('aabbccdd')?.stock).toBeUndefined();
    expect(parseBuyerStock(1_000_001)).toBeUndefined();
    const reloaded = new BuyerService(store, economy, holograms, () => 'anarchy');
    reloaded.load();
    expect(reloaded.get('aabbccdd')).toMatchObject({ role: 'seller', itemId: 'pumpkin', pricePerItem: 50 });
    expect(reloaded.get('aabbccdd')?.stock).toBeUndefined();
    expect(reloaded.configure('aabbccdd', { role: 'buyer' }).ok).toBe(true);
    expect(reloaded.get('aabbccdd')?.role).toBe('buyer');
    expect(reloaded.get('aabbccdd')?.stock).toBeUndefined();
    const trade = new Inventory();
    fill(trade, 'pumpkin', 1);
    reloaded.openTrade('p1', 'aabbccdd', trade);
    expect(reloaded.handleAction('p1', trade, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    }).error).toBe(BUYER_NOT_A_SELLER_ERROR);
    expect(reloaded.handleAction('p1', trade, { type: 'buyer_action', action: 'select_slot', slot: 0 }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(reloaded.handleAction('p1', trade, { type: 'buyer_action', action: 'sell' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
  });

  it('sells past a stored stock number without changing that number', async () => {
    const { store, economy, holograms, buyer } = await setup();
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'melon', pricePerItem: 10, role: 'seller', stock: 2 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.session('p1')!.orderQuantity = 3;
    const bought = buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    });
    expect(bought.ok).toBe(true);
    expect(inventory.count('melon')).toBe(3);
    expect(buyer.get('aabbccdd')?.stock).toBe(2);
    expect(buyer.get('aabbccdd')?.pricePerItem).toBe(10);
    const reloaded = new BuyerService(store, economy, holograms, () => 'anarchy');
    reloaded.load();
    expect(reloaded.get('aabbccdd')).toMatchObject({ role: 'seller', stock: 2, pricePerItem: 10, itemId: 'melon' });
    const again = new Inventory();
    reloaded.openTrade('p1', 'aabbccdd', again);
    reloaded.session('p1')!.orderQuantity = 2;
    expect(reloaded.handleAction('p1', again, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    }).ok).toBe(true);
    expect(again.count('melon')).toBe(2);
    expect(reloaded.get('aabbccdd')?.stock).toBe(2);
  });

  it('charges a postgres seller once when the same request is repeated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-pg-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const holograms = new HologramNetwork(() => undefined);
    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    let debits = 0;
    const sources = new Set<string>();
    const balances = new Map<string, number>([['p1', 100], ['p2', 100]]);
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held = false;
    const economy = {
      backend: 'postgres' as const,
      getBalance: (id: string) => balances.get(id) ?? 0,
      hasBalance: (id: string, amount: number) => (balances.get(id) ?? 0) >= amount,
      hasEconomicSource: async (_type: string, id: string) => sources.has(id),
      withdrawSource: async (playerId: string, amount: number, _reason: string, sourceId: string) => {
        if (!held) {
          held = true;
          const raced = buyer.handleAction('p2', second, {
            type: 'buyer_action', action: 'buy', clientRequestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          }, { edit: false, delete: false, use: true });
          expect(raced).toMatchObject({ ok: false, error: SELLER_BUSY_ERROR });
          release();
        }
        await gate;
        if (sources.has(sourceId)) return { ok: true, replayed: true, amount };
        if ((balances.get(playerId) ?? 0) < amount) return { ok: false, error: 'Недостаточно Мегакоинов.' };
        balances.set(playerId, (balances.get(playerId) ?? 0) - amount);
        sources.add(sourceId);
        debits += 1;
        return { ok: true, amount };
      },
    } as unknown as CurrencyPort;
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 2 });
    const firstInventory = new Inventory();
    const second = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', firstInventory);
    buyer.openTrade('p2', 'aabbccdd', second);
    buyer.session('p1')!.orderQuantity = 1;
    buyer.session('p2')!.orderQuantity = 1;
    const first = await buyer.handleAction('p1', firstInventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(first.ok).toBe(true);
    expect(firstInventory.count('pumpkin')).toBe(1);
    expect(debits).toBe(1);
    expect(buyer.get('aabbccdd')?.stock).toBe(2);
    buyer.session('p1')!.orderQuantity = 1;
    const replay = await buyer.handleAction('p1', firstInventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(replay.ok).toBe(true);
    expect(firstInventory.count('pumpkin')).toBe(1);
    expect(debits).toBe(1);
    expect(balances.get('p1')).toBe(90);
    const saved = store.load<{ buyers: unknown[]; purchases?: unknown[] }>(BUYER_STORE_KEY, { buyers: [] });
    expect(saved.purchases ?? []).toEqual([]);
  });

  it('does not debit a JSON seller again when the same request is repeated with an empty balance', async () => {
    const { buyer, economy } = await setup();
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: ECONOMY_INITIAL_BALANCE, role: 'seller', stock: 4 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.session('p1')!.orderQuantity = 1;
    const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const first = buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(first.ok).toBe(true);
    expect(inventory.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(0);
    buyer.session('p1')!.orderQuantity = 1;
    const replay = buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId, amount: 3,
    }, { edit: false, delete: false, use: true });
    expect(replay.ok).toBe(true);
    expect(inventory.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(0);
    expect(economy.getTransactionHistory('p1').filter((row) => row.reason === 'TRADER_PURCHASE')).toHaveLength(1);
  });

  it('does not debit a JSON seller again after more than 100 ledger rows and a restart that drops the pair id', async () => {
    const { store, economy, holograms, buyer } = await setup();
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 4 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.session('p1')!.orderQuantity = 1;
    const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    expect(buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    expect(inventory.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    for (let index = 0; index < 101; index += 1) {
      expect(economy.deposit(`filler-${index}`, 1, 'ADMIN_GIVE').ok).toBe(true);
    }
    buyer.session('p1')!.orderQuantity = 1;
    const whileHistoryRemains = buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(whileHistoryRemains.ok).toBe(true);
    expect(inventory.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);

    const ledger = store.load<{ nextId: number; transactions: Array<{ reason?: string; pairId?: string }> }>(
      'economy/transactions',
      { nextId: 1, transactions: [] },
    );
    ledger.transactions = ledger.transactions.filter((row) => row.reason !== 'TRADER_PURCHASE');
    expect(ledger.transactions.length).toBeGreaterThan(100);
    expect(ledger.transactions.some((row) => row.pairId === requestId)).toBe(false);
    store.save('economy/transactions', ledger);
    const restartedEconomy = new EconomyService(store);
    const restarted = new BuyerService(store, restartedEconomy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    restarted.load();
    const again = new Inventory();
    restarted.openTrade('p1', 'aabbccdd', again);
    restarted.session('p1')!.orderQuantity = 1;
    const replay = restarted.handleAction('p1', again, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(replay.ok).toBe(true);
    expect(again.count('pumpkin')).toBe(0);
    expect(restartedEconomy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    expect(restartedEconomy.getTransactionHistory('p1').filter((row) => row.reason === 'TRADER_PURCHASE')).toEqual([]);
    restarted.session('p1')!.orderQuantity = 2;
    const changed = restarted.handleAction('p1', again, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(changed).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    expect(again.count('pumpkin')).toBe(0);
    expect(restartedEconomy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    expect(inventory.count('pumpkin')).toBe(1);
  });

  it('keeps one postgres seller debit across restart and rejects the same UUID with another quantity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-pg-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const holograms = new HologramNetwork(() => undefined);
    const requestId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    let debits = 0;
    const sources = new Set<string>();
    const balances = new Map<string, number>([['p1', 100]]);
    const economy = {
      backend: 'postgres' as const,
      getBalance: (id: string) => balances.get(id) ?? 0,
      hasBalance: (id: string, amount: number) => (balances.get(id) ?? 0) >= amount,
      hasEconomicSource: async (_type: string, id: string) => sources.has(id),
      withdrawSource: async (playerId: string, amount: number, _reason: string, sourceId: string) => {
        if (sources.has(sourceId)) return { ok: true, replayed: true, amount };
        if ((balances.get(playerId) ?? 0) < amount) return { ok: false, error: 'Недостаточно Мегакоинов.' };
        balances.set(playerId, (balances.get(playerId) ?? 0) - amount);
        sources.add(sourceId);
        debits += 1;
        return { ok: true, amount };
      },
    } as unknown as CurrencyPort;
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 4 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.session('p1')!.orderQuantity = 1;
    expect((await buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).ok).toBe(true);
    expect(inventory.count('pumpkin')).toBe(1);
    expect(debits).toBe(1);
    const restarted = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    restarted.load();
    const again = new Inventory();
    restarted.openTrade('p1', 'aabbccdd', again);
    restarted.session('p1')!.orderQuantity = 1;
    const replay = await restarted.handleAction('p1', again, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(replay.ok).toBe(true);
    expect(again.count('pumpkin')).toBe(0);
    expect(debits).toBe(1);
    expect(balances.get('p1')).toBe(90);
    restarted.session('p1')!.orderQuantity = 3;
    const changed = await restarted.handleAction('p1', again, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(changed).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    expect(again.count('pumpkin')).toBe(0);
    expect(debits).toBe(1);
    expect(balances.get('p1')).toBe(90);
    expect(restarted.get('aabbccdd')?.stock).toBe(4);
  });

  it('grants one stack for a charged postgres reservation and drops an uncharged one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-pg-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const holograms = new HologramNetwork(() => undefined);
    const chargedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const openId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const economy = {
      backend: 'postgres' as const,
      getBalance: () => 0,
      hasBalance: () => false,
      hasEconomicSource: async (_type: string, id: string) => id === chargedId,
    } as unknown as CurrencyPort;
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 2 });
    const saved = store.load<{ buyers: unknown[]; purchases?: unknown[] }>(BUYER_STORE_KEY, { buyers: [] });
    saved.purchases = [
      {
        id: chargedId, playerId: 'p1', buyerId: 'aabbccdd', itemId: 'pumpkin',
        quantity: 2, unitPrice: 10, total: 20, phase: 'reserved', createdAt: 1,
      },
      {
        id: openId, playerId: 'p2', buyerId: 'aabbccdd', itemId: 'pumpkin',
        quantity: 1, unitPrice: 10, total: 10, phase: 'reserved', createdAt: 2,
      },
    ];
    store.save(BUYER_STORE_KEY, saved);
    const loaded = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    loaded.load();
    expect(await loaded.recoverSellerPurchases(async (id) => id === chargedId)).toBe(2);
    const paid = new Inventory();
    const unpaid = new Inventory();
    loaded.restoreOverflow('p1', paid);
    loaded.restoreOverflow('p2', unpaid);
    expect(paid.count('pumpkin')).toBe(2);
    expect(unpaid.count('pumpkin')).toBe(0);
    expect(loaded.get('aabbccdd')?.stock).toBe(2);
    const again = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    again.load();
    const second = new Inventory();
    again.restoreOverflow('p1', second);
    expect(second.count('pumpkin')).toBe(0);
    expect(await again.recoverSellerPurchases(async () => true)).toBe(0);
  });

  it('keeps a charged postgres reservation when the seller NPC is deleted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-pg-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const holograms = new HologramNetwork(() => undefined);
    const chargedId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const economy = {
      backend: 'postgres' as const,
      getBalance: () => 0,
      hasBalance: () => false,
    } as unknown as CurrencyPort;
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 2 });
    const saved = store.load<{ buyers: unknown[]; purchases?: unknown[] }>(BUYER_STORE_KEY, { buyers: [] });
    saved.purchases = [{
      id: chargedId, playerId: 'p1', buyerId: 'aabbccdd', itemId: 'pumpkin',
      quantity: 1, unitPrice: 10, total: 10, phase: 'reserved', createdAt: 1,
    }];
    store.save(BUYER_STORE_KEY, saved);
    const loaded = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    loaded.load();
    expect(loaded.deleteById('aabbccdd').ok).toBe(true);
    expect(loaded.get('aabbccdd')).toBeUndefined();
    const kept = store.load<{ buyers: unknown[]; purchases?: Array<{ id: string }> }>(BUYER_STORE_KEY, { buyers: [] });
    expect(kept.purchases?.map((row) => row.id)).toEqual([chargedId]);
    expect(await loaded.recoverSellerPurchases(async (id) => id === chargedId)).toBe(1);
    const inventory = new Inventory();
    loaded.restoreOverflow('p1', inventory);
    expect(inventory.count('pumpkin')).toBe(1);
  });

  it('does not grant an item when a postgres seller debit fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-pg-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const holograms = new HologramNetwork(() => undefined);
    const economy = {
      backend: 'postgres' as const,
      getBalance: () => 100,
      hasBalance: () => true,
      hasEconomicSource: async () => false,
      withdrawSource: async () => ({ ok: false, error: 'Недостаточно Мегакоинов.' }),
    } as unknown as CurrencyPort;
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 2 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.session('p1')!.orderQuantity = 1;
    const failed = await buyer.handleAction('p1', inventory, {
      type: 'buyer_action',
      action: 'buy',
      clientRequestId: 'abababab-abab-4aba-8aba-abababababab',
    }, { edit: false, delete: false, use: true });
    expect(failed.ok).toBe(false);
    expect(inventory.count('pumpkin')).toBe(0);
    expect(buyer.get('aabbccdd')?.stock).toBe(2);
    const saved = store.load<{ buyers: unknown[]; purchases?: unknown[] }>(BUYER_STORE_KEY, { buyers: [] });
    expect(saved.purchases ?? []).toEqual([]);
  });

  it('does not open a seller trade until the item and price are saved', async () => {
    const { buyer } = await setup();
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    expect(buyer.handleAction('p1', inventory, { type: 'buyer_action', action: 'buy' }, {
      edit: false, delete: false, use: true,
    }).error).toBe(SELLER_NOT_CONFIGURED_ERROR);
  });

  it('rejects a different quantity, item, price, player, or NPC while an unpaid reservation is open', async () => {
    const requestId = '12121212-1212-4121-8121-121212121212';
    const { store, economy, holograms, buyer } = await setup();
    const ids = ['aabbccdd', '11223344'];
    let next = 0;
    const sequenced = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => ids[next++] ?? 'ccdd1122');
    sequenced.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    sequenced.create({ name: 'Вторая', role: 'seller', worldId: 'anarchy', x: 2, y: 64, z: 0, yaw: 0, pitch: 0 });
    sequenced.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 4 });
    sequenced.configure('11223344', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 4 });
    const inventory = new Inventory();
    sequenced.openTrade('p1', 'aabbccdd', inventory);
    sequenced.session('p1')!.orderQuantity = 1;
    sequenced.haltBeforeSellerCharge = true;
    expect(() => sequenced.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).toThrow('halt:before-charge');
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE);
    expect(inventory.count('pumpkin')).toBe(0);
    const reserved = store.load<{ buyers: unknown[]; purchases?: Array<{ id: string; quantity: number; total: number; phase: string }> }>(BUYER_STORE_KEY, { buyers: [] });
    expect(reserved.purchases).toEqual([expect.objectContaining({ id: requestId, quantity: 1, total: 10, phase: 'reserved' })]);

    sequenced.session('p1')!.orderQuantity = 2;
    const otherQuantity = sequenced.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(otherQuantity).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE);
    expect(inventory.count('pumpkin')).toBe(0);

    sequenced.configure('aabbccdd', { pricePerItem: 15 });
    sequenced.openTrade('p1', 'aabbccdd', inventory);
    sequenced.session('p1')!.orderQuantity = 1;
    const otherPrice = sequenced.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(otherPrice).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE);
    sequenced.configure('aabbccdd', { pricePerItem: 10 });

    sequenced.openTrade('p1', '11223344', inventory);
    sequenced.session('p1')!.orderQuantity = 1;
    const otherNpc = sequenced.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(otherNpc).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });

    const otherPlayerInventory = new Inventory();
    sequenced.openTrade('p2', 'aabbccdd', otherPlayerInventory);
    sequenced.session('p2')!.orderQuantity = 1;
    const otherPlayer = sequenced.handleAction('p2', otherPlayerInventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(otherPlayer).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    expect(economy.getBalance('p2')).toBe(ECONOMY_INITIAL_BALANCE);
    expect(otherPlayerInventory.count('pumpkin')).toBe(0);

    const restarted = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    restarted.load();
    const again = new Inventory();
    restarted.openTrade('p1', 'aabbccdd', again);
    restarted.session('p1')!.orderQuantity = 2;
    expect(restarted.handleAction('p1', again, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    restarted.session('p1')!.orderQuantity = 1;
    expect(restarted.handleAction('p1', again, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    expect(again.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    restarted.session('p1')!.orderQuantity = 1;
    expect(restarted.handleAction('p1', again, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    expect(again.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    expect(economy.getTransactionHistory('p1').filter((row) => row.reason === 'TRADER_PURCHASE')).toHaveLength(1);
  });

  it('rejects an unpaid postgres reservation when the same UUID changes quantity, item, or player', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-pg-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const holograms = new HologramNetwork(() => undefined);
    const requestId = '34343434-3434-4343-8343-343434343434';
    let debits = 0;
    const balances = new Map<string, number>([['p1', 100], ['p2', 100]]);
    const economy = {
      backend: 'postgres' as const,
      getBalance: (id: string) => balances.get(id) ?? 0,
      hasBalance: (id: string, amount: number) => (balances.get(id) ?? 0) >= amount,
      hasEconomicSource: async () => false,
      withdrawSource: async (playerId: string, amount: number) => {
        balances.set(playerId, (balances.get(playerId) ?? 0) - amount);
        debits += 1;
        return { ok: true, amount };
      },
    } as unknown as CurrencyPort;
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 4 });
    const saved = store.load<{ buyers: unknown[]; purchases?: unknown[] }>(BUYER_STORE_KEY, { buyers: [] });
    saved.purchases = [{
      id: requestId, playerId: 'p1', buyerId: 'aabbccdd', itemId: 'melon',
      quantity: 1, unitPrice: 10, total: 10, phase: 'reserved', createdAt: 1,
    }];
    store.save(BUYER_STORE_KEY, saved);
    const loaded = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    loaded.load();
    const inventory = new Inventory();
    loaded.openTrade('p1', 'aabbccdd', inventory);
    loaded.session('p1')!.orderQuantity = 1;
    expect(await loaded.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    expect(debits).toBe(0);
    expect(inventory.count('pumpkin')).toBe(0);
    const replaced = store.load<{
      buyers: unknown[];
      purchases?: Array<{
        id: string;
        playerId: string;
        buyerId: string;
        itemId: string;
        quantity: number;
        unitPrice: number;
        total: number;
        phase: string;
        createdAt: number;
      }>;
    }>(BUYER_STORE_KEY, { buyers: [] });
    replaced.purchases = [{
      id: requestId, playerId: 'p1', buyerId: 'aabbccdd', itemId: 'pumpkin',
      quantity: 1, unitPrice: 10, total: 10, phase: 'reserved', createdAt: 1,
    }];
    store.save(BUYER_STORE_KEY, replaced);
    const retry = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    retry.load();
    const first = new Inventory();
    const second = new Inventory();
    retry.openTrade('p1', 'aabbccdd', first);
    retry.openTrade('p2', 'aabbccdd', second);
    retry.session('p1')!.orderQuantity = 3;
    expect(await retry.handleAction('p1', first, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    retry.session('p2')!.orderQuantity = 1;
    expect(await retry.handleAction('p2', second, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    expect(debits).toBe(0);
    expect(balances.get('p1')).toBe(100);
    expect(balances.get('p2')).toBe(100);
    retry.session('p1')!.orderQuantity = 1;
    expect((await retry.handleAction('p1', first, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).ok).toBe(true);
    expect(first.count('pumpkin')).toBe(1);
    expect(debits).toBe(1);
    retry.session('p1')!.orderQuantity = 1;
    expect((await retry.handleAction('p1', first, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).ok).toBe(true);
    expect(first.count('pumpkin')).toBe(1);
    expect(debits).toBe(1);
    expect(balances.get('p1')).toBe(90);
  });

  it('restarts seller purchases from each saved step without a second debit or a second item', async () => {
    const requestId = '56565656-5656-4565-8565-565656565656';
    const { store, economy, holograms, buyer } = await setup();
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 4 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.session('p1')!.orderQuantity = 1;
    let persistCalls = 0;
    buyer.haltBuyerPersist = () => {
      persistCalls += 1;
      return persistCalls === 2;
    };
    expect(() => buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).toThrow('halt:buyer-persist');
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    expect(inventory.count('pumpkin')).toBe(0);
    buyer.haltBuyerPersist = undefined;
    const charged = new BuyerService(store, new EconomyService(store), holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    charged.load();
    const owed = new Inventory();
    charged.restoreOverflow('p1', owed);
    expect(owed.count('pumpkin')).toBe(1);
    const chargedEconomy = new EconomyService(store);
    expect(chargedEconomy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    charged.openTrade('p1', 'aabbccdd', owed);
    charged.session('p1')!.orderQuantity = 1;
    expect(charged.handleAction('p1', owed, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    expect(owed.count('pumpkin')).toBe(1);
    expect(new EconomyService(store).getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);

    const paidFile = store.load<{
      buyers: unknown[];
      purchases?: unknown[];
      returns?: Record<string, unknown>;
      settledPurchases?: unknown[];
      grantedPurchaseIds?: string[];
    }>(BUYER_STORE_KEY, { buyers: [] });
    paidFile.purchases = [{
      id: requestId, playerId: 'p1', buyerId: 'aabbccdd', itemId: 'pumpkin',
      quantity: 1, unitPrice: 10, total: 10, phase: 'paid', createdAt: 1,
    }];
    paidFile.returns = {};
    paidFile.grantedPurchaseIds = [];
    store.save(BUYER_STORE_KEY, paidFile);
    const paidOnly = new BuyerService(store, new EconomyService(store), holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    paidOnly.load();
    const paidInventory = new Inventory();
    paidOnly.restoreOverflow('p1', paidInventory);
    expect(paidInventory.count('pumpkin')).toBe(1);
    expect(new EconomyService(store).getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);

    const both = store.load<typeof paidFile>(BUYER_STORE_KEY, { buyers: [] });
    both.purchases = [{
      id: requestId, playerId: 'p1', buyerId: 'aabbccdd', itemId: 'pumpkin',
      quantity: 1, unitPrice: 10, total: 10, phase: 'paid', createdAt: 1,
    }];
    both.returns = { p1: { itemId: 'pumpkin', count: 1 } };
    both.grantedPurchaseIds = [requestId];
    store.save(BUYER_STORE_KEY, both);
    const returnedAndReserved = new BuyerService(store, new EconomyService(store), holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    returnedAndReserved.load();
    const once = new Inventory();
    returnedAndReserved.restoreOverflow('p1', once);
    expect(once.count('pumpkin')).toBe(1);
    const after = store.load<typeof paidFile>(BUYER_STORE_KEY, { buyers: [] });
    expect(after.purchases ?? []).toEqual([]);
    expect(new EconomyService(store).getTransactionHistory('p1').filter((row) => row.reason === 'TRADER_PURCHASE')).toHaveLength(1);
  });

  it('does not report success when the buyer file write fails, and the retry grants once', async () => {
    const requestId = '78787878-7878-4787-8787-787878787878';
    const { economy, buyer } = await setup();
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 4 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.session('p1')!.orderQuantity = 1;
    let persistCalls = 0;
    buyer.haltBuyerPersist = () => {
      persistCalls += 1;
      return persistCalls === 2;
    };
    expect(() => buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).toThrow('halt:buyer-persist');
    expect(inventory.count('pumpkin')).toBe(0);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    buyer.haltBuyerPersist = undefined;
    buyer.session('p1')!.orderQuantity = 1;
    expect(buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    expect(inventory.count('pumpkin')).toBe(1);
    expect(economy.getBalance('p1')).toBe(ECONOMY_INITIAL_BALANCE - 10);
    expect(economy.getTransactionHistory('p1').filter((row) => row.reason === 'TRADER_PURCHASE')).toHaveLength(1);
  });

  it('grants one postgres item when the buyer file write fails after the debit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-buyer-pg-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const holograms = new HologramNetwork(() => undefined);
    const requestId = '90909090-9090-4909-8909-909090909090';
    let debits = 0;
    const sources = new Set<string>();
    const balances = new Map<string, number>([['p1', 100]]);
    const economy = {
      backend: 'postgres' as const,
      getBalance: (id: string) => balances.get(id) ?? 0,
      hasBalance: (id: string, amount: number) => (balances.get(id) ?? 0) >= amount,
      hasEconomicSource: async (_type: string, id: string) => sources.has(id),
      withdrawSource: async (playerId: string, amount: number, _reason: string, sourceId: string) => {
        if (sources.has(sourceId)) return { ok: true, replayed: true, amount };
        balances.set(playerId, (balances.get(playerId) ?? 0) - amount);
        sources.add(sourceId);
        debits += 1;
        return { ok: true, amount };
      },
    } as unknown as CurrencyPort;
    const buyer = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    buyer.create({ name: 'Лавка', role: 'seller', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 10, role: 'seller', stock: 4 });
    const inventory = new Inventory();
    buyer.openTrade('p1', 'aabbccdd', inventory);
    buyer.session('p1')!.orderQuantity = 1;
    let persistCalls = 0;
    buyer.haltBuyerPersist = () => {
      persistCalls += 1;
      return persistCalls === 2;
    };
    await expect(buyer.handleAction('p1', inventory, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).rejects.toThrow('halt:buyer-persist');
    expect(debits).toBe(1);
    expect(inventory.count('pumpkin')).toBe(0);
    const restarted = new BuyerService(store, economy, holograms, () => 'anarchy', () => 1_000, () => 'aabbccdd');
    restarted.load();
    expect(await restarted.recoverSellerPurchases(async (id) => sources.has(id))).toBe(1);
    const owed = new Inventory();
    restarted.restoreOverflow('p1', owed);
    expect(owed.count('pumpkin')).toBe(1);
    restarted.openTrade('p1', 'aabbccdd', owed);
    restarted.session('p1')!.orderQuantity = 1;
    expect((await restarted.handleAction('p1', owed, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).ok).toBe(true);
    expect(owed.count('pumpkin')).toBe(1);
    expect(debits).toBe(1);
    expect(balances.get('p1')).toBe(90);
    restarted.session('p1')!.orderQuantity = 4;
    expect(await restarted.handleAction('p1', owed, {
      type: 'buyer_action', action: 'buy', clientRequestId: requestId,
    }, { edit: false, delete: false, use: true })).toMatchObject({ ok: false, error: 'Этот запрос уже обработан.' });
    expect(debits).toBe(1);
    expect(owed.count('pumpkin')).toBe(1);
  });
});

