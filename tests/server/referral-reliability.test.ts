import { describe, expect, it } from 'vitest';
import type { EffectiveRank } from '../../shared/donationRanks';
import { REFERRAL_ACTIVE_SECONDS, REFERRAL_REWARD_MS } from '../../shared/referral';
import { RESOURCE_SOURCE_KEY_LIMIT, ResourceLedger } from '../../server/resources/accounting';
import { ItemId } from '../../src/items';
import { MemoryReferralRepository } from '../../server/referral/memoryRepository';
import { ReferralService, type ReferralKitDelivery } from '../../server/referral/service';
import type { RewardRow } from '../../server/referral/types';

function pid(n: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${n.toString(16).padStart(12, '0')}`;
}

function serviceFor(repo: MemoryReferralRepository, options: {
  now?: () => number;
  paidRank?: () => EffectiveRank;
  connectionLive?: (playerId: string) => string | null;
  items?: { itemId: string; count: number }[] | null;
  delivery?: ReferralKitDelivery | null;
} = {}): ReferralService {
  return ReferralService.create({
    repository: repo,
    activityEnabled: true,
    devTools: true,
    publicGameUrl: null,
    now: options.now ?? (() => 1_700_000_000_000),
    paidRank: options.paidRank ?? (() => 'default'),
    paidRankUnreadable: () => false,
    displayName: (id) => id.slice(0, 4),
    yandexLink: async () => 'unknown',
    kitItems: () => options.items === undefined ? [{ itemId: 'stone', count: 2 }, { itemId: ItemId.Diamond, count: 1 }] : options.items,
    kitDelivery: () => options.delivery ?? null,
    notify: () => undefined,
    onBenefitsChanged: () => undefined,
    connectionLive: options.connectionLive,
  });
}

describe('referral reward writes', () => {
  it('keeps the newer reward snapshot when an older save finishes last', async () => {
    const repo = new MemoryReferralRepository();
    await repo.ensureMilestones(pid(1), 5, 1_700_000_000_000);
    const rows = await repo.rewards(pid(1));
    expect(rows.map((row) => row.milestone).sort()).toEqual(['3_confirmed', '5_confirmed']);
    const later = rows.map((row) => ({
      ...row,
      status: 'active' as const,
      revision: 2,
      activatedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + REFERRAL_REWARD_MS,
    }));
    const earlier = rows.map((row) => ({
      ...row,
      status: 'paused' as const,
      revision: 1,
      activatedAt: null,
      expiresAt: null,
      remainingMs: REFERRAL_REWARD_MS,
    }));
    await repo.saveRewards(later);
    await repo.saveRewards(earlier);
    const saved = await repo.rewards(pid(1));
    expect(saved.every((row) => row.status === 'active' && row.revision === 2)).toBe(true);

    const paused = saved.map((row) => ({ ...row, status: 'paused' as const, revision: 3, expiresAt: null }));
    await repo.saveRewards(paused);
    const expired = saved.map((row) => ({ ...row, status: 'expired' as const, revision: 4, remainingMs: 0, expiresAt: null }));
    await repo.saveRewards(expired);
    await repo.saveRewards(paused);
    const finalRows = await repo.rewards(pid(1));
    expect(finalRows.every((row) => row.status === 'expired' && row.revision === 4)).toBe(true);
  });

  it('does not let a delayed save overwrite a newer reward state', async () => {
    const repo = new MemoryReferralRepository();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const original = repo.saveRewards.bind(repo);
    repo.saveRewards = async (rows: readonly RewardRow[]) => {
      calls += 1;
      if (calls === 1) await gate;
      return original(rows);
    };
    const live = serviceFor(repo);
    await repo.ensureCode(pid(1));
    for (let index = 2; index <= 4; index += 1) {
      await live.accept(pid(index), (await live.view(pid(1), 1)).code);
      await live.devAddTime('op', pid(index), 10_800);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBeGreaterThan(0);
    const current = await repo.rewards(pid(1));
    await repo.saveRewards(current.map((row) => ({ ...row, status: 'paused', revision: 50, expiresAt: null })));
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const saved = await repo.rewards(pid(1));
    expect(saved.every((row) => row.revision >= 50)).toBe(true);
    expect(saved.some((row) => row.revision < 50 && row.status === 'active')).toBe(false);
  });
});

describe('referral kit claims', () => {
  it('serializes concurrent claims and marks the kit only after a successful save', async () => {
    const repo = new MemoryReferralRepository();
    const live = serviceFor(repo);
    const code = (await live.view(pid(1), 1)).code!;
    await live.accept(pid(2), code);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delivers = 0;
    let saved = false;
    const delivery: ReferralKitDelivery = {
      hasReceipt: () => saved,
      deliver: async () => {
        delivers += 1;
        if (delivers === 1) await gate;
        saved = true;
        return 'delivered';
      },
    };
    const claiming = serviceFor(repo, { delivery });
    const both = Promise.all([claiming.claim(pid(2)), claiming.claim(pid(2))]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await repo.kitClaim(pid(2)))?.state).toBe('pending');
    expect(delivers).toBe(1);
    release();
    const messages = await both;
    expect(delivers).toBe(1);
    expect(messages.filter((line) => line === 'Стартовый набор получен.')).toHaveLength(1);
    expect(messages.filter((line) => line === 'Стартовый набор уже получен.')).toHaveLength(1);
    expect((await repo.kitClaim(pid(2)))?.state).toBe('claimed');
  });

  it('leaves the kit pending when the save fails and allows one later delivery', async () => {
    const repo = new MemoryReferralRepository();
    const live = serviceFor(repo);
    await live.accept(pid(2), (await live.view(pid(1), 1)).code);
    let fail = true;
    let delivers = 0;
    const delivery: ReferralKitDelivery = {
      hasReceipt: () => false,
      deliver: async () => {
        delivers += 1;
        if (fail) return 'failed';
        return 'delivered';
      },
    };
    const claiming = serviceFor(repo, { delivery, items: [{ itemId: 'stone', count: 1 }, { itemId: ItemId.IronIngot, count: 2 }] });
    expect(await claiming.claim(pid(2))).toContain('не засчитаны');
    expect((await repo.kitClaim(pid(2)))?.state).toBe('pending');
    fail = false;
    expect(await claiming.claim(pid(2))).toBe('Стартовый набор получен.');
    expect(delivers).toBe(2);
    expect((await repo.kitClaim(pid(2)))?.state).toBe('claimed');
  });
});

describe('referral activity recovery', () => {
  it('restores one tracker after the database returns and skips the outage gap', async () => {
    const repo = new MemoryReferralRepository();
    const setup = serviceFor(repo);
    await setup.accept(pid(2), (await setup.view(pid(1), 1)).code);
    let down = true;
    const originalInvitee = repo.invitee.bind(repo);
    const originalPage = repo.page.bind(repo);
    repo.invitee = async (id: string) => {
      if (down) throw new Error('database unavailable');
      return originalInvitee(id);
    };
    repo.page = async (id: string, limit: number, offset: number) => {
      if (down) throw new Error('database unavailable');
      return originalPage(id, limit, offset);
    };
    let now = 5_000;
    const live = serviceFor(repo, {
      now: () => now,
      connectionLive: () => 'socket-1',
    });
    await live.onJoin(pid(2), 'socket-1');
    expect(live.tracking()).toBe(false);
    now += 60_000;
    down = false;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(live.tracking()).toBe(true);
    live.noteAction(pid(2));
    now += 60_000;
    live.noteAction(pid(2));
    await live.flushNow(pid(2));
    const row = await originalInvitee(pid(2));
    expect(row?.activeSeconds).toBe(60);
    expect(row?.activeSeconds).toBeLessThan(120);
  });
});

describe('referral resource ledger', () => {
  it('counts a referral grant once when the same source is replayed', () => {
    const ledger = new ResourceLedger();
    ledger.noteGrant(ItemId.Diamond, 3, 'referral:abc');
    ledger.noteGrant(ItemId.Diamond, 3, 'referral:abc');
    ledger.noteGrant(ItemId.IronIngot, 2, 'referral:abc');
    const first = ledger.serialize();
    expect(first.minted[ItemId.Diamond]).toBe(3);
    expect(first.minted[ItemId.IronIngot]).toBe(2);
    const restored = new ResourceLedger();
    restored.load(first);
    restored.noteGrant(ItemId.Diamond, 3, 'referral:abc');
    expect(restored.serialize().minted[ItemId.Diamond]).toBe(3);
    restored.noteGrant(ItemId.Diamond, 1);
    expect(restored.serialize().minted[ItemId.Diamond]).toBe(4);
  });

  it('keeps referral grant keys after the ordinary 500-key window drops them', () => {
    const ledger = new ResourceLedger();
    const referralId = '11111111-1111-4111-8111-111111111111';
    ledger.noteGrant(ItemId.Diamond, 3, `referral:${referralId}`);
    ledger.noteGrant(ItemId.IronIngot, 2, `referral:${referralId}`);
    for (let index = 0; index < RESOURCE_SOURCE_KEY_LIMIT + 1; index += 1) {
      ledger.noteMine(ItemId.GoldIngot, 1, `vein-${index}`);
    }
    const saved = ledger.serialize();
    expect(saved.sourceKeys).toHaveLength(RESOURCE_SOURCE_KEY_LIMIT);
    expect(saved.sourceKeys.some((key) => key.startsWith('grant:referral:'))).toBe(false);
    expect(saved.durableKeys).toEqual([
      `grant:referral:${referralId}:${ItemId.Diamond}`,
      `grant:referral:${referralId}:${ItemId.IronIngot}`,
    ]);
    expect(saved.minted[ItemId.Diamond]).toBe(3);
    expect(saved.minted[ItemId.IronIngot]).toBe(2);
    expect(saved.minted[ItemId.GoldIngot]).toBe(RESOURCE_SOURCE_KEY_LIMIT + 1);

    const restarted = new ResourceLedger();
    restarted.load(saved);
    restarted.noteGrant(ItemId.Diamond, 3, `referral:${referralId}`);
    restarted.noteGrant(ItemId.IronIngot, 2, `referral:${referralId}`);
    const afterReplay = restarted.serialize();
    expect(afterReplay.minted[ItemId.Diamond]).toBe(3);
    expect(afterReplay.minted[ItemId.IronIngot]).toBe(2);

    const lost = new ResourceLedger();
    lost.noteGrant(ItemId.Diamond, 3, `referral:${referralId}`);
    lost.noteGrant(ItemId.IronIngot, 2, `referral:${referralId}`);
    const recovered = lost.serialize();
    const secondBoot = new ResourceLedger();
    secondBoot.load(recovered);
    secondBoot.noteGrant(ItemId.Diamond, 3, `referral:${referralId}`);
    secondBoot.noteGrant(ItemId.IronIngot, 2, `referral:${referralId}`);
    expect(secondBoot.serialize().minted[ItemId.Diamond]).toBe(recovered.minted[ItemId.Diamond]);
    expect(secondBoot.serialize().minted[ItemId.IronIngot]).toBe(recovered.minted[ItemId.IronIngot]);

    secondBoot.noteMine(ItemId.GoldIngot, 1, 'vein-0');
    expect(secondBoot.serialize().minted[ItemId.GoldIngot]).toBe(1);
    expect(secondBoot.serialize().sourceKeys?.length).toBeLessThanOrEqual(RESOURCE_SOURCE_KEY_LIMIT);
  });
});

describe('referral reward reads', () => {
  it('does not let a stale database read replace a newer paused VIP', async () => {
    const repo = new MemoryReferralRepository();
    const started = 1_700_000_000_000;
    let now = started;
    let paid: EffectiveRank = 'default';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const originalSave = repo.saveRewards.bind(repo);
    const originalRewards = repo.rewards.bind(repo);
    repo.saveRewards = async (rows: readonly RewardRow[]) => {
      calls += 1;
      if (calls === 1) await gate;
      return originalSave(rows);
    };
    await repo.ensureMilestones(pid(1), 3, started);
    const [created] = await originalRewards(pid(1));
    await originalSave([{
      ...created!,
      status: 'active',
      revision: 1,
      activatedAt: started,
      expiresAt: started + REFERRAL_REWARD_MS,
      remainingMs: REFERRAL_REWARD_MS,
    }]);
    const live = serviceFor(repo, { now: () => now, paidRank: () => paid });
    await live.view(pid(1), 1);
    paid = 'boss';
    await live.reconcilePaid(pid(1));
    expect(calls).toBe(1);
    now += 120_000;
    await live.view(pid(1), 1);
    await live.reconcilePaid(pid(1));
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const saved = await originalRewards(pid(1));
    const vip = saved.find((row) => row.milestone === '3_confirmed');
    expect(vip?.status).toBe('paused');
    expect(vip?.remainingMs).toBe(REFERRAL_REWARD_MS);
    expect(vip?.expiresAt).toBeNull();
    expect(vip?.revision).toBeGreaterThanOrEqual(2);

    const restarted = serviceFor(repo, { now: () => now, paidRank: () => paid });
    await restarted.onJoin(pid(1), 'later');
    const again = await originalRewards(pid(1));
    expect(again.filter((row) => row.milestone === '3_confirmed')).toHaveLength(1);
    expect(again[0]?.remainingMs).toBe(REFERRAL_REWARD_MS);
    expect(again[0]?.expiresAt).toBeNull();
    expect(again[0]?.rewardId).toBe(vip?.rewardId);
  });

  it('keeps the in-memory reward when PostgreSQL still has a lower revision', async () => {
    const repo = new MemoryReferralRepository();
    const started = 1_700_000_000_000;
    let now = started;
    let paid: EffectiveRank = 'default';
    const originalRewards = repo.rewards.bind(repo);
    await repo.ensureMilestones(pid(1), 3, started);
    const [created] = await originalRewards(pid(1));
    const active = {
      ...created!,
      status: 'active' as const,
      revision: 1,
      activatedAt: started,
      expiresAt: started + REFERRAL_REWARD_MS,
      remainingMs: REFERRAL_REWARD_MS,
    };
    await repo.saveRewards([active]);
    const live = serviceFor(repo, { now: () => now, paidRank: () => paid });
    await live.view(pid(1), 1);
    paid = 'boss';
    await live.reconcilePaid(pid(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    repo.rewards = async () => [active];
    now += 120_000;
    await live.view(pid(1), 1);
    await live.reconcilePaid(pid(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const saved = await originalRewards(pid(1));
    expect(saved[0]?.status).toBe('paused');
    expect(saved[0]?.remainingMs).toBe(REFERRAL_REWARD_MS);
    expect(saved[0]?.expiresAt).toBeNull();
    expect(saved[0]?.revision).toBeGreaterThan(active.revision);
  });
});

describe('referral shutdown', () => {
  it('saves the VIP created by the final activity flush', async () => {
    const repo = new MemoryReferralRepository();
    let now = 1_800_000_000_000;
    const live = serviceFor(repo, { now: () => now });
    const code = (await live.view(pid(1), 1)).code!;
    for (const friend of [2, 3]) {
      await live.accept(pid(friend), code);
      await live.devAddTime('op', pid(friend), REFERRAL_ACTIVE_SECONDS);
    }
    await live.accept(pid(4), code);
    await live.devAddTime('op', pid(4), REFERRAL_ACTIVE_SECONDS - 1);
    await live.onJoin(pid(4), 'socket');
    live.noteAction(pid(4));
    now += 1_000;
    live.noteAction(pid(4));
    await live.shutdown();
    const relation = await repo.invitee(pid(4));
    expect(relation?.status).toBe('qualified');
    expect(relation?.activeSeconds).toBe(REFERRAL_ACTIVE_SECONDS);
    expect((await repo.page(pid(1), 10, 0)).qualified).toBe(3);
    const vip = (await repo.rewards(pid(1))).find((row) => row.milestone === '3_confirmed');
    expect(vip?.status).toBe('active');
    expect(vip?.revision).toBeGreaterThan(0);
    expect(vip?.activatedAt).toBe(now);
    expect(vip?.expiresAt).toBe(now + REFERRAL_REWARD_MS);

    const restarted = serviceFor(repo, { now: () => now + 5_000 });
    await restarted.onJoin(pid(1), 'restart');
    const again = await repo.rewards(pid(1));
    expect(again.filter((row) => row.milestone === '3_confirmed')).toHaveLength(1);
    expect(again[0]?.rewardId).toBe(vip?.rewardId);
    expect(again[0]?.activatedAt).toBe(vip?.activatedAt);
    expect(again[0]?.expiresAt).toBe(vip?.expiresAt);
  });

  it('writes the reward created during shutdown after an older save finishes', async () => {
    const repo = new MemoryReferralRepository();
    let now = 1_800_000_000_000;
    let paid: EffectiveRank = 'default';
    const live = serviceFor(repo, { now: () => now, paidRank: () => paid });
    const code = (await live.view(pid(1), 1)).code!;
    for (const friend of [2, 3, 4, 5]) {
      await live.accept(pid(friend), code);
      await live.devAddTime('op', pid(friend), REFERRAL_ACTIVE_SECONDS);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = await repo.rewards(pid(1));
    expect(before.map((row) => row.milestone)).toEqual(['3_confirmed']);
    await live.accept(pid(6), code);
    await live.devAddTime('op', pid(6), REFERRAL_ACTIVE_SECONDS - 1);
    await live.onJoin(pid(6), 'socket');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const original = repo.saveRewards.bind(repo);
    repo.saveRewards = async (rows: readonly RewardRow[]) => {
      calls += 1;
      const call = calls;
      if (call === 1) await gate;
      return original(rows);
    };
    paid = 'boss';
    await live.reconcilePaid(pid(1));
    expect(calls).toBe(1);
    paid = 'default';
    live.noteAction(pid(6));
    now += 1_000;
    live.noteAction(pid(6));
    const stopping = live.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await stopping;
    const rows = await repo.rewards(pid(1));
    const vip = rows.find((row) => row.milestone === '3_confirmed');
    const premium = rows.find((row) => row.milestone === '5_confirmed');
    expect(premium?.status).toBe('active');
    expect(premium?.expiresAt).toBe(now + REFERRAL_REWARD_MS);
    expect(vip?.status).toBe('paused');
    expect(vip?.expiresAt).toBeNull();
    expect(vip?.remainingMs).toBe(REFERRAL_REWARD_MS);
    expect(premium?.revision).toBeGreaterThan(0);
    expect(vip?.revision).toBe(premium?.revision);
    expect((vip?.revision ?? 0) > (before[0]?.revision ?? 0)).toBe(true);
  });

  it('reports a failed final reward save instead of a clean shutdown', async () => {
    const repo = new MemoryReferralRepository();
    let now = 1_800_000_000_000;
    const live = serviceFor(repo, { now: () => now });
    const code = (await live.view(pid(1), 1)).code!;
    for (const friend of [2, 3]) {
      await live.accept(pid(friend), code);
      await live.devAddTime('op', pid(friend), REFERRAL_ACTIVE_SECONDS);
    }
    await live.accept(pid(4), code);
    await live.devAddTime('op', pid(4), REFERRAL_ACTIVE_SECONDS - 1);
    await live.onJoin(pid(4), 'socket');
    live.noteAction(pid(4));
    now += 1_000;
    live.noteAction(pid(4));
    repo.saveRewards = async () => {
      throw new Error('disk full');
    };
    await expect(live.shutdown()).rejects.toThrow(/referral reward shutdown save failed/);
  });
});
