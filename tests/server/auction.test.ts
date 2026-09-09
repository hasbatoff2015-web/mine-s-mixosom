import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { parseClientMessage } from '../../shared/protocol';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService } from '../../server/services/economy';
import {
  AUCTION_DURATION_MS,
  AUCTION_MAX_ACTIVE,
  AUCTION_MAX_PRICE,
  AUCTION_MIN_PRICE,
  AUCTION_PAGE_SIZE,
  AuctionService,
  listingMatchesSearch,
  parseAuctionPrice,
} from '../../server/services/auction';

describe('Auction price parsing', () => {
  it('accepts integer prices in range and rejects the rest', () => {
    expect(parseAuctionPrice(10)).toBe(10);
    expect(parseAuctionPrice('5000')).toBe(5000);
    expect(parseAuctionPrice(AUCTION_MAX_PRICE)).toBe(AUCTION_MAX_PRICE);
    expect(parseAuctionPrice(0)).toBeUndefined();
    expect(parseAuctionPrice(-1)).toBeUndefined();
    expect(parseAuctionPrice(9)).toBeUndefined();
    expect(parseAuctionPrice(AUCTION_MAX_PRICE + 1)).toBeUndefined();
    expect(parseAuctionPrice(10.5)).toBeUndefined();
    expect(parseAuctionPrice('10.5')).toBeUndefined();
    expect(parseAuctionPrice('1k')).toBeUndefined();
    expect(parseAuctionPrice('5,000')).toBeUndefined();
    expect(parseAuctionPrice('abc')).toBeUndefined();
    expect(parseAuctionPrice('')).toBeUndefined();
  });
});

describe('AuctionService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(now?: () => number) {
    const dir = await mkdtemp(join(tmpdir(), 'fc-ah-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store, now);
    const auction = new AuctionService(store, economy, now);
    return { store, economy, auction };
  }

  function fill(inventory: Inventory, itemId: string, count: number, slot = 0): void {
    inventory.setSlot(slot, createItemStack(itemId, count));
  }

  it('creates a listing, removes the exact stack, and keeps item metadata', async () => {
    const { auction } = await setup();
    const inventory = new Inventory();
    const item = createItemStack('diamond_pickaxe', 1, {
      durability: 800,
      metadata: { customName: 'Lucky', lore: ['From Ada'] },
    });
    inventory.setSlot(3, item);
    const created = auction.createListing('seller', 'Ada', inventory, 3, 1, 250, item);
    expect(created.ok).toBe(true);
    expect(inventory.getSlot(3)).toBeNull();
    expect(created.listing?.item.metadata).toEqual({ customName: 'Lucky', lore: ['From Ada'] });
    expect(created.listing?.item.durability).toBe(800);
    expect(created.listing?.expiresAt).toBe(created.listing!.createdAt + AUCTION_DURATION_MS);
  });

  it('persists listings across a new AuctionService on the same store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-ah-persist-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const first = new AuctionService(store, economy);
    const inventory = new Inventory();
    fill(inventory, 'diamond', 32);
    const created = first.createListing('seller', 'Ada', inventory, 0, 32, 5000);
    expect(created.ok).toBe(true);
    const second = new AuctionService(store, economy);
    const listing = second.getListing(created.listing!.listingId);
    expect(listing?.status).toBe('ACTIVE');
    expect(listing?.item).toEqual(createItemStack('diamond', 32));
    expect(listing?.price).toBe(5000);
  });

  it('extracts a partial stack and leaves the remainder', async () => {
    const { auction } = await setup();
    const inventory = new Inventory();
    fill(inventory, 'stone', 64);
    const created = auction.createListing('seller', 'Ada', inventory, 0, 20, 10);
    expect(created.ok).toBe(true);
    expect(created.listing?.item.count).toBe(20);
    expect(inventory.getSlot(0)?.count).toBe(44);
  });

  it('rejects a second extract from a stack that no longer matches', async () => {
    const { auction } = await setup();
    const inventory = new Inventory();
    fill(inventory, 'stone', 64);
    const expected = createItemStack('stone', 64);
    expect(auction.createListing('seller', 'Ada', inventory, 0, 64, 10, expected).ok).toBe(true);
    expect(auction.createListing('seller', 'Ada', inventory, 0, 64, 10, expected).ok).toBe(false);
    expect(auction.createListing('seller', 'Ada', inventory, 0, 1, 10, expected).error)
      .toBe('Предмет больше недоступен для продажи.');
  });

  it('rejects listing when the slot item changed before confirm', async () => {
    const { auction } = await setup();
    const inventory = new Inventory();
    fill(inventory, 'stone', 32);
    const expected = createItemStack('stone', 32);
    inventory.setSlot(0, createItemStack('dirt', 32));
    const result = auction.createListing('seller', 'Ada', inventory, 0, 32, 10, expected);
    expect(result.ok).toBe(false);
    expect(inventory.getSlot(0)?.itemId).toBe('dirt');
  });

  it('enforces the 30 active listing limit and frees it on cancel/expire', async () => {
    const { auction } = await setup();
    const inventory = new Inventory();
    for (let i = 0; i < AUCTION_MAX_ACTIVE; i += 1) {
      fill(inventory, 'dirt', 1, 0);
      expect(auction.createListing('seller', 'Ada', inventory, 0, 1, 10).ok).toBe(true);
    }
    fill(inventory, 'dirt', 1, 0);
    const blocked = auction.createListing('seller', 'Ada', inventory, 0, 1, 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe(`У вас уже максимальное количество товаров на аукционе: ${AUCTION_MAX_ACTIVE}.`);
    const first = [...auction.queryMine('seller').listings][0]!;
    expect(auction.cancelListing('seller', first.listingId).ok).toBe(true);
    fill(inventory, 'dirt', 1, 0);
    expect(auction.createListing('seller', 'Ada', inventory, 0, 1, 10).ok).toBe(true);
    expect(auction.activeCount('seller')).toBe(AUCTION_MAX_ACTIVE);
  });

  it('does not count expired listings toward the active limit', async () => {
    let now = 1_000;
    const { auction } = await setup(() => now);
    const inventory = new Inventory();
    for (let i = 0; i < AUCTION_MAX_ACTIVE; i += 1) {
      fill(inventory, 'dirt', 1, 0);
      expect(auction.createListing('seller', 'Ada', inventory, 0, 1, 10).ok).toBe(true);
    }
    now += AUCTION_DURATION_MS + 1;
    expect(auction.expireDue()).toBe(AUCTION_MAX_ACTIVE);
    expect(auction.activeCount('seller')).toBe(0);
    fill(inventory, 'dirt', 1, 0);
    expect(auction.createListing('seller', 'Ada', inventory, 0, 1, 10).ok).toBe(true);
    expect(auction.activeCount('seller')).toBe(1);
  });

  it('expires active listings into returnable storage without returning items', async () => {
    let now = 1_000;
    const { auction } = await setup(() => now);
    const inventory = new Inventory();
    fill(inventory, 'gold_ingot', 8);
    const created = auction.createListing('seller', 'Ada', inventory, 0, 8, 40);
    now += AUCTION_DURATION_MS + 1;
    expect(auction.expireDue()).toBeGreaterThan(0);
    const listing = auction.getListing(created.listing!.listingId)!;
    expect(listing.status).toBe('EXPIRED');
    expect(inventory.getSlot(0)).toBeNull();
    const mine = auction.queryMine('seller');
    expect(mine.listings[0]?.status).toBe('EXPIRED');
    expect(auction.queryBrowse().totalCount).toBe(0);
  });

  it('buys atomically, pays the offline seller, and rejects a duplicate buy', async () => {
    const { auction, economy } = await setup();
    economy.setBalance('buyer', 1_000, 'ADMIN_SET');
    const sellerInv = new Inventory();
    fill(sellerInv, 'diamond', 3);
    const created = auction.createListing('seller', 'Ada', sellerInv, 0, 3, 250);
    const buyerInv = new Inventory();
    const bought = auction.buyListing('buyer', 'Bob', buyerInv, created.listing!.listingId);
    expect(bought.ok).toBe(true);
    expect(buyerInv.getSlot(0)).toEqual(createItemStack('diamond', 3));
    expect(sellerInv.getSlot(0)).toBeNull();
    expect(economy.getBalance('buyer')).toBe(750);
    expect(economy.getBalance('seller')).toBe(350);
    const buyTx = economy.getTransactionHistory('buyer')[0]!;
    const saleTx = economy.getTransactionHistory('seller')[0]!;
    expect(buyTx.reason).toBe('AUCTION_PURCHASE');
    expect(saleTx.reason).toBe('AUCTION_SALE');
    expect(buyTx.pairId).toBe(created.listing!.listingId);
    expect(saleTx.pairId).toBe(created.listing!.listingId);
    const again = auction.buyListing('other', 'Carl', new Inventory(), created.listing!.listingId);
    expect(again.ok).toBe(false);
    expect(again.error).toBe('Этот товар уже продан.');
    expect(economy.getBalance('buyer')).toBe(750);
  });

  it('rejects self-buy, poor buyers, full inventories, expired and cancelled lots', async () => {
    const { auction, economy } = await setup();
    const sellerInv = new Inventory();
    fill(sellerInv, 'iron_ingot', 1);
    const created = auction.createListing('seller', 'Ada', sellerInv, 0, 1, 50)!;
    expect(auction.buyListing('seller', 'Ada', new Inventory(), created.listing!.listingId).error)
      .toBe('Нельзя купить собственный товар.');
    economy.setBalance('broke', 0, 'ADMIN_SET');
    expect(auction.buyListing('broke', 'Bob', new Inventory(), created.listing!.listingId).error)
      .toBe('Недостаточно Мегакоинов.');
    economy.setBalance('full', 500, 'ADMIN_SET');
    const full = new Inventory();
    for (let i = 0; i < Inventory.SLOT_COUNT; i += 1) full.setSlot(i, createItemStack('dirt', 64));
    expect(auction.buyListing('full', 'Carl', full, created.listing!.listingId).error)
      .toBe('Недостаточно места в инвентаре.');
    expect(full.getSlot(0)?.itemId).toBe('dirt');
    expect(auction.getListing(created.listing!.listingId)?.status).toBe('ACTIVE');

    const extraInv = new Inventory();
    fill(extraInv, 'coal', 1);
    const extra = auction.createListing('seller', 'Ada', extraInv, 0, 1, 10);
    expect(auction.cancelListing('seller', extra.listing!.listingId).ok).toBe(true);
    economy.setBalance('buyer', 100, 'ADMIN_SET');
    expect(auction.buyListing('buyer', 'Bob', new Inventory(), extra.listing!.listingId).error)
      .toBe('Этот товар уже продан.');
  });

  it('does not let two sequential buyers both receive the same listing', async () => {
    const { auction, economy } = await setup();
    const sellerInv = new Inventory();
    fill(sellerInv, 'diamond', 1);
    const created = auction.createListing('seller', 'Ada', sellerInv, 0, 1, 10);
    economy.setBalance('a', 100, 'ADMIN_SET');
    economy.setBalance('b', 100, 'ADMIN_SET');
    const first = auction.buyListing('a', 'A', new Inventory(), created.listing!.listingId);
    const second = auction.buyListing('b', 'B', new Inventory(), created.listing!.listingId);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(economy.getBalance('a')).toBe(90);
    expect(economy.getBalance('b')).toBe(100);
    expect(economy.getBalance('seller')).toBe(110);
  });

  it('searches by display name case-insensitively and paginates newest first', async () => {
    const { auction } = await setup();
    const inventory = new Inventory();
    fill(inventory, 'stone', 1, 0);
    auction.createListing('s1', 'A', inventory, 0, 1, 10);
    fill(inventory, 'diamond', 1, 0);
    auction.createListing('s2', 'B', inventory, 0, 1, 10);
    fill(inventory, 'diamond_ore', 1, 0);
    auction.createListing('s3', 'C', inventory, 0, 1, 10);
    const diamond = auction.queryBrowse({ search: 'DiAmOnD' });
    expect(diamond.listings.map((listing) => listing.item.itemId).sort()).toEqual(['diamond', 'diamond_ore']);
    expect(listingMatchesSearch(diamond.listings.find((listing) => listing.item.itemId === 'diamond')!, 'алмаз')).toBe(true);
    expect(auction.queryBrowse({ search: 'нет такого' }).totalCount).toBe(0);
  });

  it('paginates newest first and clamps the page after the last item is bought', async () => {
    const { auction, economy } = await setup();
    economy.setBalance('buyer', 1_000, 'ADMIN_SET');
    const inventory = new Inventory();
    for (let i = 0; i < AUCTION_PAGE_SIZE + 1; i += 1) {
      fill(inventory, 'dirt', 1, 0);
      auction.createListing(`p${i}`, 'P', inventory, 0, 1, 10);
    }
    const empty = auction.queryBrowse({ search: 'zzzz-nope' });
    expect(empty.totalCount).toBe(0);
    expect(empty.page).toBe(1);
    expect(empty.totalPages).toBe(1);
    const page1 = auction.queryBrowse({ page: 1 });
    const page2 = auction.queryBrowse({ page: 2 });
    expect(page1.totalPages).toBe(2);
    expect(page1.listings).toHaveLength(AUCTION_PAGE_SIZE);
    expect(page2.listings).toHaveLength(1);
    expect(page1.listings[0]!.createdAt).toBeGreaterThanOrEqual(page1.listings[1]!.createdAt);
    const afterBuy = auction.buyListing('buyer', 'Bob', new Inventory(), page2.listings[0]!.listingId);
    expect(afterBuy.ok).toBe(true);
    const reclamped = auction.queryBrowse({ page: 5 });
    expect(reclamped.page).toBe(1);
    expect(reclamped.totalPages).toBe(1);
    expect(reclamped.listings).toHaveLength(AUCTION_PAGE_SIZE);
  });

  it('cancels to returnable, claims only with space, and rejects a duplicate claim', async () => {
    const { auction } = await setup();
    const inventory = new Inventory();
    fill(inventory, 'gold_ingot', 12);
    const created = auction.createListing('seller', 'Ada', inventory, 0, 12, 30);
    expect(auction.cancelListing('seller', created.listing!.listingId).ok).toBe(true);
    expect(inventory.getSlot(0)).toBeNull();
    const full = new Inventory();
    for (let i = 0; i < Inventory.SLOT_COUNT; i += 1) full.setSlot(i, createItemStack('dirt', 64));
    expect(auction.claimListing('seller', full, created.listing!.listingId).error)
      .toBe('Недостаточно места в инвентаре.');
    expect(auction.getListing(created.listing!.listingId)?.status).toBe('CANCELLED');
    const empty = new Inventory();
    expect(auction.claimListing('seller', empty, created.listing!.listingId).ok).toBe(true);
    expect(empty.getSlot(0)).toEqual(createItemStack('gold_ingot', 12));
    expect(auction.claimListing('seller', empty, created.listing!.listingId).ok).toBe(false);
    expect(auction.getListing(created.listing!.listingId)?.status).toBe('CLAIMED');
  });

  it('relists atomically with a fresh timer and does not duplicate the item', async () => {
    let now = 5_000;
    const { auction } = await setup(() => now);
    const inventory = new Inventory();
    fill(inventory, 'diamond', 2);
    const created = auction.createListing('seller', 'Ada', inventory, 0, 2, 40);
    now += 1_000;
    const relist = auction.relist('seller', created.listing!.listingId, 80);
    expect(relist.ok).toBe(true);
    expect(relist.previous?.status).toBe('RELISTED');
    expect(relist.listing?.status).toBe('ACTIVE');
    expect(relist.listing?.createdAt).toBe(now);
    expect(relist.listing?.expiresAt).toBe(now + AUCTION_DURATION_MS);
    expect(relist.listing?.listingId).not.toBe(created.listing!.listingId);
    expect(inventory.getSlot(0)).toBeNull();
    expect(auction.queryBrowse().totalCount).toBe(1);
    expect(auction.claimListing('seller', new Inventory(), created.listing!.listingId).ok).toBe(false);
    expect(auction.relist('seller', created.listing!.listingId, 90).ok).toBe(false);
  });

  it('keeps the old listing active if relist price is invalid', async () => {
    const { auction } = await setup();
    const inventory = new Inventory();
    fill(inventory, 'stone', 1);
    const created = auction.createListing('seller', 'Ada', inventory, 0, 1, 10);
    expect(auction.relist('seller', created.listing!.listingId, 5).ok).toBe(false);
    expect(auction.getListing(created.listing!.listingId)?.status).toBe('ACTIVE');
  });

  it('parses auction protocol intents', () => {
    expect(parseClientMessage({ type: 'auction_action', action: 'buy', listingId: 'ah-1' })).toMatchObject({
      type: 'auction_action',
      action: 'buy',
      listingId: 'ah-1',
    });
    expect(parseClientMessage({ type: 'auction_action', action: 'create', slot: 3, amount: 20, price: '5000' }))
      .toMatchObject({ action: 'create', slot: 3, amount: 20, price: '5000' });
    expect(parseClientMessage({ type: 'auction_action', action: 'explode' }))
      .toEqual({ error: 'auction_action.action invalid' });
  });
});
