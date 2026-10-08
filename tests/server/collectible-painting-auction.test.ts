import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService } from '../../server/services/economy';
import {
  AUCTION_DURATION_MS,
  AUCTION_MIN_PRICE,
  AuctionService,
  listingMatchesSearch,
} from '../../server/services/auction';

describe('collectible paintings on the auction house', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(now?: () => number) {
    const dir = await mkdtemp(join(tmpdir(), 'fc-paint-ah-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store, now);
    const auction = new AuctionService(store, economy, now);
    return { store, economy, auction };
  }

  it('lists, buys, cancels, relists, expires, claims, and restarts the exact item', async () => {
    let now = 1_000;
    const { auction, economy, store } = await setup(() => now);
    economy.setBalance('buyer', 1_000, 'ADMIN_SET');
    const seller = new Inventory();
    seller.setSlot(0, createItemStack(ItemId.Painting07SunnyBee));
    const created = auction.createListing('seller', 'Ada', seller, 0, 1, AUCTION_MIN_PRICE);
    expect(created.ok).toBe(true);
    expect(created.listing?.item.itemId).toBe(ItemId.Painting07SunnyBee);
    expect(created.listing?.item.count).toBe(1);
    expect(created.listing?.price).toBe(AUCTION_MIN_PRICE);
    expect(seller.getSlot(0)).toBeNull();
    expect(auction.toNetworkListing(created.listing!).itemName).toBe('Коллекционная картина #7');
    expect(listingMatchesSearch(created.listing!, 'коллекционная картина #7')).toBe(true);
    expect(listingMatchesSearch(created.listing!, 'collectible painting #7')).toBe(true);
    expect(listingMatchesSearch(created.listing!, 'солнечная')).toBe(false);
    expect(listingMatchesSearch(created.listing!, 'муся')).toBe(false);

    const buyer = new Inventory();
    const bought = auction.buyListing('buyer', 'Bob', buyer, created.listing!.listingId);
    expect(bought.ok).toBe(true);
    expect(buyer.getSlot(0)).toEqual(createItemStack(ItemId.Painting07SunnyBee));
    expect(auction.historyRows('seller')[0]?.title).toContain('Коллекционная картина #7');
    expect(auction.historyRows('buyer')[0]?.title).toContain('Коллекционная картина #7');

    seller.setSlot(1, createItemStack(ItemId.Painting20TigerMusya));
    const listed = auction.createListing('seller', 'Ada', seller, 1, 1, 50);
    expect(listed.ok).toBe(true);
    expect(auction.cancelListing('seller', listed.listing!.listingId).ok).toBe(true);
    const claim = new Inventory();
    expect(auction.claimListing('seller', claim, listed.listing!.listingId).ok).toBe(true);
    expect(claim.getSlot(0)?.itemId).toBe(ItemId.Painting20TigerMusya);

    seller.setSlot(2, createItemStack(ItemId.Painting11CrowdScream));
    const expiring = auction.createListing('seller', 'Ada', seller, 2, 1, 80);
    expect(expiring.ok).toBe(true);
    now += AUCTION_DURATION_MS + 1;
    expect(auction.expireDue()).toBeGreaterThan(0);
    expect(auction.getListing(expiring.listing!.listingId)?.status).toBe('EXPIRED');
    const expiredClaim = new Inventory();
    expect(auction.claimListing('seller', expiredClaim, expiring.listing!.listingId).ok).toBe(true);
    expect(expiredClaim.getSlot(0)?.itemId).toBe(ItemId.Painting11CrowdScream);

    seller.setSlot(3, createItemStack(ItemId.Painting09RainbowGhast));
    const active = auction.createListing('seller', 'Ada', seller, 3, 1, 90);
    expect(active.ok).toBe(true);
    const relisted = auction.relist('seller', active.listing!.listingId, 120);
    expect(relisted.ok).toBe(true);
    expect(relisted.listing?.item.itemId).toBe(ItemId.Painting09RainbowGhast);
    expect(relisted.listing?.price).toBe(120);

    const restarted = new AuctionService(store, economy, () => now);
    const again = restarted.getListing(relisted.listing!.listingId);
    expect(again?.status).toBe('ACTIVE');
    expect(again?.item).toEqual(createItemStack(ItemId.Painting09RainbowGhast));
    expect(again?.price).toBe(120);
  });
});
