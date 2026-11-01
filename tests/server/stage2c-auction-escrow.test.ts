import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { EconomyService } from '../../server/services/economy';
import { AuctionService } from '../../server/services/auction';
import { JsonFileStore } from '../../server/services/jsonStore';
import type { ItemDurability } from '../../server/settlements/durability';
import { auctionListingReceipt } from '../../server/settlements/receipts';
import { BlockRewardBarrier } from '../../server/settlements/blockRewardBarrier';

class Bag implements ItemDurability {
  readonly receipts = new Set<string>();
  removed = false;
  async escrow(_playerId: string, receipt: string): Promise<void> {
    this.receipts.add(receipt);
    this.removed = true;
  }
  hasReceipt(_playerId: string, receipt: string): boolean {
    return this.receipts.has(receipt);
  }
  async deliver(): Promise<'delivered'> { return 'delivered'; }
  async deliverAll(): Promise<'delivered'> { return 'delivered'; }
  async restore(): Promise<'restored'> { return 'restored'; }
  async restoreAll(): Promise<'restored'> { return 'restored'; }
  async dropReceipt(_playerId: string, receipt: string): Promise<void> {
    this.receipts.delete(receipt);
  }
}

describe('stage 2C auction listing escrow', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-s2c-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const auction = new AuctionService(store, economy, () => 1_000);
    const bag = new Bag();
    auction.setStage2C({ durability: bag });
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('diamond', 1));
    const disk = inventory.clone();
    return { store, economy, auction, bag, inventory, disk };
  }

  it('drops a pending listing when the seller inventory was not durably updated', async () => {
    const { store, economy, auction, inventory, disk } = await setup();
    auction.haltAfter = 'listing-pending';
    const listed = await auction.createListing('ada', 'Ada', inventory, 0, 1, 10);
    expect(listed.ok).toBe(false);
    expect(auction.queryBrowse().totalCount).toBe(0);
    expect(disk.count('diamond')).toBe(1);
    const restarted = new AuctionService(store, economy, () => 1_000);
    restarted.setStage2C({ durability: new Bag() });
    expect(restarted.recoverPendingListings()).toBe(1);
    expect(restarted.queryBrowse().totalCount).toBe(0);
    expect(disk.count('diamond')).toBe(1);
  });

  it('activates a listing whose removal receipt is already durable', async () => {
    const { store, economy, auction, bag, inventory } = await setup();
    auction.haltAfter = 'listing-removed';
    await auction.createListing('ada', 'Ada', inventory, 0, 1, 10);
    expect(bag.removed).toBe(true);
    expect(inventory.count('diamond')).toBe(0);
    const restarted = new AuctionService(store, economy, () => 1_000);
    restarted.setStage2C({ durability: bag });
    expect(restarted.recoverPendingListings()).toBe(1);
    const page = restarted.queryBrowse();
    expect(page.totalCount).toBe(1);
    expect(page.listings[0]?.status).toBe('ACTIVE');
    expect(bag.hasReceipt('ada', auctionListingReceipt(page.listings[0]!.economySettlementId))).toBe(true);
  });

  it('keeps one active copy after a finished listing create', async () => {
    const { auction, inventory } = await setup();
    const listed = await auction.createListing('ada', 'Ada', inventory, 0, 1, 10);
    expect(listed.ok).toBe(true);
    expect(listed.listing?.status).toBe('ACTIVE');
    expect(inventory.count('diamond')).toBe(0);
    expect(auction.queryBrowse().totalCount).toBe(1);
  });
});

describe('block reward durability barrier', () => {
  it('pays only after a successful save and coalesces a batch', async () => {
    const paid: string[] = [];
    let saves = 0;
    let release: (ok: boolean) => void = () => {};
    const barrier = new BlockRewardBarrier<string>(
      () => new Promise((resolve) => { saves += 1; release = resolve; }),
      async (id) => { paid.push(id); },
    );
    barrier.submit('a');
    barrier.submit('b');
    await new Promise((resolve) => setImmediate(resolve));
    expect(saves).toBe(1);
    expect(paid).toEqual([]);
    barrier.submit('c');
    release(true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(paid).toEqual(['a', 'b']);
    expect(saves).toBe(2);
    release(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(paid).toEqual(['a', 'b', 'c']);
  });

  it('does not pay when the save fails', async () => {
    const paid: string[] = [];
    const barrier = new BlockRewardBarrier<string>(async () => false, async (id) => { paid.push(id); });
    barrier.submit('ore');
    await new Promise((resolve) => setImmediate(resolve));
    expect(paid).toEqual([]);
    expect(barrier.pendingCount).toBe(1);
  });
});
