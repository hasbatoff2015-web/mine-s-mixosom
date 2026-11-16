import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { REFERRAL_ACTIVE_SECONDS, REFERRAL_REWARD_MS } from '../../shared/referral';
import { permissionNodesForRank } from '../../shared/donationRanks';
import { loadServerConfig } from '../../server/config';
import { DonationRankService } from '../../server/services/donationRanks';
import { JsonFileStore } from '../../server/services/jsonStore';
import { PermissionService } from '../../server/services/permissions';
import { applyKit } from '../../server/referral/kitFit';
import { generateReferralCode } from '../../server/referral/codes';
import { MemoryReferralRepository } from '../../server/referral/memoryRepository';
import { ReferralService, type ReferralDeps, type ReferralKitDelivery } from '../../server/referral/service';
import type { KitStack } from '../../server/services/kit';
import type { EffectiveRank } from '../../shared/donationRanks';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function pid(n: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`;
}

function names(table: Record<string, string>) {
  return (id: string) => table[id] ?? id.slice(0, 8);
}

async function donation(): Promise<DonationRankService> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-ref-rank-'));
  dirs.push(dir);
  const service = new DonationRankService(new JsonFileStore(dir), (value) => value.trim().toLowerCase());
  service.load();
  return service;
}

function harness(options: {
  repo?: MemoryReferralRepository;
  ranks?: DonationRankService;
  devTools?: boolean;
  activityEnabled?: boolean;
  items?: readonly KitStack[] | null;
  delivery?: ReferralKitDelivery | null;
  names?: Record<string, string>;
  now?: () => number;
} = {}): { service: ReferralService; repo: MemoryReferralRepository; now: { value: number } } {
  const repo = options.repo ?? new MemoryReferralRepository();
  const clock = { value: 1_700_000_000_000 };
  const ranks = options.ranks;
  const deps: ReferralDeps = {
    repository: repo,
    activityEnabled: options.activityEnabled ?? true,
    devTools: options.devTools ?? true,
    publicGameUrl: 'https://yandex.ru/games/app/100',
    now: options.now ?? (() => clock.value),
    paidRank: (playerId, now) => ranks?.activeGrant(playerId, now)?.rank ?? 'default',
    paidRankUnreadable: () => ranks?.loadFailed() ?? false,
    displayName: names(options.names ?? {}),
    yandexLink: async () => 'guest',
    kitItems: () => options.items === undefined ? null : options.items,
    kitDelivery: () => options.delivery ?? null,
    notify: () => undefined,
    onBenefitsChanged: () => undefined,
  };
  const service = ReferralService.create(deps);
  if (ranks) ranks.setReferralRank((playerId, now) => service.rankView(playerId, now));
  return { service, repo, now: clock };
}

describe('referral codes and invitations', () => {
  it('keeps one code per player across requests and a new service', async () => {
    const repo = new MemoryReferralRepository();
    const first = harness({ repo, names: { [pid(1)]: 'Ada' } });
    const view = await first.service.view(pid(1), 1);
    expect(view.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    const again = await first.service.view(pid(1), 1);
    expect(again.code).toBe(view.code);
    const restarted = harness({ repo });
    const after = await restarted.service.view(pid(1), 1);
    expect(after.code).toBe(view.code);
    const other = await first.service.view(pid(2), 1);
    expect(other.code).not.toBe(view.code);
    expect(view.guestWarning).toContain('Яндекс ID');
    expect(view.link).toContain(`payload=ref_${view.code}`);
  });

  it('retries a colliding code and still returns the stored one', async () => {
    const issued = ['ABCDEFGH', 'ABCDEFGH', 'JKLMNPQR'];
    const repo = new MemoryReferralRepository(() => issued.shift() ?? generateReferralCode());
    const { service } = harness({ repo });
    const left = await service.view(pid(1), 1);
    const right = await service.view(pid(2), 1);
    expect(left.code).toBe('ABCDEFGH');
    expect(right.code).toBe('JKLMNPQR');
    expect(await service.view(pid(1), 1)).toMatchObject({ code: 'ABCDEFGH' });
  });

  it('accepts one referrer, rejects self, unknown, and a replacement', async () => {
    const { service } = harness({ names: { [pid(1)]: 'Ada', [pid(2)]: 'Misha', [pid(3)]: 'Alex' } });
    const ada = await service.view(pid(1), 1);
    const alex = await service.view(pid(3), 1);
    expect(await service.accept(pid(2), 'nope')).toBe('Реферальный код не найден.');
    expect(await service.accept(pid(1), ada.code)).toBe('Нельзя использовать собственный код.');
    expect(await service.accept(pid(2), ada.code!.toLowerCase())).toContain('Ada');
    expect(await service.accept(pid(2), ada.code)).toBe('Вы уже приняли приглашение.');
    expect(await service.accept(pid(2), alex.code)).toBe('Вы уже приняли приглашение.');
    const row = await service.view(pid(2), 1);
    expect(row.invitedBy).toBe('Ada');
  });

  it('does not let a nickname retarget the saved relation', async () => {
    const repo = new MemoryReferralRepository();
    const names = { [pid(1)]: 'Ada', [pid(2)]: 'Misha' };
    const { service } = harness({ repo, names });
    const ada = await service.view(pid(1), 1);
    expect(await service.accept(pid(2), ada.code)).toContain('принят');
    names[pid(1)] = 'SomeoneElse';
    const again = harness({ repo, names });
    const view = await again.service.view(pid(2), 1);
    expect(view.invitedBy).toBe('SomeoneElse');
    const relation = await repo.invitee(pid(2));
    expect(relation?.referrerId).toBe(pid(1));
    expect(relation?.activeSeconds).toBe(0);
  });

  it('lets only the first concurrent accept win', async () => {
    const repo = new MemoryReferralRepository();
    const { service } = harness({ repo });
    const ada = (await service.view(pid(1), 1)).code!;
    const alex = (await service.view(pid(3), 1)).code!;
    const [left, right] = await Promise.all([
      service.accept(pid(2), ada),
      service.accept(pid(2), alex),
    ]);
    const messages = [left, right].sort();
    expect(messages.some((line) => line.includes('принят'))).toBe(true);
    expect(messages.some((line) => line === 'Вы уже приняли приглашение.')).toBe(true);
    const relation = await repo.invitee(pid(2));
    expect(relation?.referrerId === pid(1) || relation?.referrerId === pid(3)).toBe(true);
    expect(await repo.page(relation!.referrerId, 10, 0)).toMatchObject({ total: 1 });
    const other = relation!.referrerId === pid(1) ? pid(3) : pid(1);
    expect((await repo.page(other, 10, 0)).total).toBe(0);
  });
});

describe('referral active time', () => {
  it('sums three hours across a restart and qualifies once', async () => {
    const repo = new MemoryReferralRepository();
    let now = 10_000;
    const first = harness({ repo, devTools: false, now: () => now });
    const code = (await first.service.view(pid(1), 1)).code!;
    expect(await first.service.accept(pid(2), code)).toContain('принят');
    first.service.bindConnection(pid(2), 'tab-a');
    const play = (service: ReferralService, seconds: number) => {
      for (let elapsed = 0; elapsed <= seconds; elapsed += 60) {
        now += 60_000;
        service.noteAction(pid(2));
      }
    };
    play(first.service, 30 * 60);
    await first.service.onQuit(pid(2), 'tab-a');
    expect((await repo.invitee(pid(2)))?.status).toBe('pending');
    expect((await repo.invitee(pid(2)))?.activeSeconds).toBe(30 * 60);

    const second = harness({ repo, devTools: false, now: () => now });
    await second.service.onJoin(pid(2), 'tab-b');
    play(second.service, 150 * 60);
    await second.service.flushNow(pid(2));
    const done = await repo.invitee(pid(2));
    expect(done?.status).toBe('qualified');
    expect(done?.activeSeconds).toBe(REFERRAL_ACTIVE_SECONDS);
    await second.service.flushNow(pid(2));
    expect((await repo.invitee(pid(2)))?.activeSeconds).toBe(REFERRAL_ACTIVE_SECONDS);
    expect((await repo.page(pid(1), 10, 0)).qualified).toBe(1);
  });

  it('ignores time before accept, a second connection, and client-sized jumps', async () => {
    const repo = new MemoryReferralRepository();
    let now = 1_000;
    const { service } = harness({ repo, now: () => now });
    service.noteAction(pid(2));
    now += 30 * 60_000;
    service.noteAction(pid(2));
    const code = (await service.view(pid(1), 1)).code!;
    await service.accept(pid(2), code);
    service.bindConnection(pid(2), 'live');
    now += 60_000;
    service.sample({
      playerId: pid(2),
      connectionId: 'stale',
      now,
      x: 5,
      y: 64,
      z: 0,
      onGround: true,
      steered: true,
      dead: false,
      connected: true,
      epoch: 1,
      miningProgress: 0,
    });
    await service.flushNow(pid(2));
    expect((await repo.invitee(pid(2)))?.activeSeconds).toBe(0);
    now += 2 * 60 * 60 * 1000;
    service.noteAction(pid(2));
    await service.flushNow(pid(2));
    expect((await repo.invitee(pid(2)))?.activeSeconds).toBeLessThanOrEqual(5 * 60);
  });

  it('drops an ambiguous flush instead of adding it twice', async () => {
    const repo = new MemoryReferralRepository();
    let failNext = false;
    const wrapped = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === 'flush') {
          return async (...args: Parameters<MemoryReferralRepository['flush']>) => {
            const result = await target.flush(...args);
            if (failNext) {
              failNext = false;
              throw new Error('statement timeout');
            }
            return result;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    let now = 5_000;
    const { service } = harness({ repo: wrapped as MemoryReferralRepository, now: () => now });
    await service.accept(pid(2), (await service.view(pid(1), 1)).code);
    const play = (seconds: number) => {
      for (let elapsed = 0; elapsed <= seconds; elapsed += 60) {
        now += 60_000;
        service.noteAction(pid(2));
      }
    };
    play(120);
    await service.flushNow(pid(2));
    const once = (await repo.invitee(pid(2)))?.activeSeconds ?? 0;
    expect(once).toBe(120);
    failNext = true;
    now += 60_000;
    service.noteAction(pid(2));
    await service.flushNow(pid(2));
    await service.flushNow(pid(2));
    const twice = (await repo.invitee(pid(2)))?.activeSeconds ?? 0;
    expect(twice).toBe(once + 60);
    now += 60_000;
    service.noteAction(pid(2));
    await service.flushNow(pid(2));
    expect((await repo.invitee(pid(2)))?.activeSeconds).toBe(twice + 60);
  });
});

describe('referral rewards and paid ranks', () => {
  async function qualify(service: ReferralService, referrer: string, invitee: string): Promise<void> {
    const code = (await service.view(referrer, 1)).code!;
    const accepted = await service.accept(invitee, code);
    expect(accepted.includes('принят') || accepted === 'Вы уже приняли приглашение.').toBe(true);
    const text = await service.devAddTime('op', invitee, REFERRAL_ACTIVE_SECONDS);
    expect(text).toContain('qualified');
  }

  it('grants VIP at three friends and PREMIUM at five, once each', async () => {
    const repo = new MemoryReferralRepository();
    const ranks = await donation();
    const { service } = harness({ repo, ranks, names: { [pid(1)]: 'Ada' } });
    for (let index = 2; index <= 3; index += 1) await qualify(service, pid(1), pid(index));
    expect((await repo.rewards(pid(1))).map((row) => row.milestone)).toEqual([]);
    await qualify(service, pid(1), pid(4));
    expect((await repo.rewards(pid(1))).map((row) => row.milestone)).toEqual(['3_confirmed']);
    await qualify(service, pid(1), pid(4));
    expect(await repo.rewards(pid(1))).toHaveLength(1);
    await qualify(service, pid(1), pid(5));
    expect((await repo.rewards(pid(1))).map((row) => row.milestone)).toEqual(['3_confirmed']);
    await qualify(service, pid(1), pid(6));
    const rewards = await repo.rewards(pid(1));
    expect(rewards.map((row) => row.milestone).sort()).toEqual(['3_confirmed', '5_confirmed']);
    const restarted = harness({ repo, ranks });
    await restarted.service.onJoin(pid(1), 'later');
    expect(await repo.rewards(pid(1))).toHaveLength(2);
    const at = restarted.now.value;
    expect(ranks.effectiveRank(pid(1), at)).toBe('premium');
    expect(ranks.permissionNodes(pid(1), at)).toEqual(permissionNodesForRank('premium'));
    expect(ranks.permissionNodes(pid(1), at)).not.toContain('server.admin');
    expect(ranks.limit(pid(1), 'homes', at)).toBe(5);
    expect(ranks.status(pid(1), { now: at }).rank).toBe('premium');
  });

  it('keeps a paid rank and banks the referral reward underneath it', async () => {
    const repo = new MemoryReferralRepository();
    const ranks = await donation();
    const now = 1_700_000_000_000;
    const titanEnd = now + 30 * 24 * 60 * 60 * 1000;
    expect(ranks.grant(pid(1), 'titan', { now, durationMs: titanEnd - now, source: 'shop' }).ok).toBe(true);
    const { service } = harness({ repo, ranks, now: () => now });
    for (let index = 2; index <= 4; index += 1) await qualify(service, pid(1), pid(index));
    expect(ranks.activeGrant(pid(1), now)?.rank).toBe('titan');
    expect(ranks.activeGrant(pid(1), now)?.expiresAt).toBe(titanEnd);
    expect(ranks.effectiveRank(pid(1), now)).toBe('titan');
    const vip = (await repo.rewards(pid(1))).find((row) => row.milestone === '3_confirmed');
    expect(vip?.status === 'pending' || vip?.status === 'paused').toBe(true);
    expect(vip?.remainingMs).toBe(REFERRAL_REWARD_MS);
    ranks.revoke(pid(1), { now: now + 10 * 24 * 60 * 60 * 1000, source: 'shop' });
    await service.reconcilePaid(pid(1));
    expect(ranks.effectiveRank(pid(1), now + 10 * 24 * 60 * 60 * 1000)).toBe('vip');
    expect(ranks.limit(pid(1), 'auction', now + 10 * 24 * 60 * 60 * 1000)).toBe(10);
  });

  it('lets referral PREMIUM sit above paid VIP and return to it', async () => {
    const repo = new MemoryReferralRepository();
    const ranks = await donation();
    const start = 1_700_000_000_000;
    const paidMs = 30 * 24 * 60 * 60 * 1000;
    expect(ranks.grant(pid(1), 'vip', { now: start, durationMs: paidMs, source: 'shop' }).ok).toBe(true);
    let now = start;
    const { service } = harness({ repo, ranks, now: () => now });
    for (let index = 2; index <= 6; index += 1) await qualify(service, pid(1), pid(index));
    expect(ranks.effectiveRank(pid(1), now)).toBe('premium');
    expect(ranks.activeGrant(pid(1), now)?.rank).toBe('vip');
    expect(ranks.activeGrant(pid(1), now)?.expiresAt).toBe(start + paidMs);
    const both = await repo.rewards(pid(1));
    expect(both).toHaveLength(2);
    now = start + 8 * 24 * 60 * 60 * 1000;
    await service.reconcilePaid(pid(1));
    expect(ranks.effectiveRank(pid(1), now)).toBe('vip');
    expect(ranks.permissionNodes(pid(1), now)).toEqual(permissionNodesForRank('vip'));
  });

  it('does not give referral hours or admin rights from the dev switch or an operator', async () => {
    const repo = new MemoryReferralRepository();
    const { service } = harness({ repo, devTools: false });
    const code = (await service.view(pid(1), 1)).code!;
    await service.accept(pid(2), code);
    expect(await service.devAddTime(pid(2), pid(2), REFERRAL_ACTIVE_SECONDS)).toBe('Команда выключена.');
    expect((await repo.invitee(pid(2)))?.activeSeconds).toBe(0);
    const ranks = await donation();
    const live = harness({ repo, ranks, devTools: true });
    const permissions = new PermissionService(new JsonFileStore(dirs[dirs.length - 1]!), [pid(9)]);
    permissions.load();
    permissions.setExtraNodes((key) => ranks.permissionNodes(key));
    await live.service.onJoin(pid(1), 'op-session');
    expect(permissions.has(pid(9), 'server.admin')).toBe(true);
    expect(permissions.has(pid(1), 'server.admin')).toBe(false);
  });
});

describe('referral starter kit', () => {
  it('stays pending until the kit exists, then gives it once', async () => {
    const repo = new MemoryReferralRepository();
    let items: readonly KitStack[] | null = null;
    let receipt = false;
    let full = false;
    const given: string[] = [];
    const delivery: ReferralKitDelivery = {
      hasReceipt: () => receipt,
      deliver: async (referralId, stacks) => {
        if (receipt) return 'already';
        if (full) return 'full';
        given.push(referralId, stacks.map((stack) => stack.itemId).join(','));
        receipt = true;
        return 'delivered';
      },
    };
    const { service } = harness({ repo, items: null, delivery });
    const code = (await service.view(pid(1), 1)).code!;
    await service.accept(pid(2), code);
    expect(await service.claim(pid(2))).toContain('не настроен');
    expect(given).toEqual([]);
    items = [];
    const empty = harness({ repo, items, delivery });
    expect(await empty.service.claim(pid(2))).toContain('не настроен');
    items = [{ itemId: 'stone', count: 3 }];
    full = true;
    const blocked = harness({ repo, items, delivery });
    expect(await blocked.service.claim(pid(2))).toContain('Освободите место');
    expect(receipt).toBe(false);
    full = false;
    const ready = harness({ repo, items, delivery });
    expect(await ready.service.claim(pid(2))).toBe('Стартовый набор получен.');
    expect(given).toHaveLength(2);
    receipt = true;
    expect(await ready.service.claim(pid(2))).toBe('Стартовый набор уже получен.');
    expect(given).toHaveLength(2);
  });

  it('does not mark a failed save as claimed and retries safely', async () => {
    const repo = new MemoryReferralRepository();
    let saved = false;
    const delivery: ReferralKitDelivery = {
      hasReceipt: () => saved,
      deliver: async () => 'failed',
    };
    const { service } = harness({
      repo,
      items: [{ itemId: 'stone', count: 1 }],
      delivery,
    });
    await service.accept(pid(2), (await service.view(pid(1), 1)).code);
    expect(await service.claim(pid(2))).toContain('не засчитаны');
    expect((await repo.kitClaim(pid(2)))?.state).toBe('pending');
    saved = true;
    const recovered: ReferralKitDelivery = {
      hasReceipt: () => true,
      deliver: async () => {
        throw new Error('must not give twice');
      },
    };
    const next = harness({ repo, items: [{ itemId: 'stone', count: 1 }], delivery: recovered });
    expect(await next.service.claim(pid(2))).toBe('Стартовый набор уже получен.');
    expect((await repo.kitClaim(pid(2)))?.state).toBe('claimed');
  });

  it('refuses a partial kit when the inventory cannot hold every stack', () => {
    const inventory = new Inventory();
    for (let slot = 0; slot < inventory.slots.length; slot += 1) {
      inventory.setSlot(slot, createItemStack('cobblestone', 64));
    }
    const before = inventory.serialize();
    expect(applyKit(inventory, [{ itemId: 'stone', count: 1 }])).toBe(false);
    expect(inventory.serialize()).toEqual(before);
  });
});

describe('referral config', () => {
  it('counts activity on Anarchy only unless the mode list says otherwise', () => {
    const anarchy = loadServerConfig({ FC_YANDEX_GAME_URL: 'https://yandex.ru/games/app/77?token=secret' });
    expect(anarchy.referralActivityEnabled).toBe(true);
    expect(anarchy.referralDevTools).toBe(false);
    expect(anarchy.referralPublicGameUrl).toBe('https://yandex.ru/games/app/77');
    const survival = loadServerConfig({ SERVER_MODE: 'survival' });
    expect(survival.referralActivityEnabled).toBe(false);
    expect(survival.referralPublicGameUrl).toBeNull();
    const opted = loadServerConfig({ SERVER_MODE: 'survival', FC_REFERRAL_ACTIVITY_MODES: 'survival' });
    expect(opted.referralActivityEnabled).toBe(true);
    expect(loadServerConfig({ FC_YANDEX_GAME_URL: 'http://localhost/games/app/1' }).referralPublicGameUrl).toBeNull();
    void (null as EffectiveRank | null);
  });
});
