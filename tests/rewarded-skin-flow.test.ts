import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import {
  REWARDED_SKIN_AVAILABILITY,
  STAGE1_MONETIZATION,
  commitSelectedSkinAppearance,
  resolveSkinActionState,
} from '../src/player/appearance/skinActionState';
import { evaluateServerSkinEquip } from '../src/player/appearance/skinEntitlementPolicy';
import {
  COMMON_SKIN_IDS,
  EPIC_SKIN_IDS,
  LEGENDARY_SKIN_IDS,
  RARE_SKIN_IDS,
} from '../src/player/appearance/skinStoreCatalog';
import {
  REWARDED_FINISH_TIMEOUT_MS,
  REWARDED_OPEN_TIMEOUT_MS,
  REWARDED_REQUEST_TIMEOUT_MS,
  RewardedSkinFlow,
  type RewardedFlowClock,
  type RewardedVideoCallbacks,
  type RewardedVideoPort,
} from '../src/player/appearance/rewardedSkinFlow';
import {
  SkinRewardController,
  appearanceForRewardedGrant,
  commitRewardedSkinSwitch,
} from '../src/player/appearance/skinRewardController';

const COMMON_ID = COMMON_SKIN_IDS[1];
const OTHER_COMMON_ID = COMMON_SKIN_IDS[2];
const RARE_ID = RARE_SKIN_IDS[0];
const EPIC_ID = EPIC_SKIN_IDS[0];
const LEGENDARY_ID = LEGENDARY_SKIN_IDS[0];

class ManualAds implements RewardedVideoPort {
  available = true;
  readonly calls: RewardedVideoCallbacks[] = [];
  throwOnShow = false;

  showRewardedVideo(callbacks: RewardedVideoCallbacks): void {
    this.calls.push(callbacks);
    if (this.throwOnShow) throw new Error('sdk failed');
  }
}

class FakeClock implements RewardedFlowClock {
  private now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  set(fn: () => void, ms: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }

  clear(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    this.now += ms;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.now)
      .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
    for (const [id, timer] of due) {
      if (!this.timers.has(id)) continue;
      this.timers.delete(id);
      timer.fn();
    }
  }

  get pending(): number {
    return this.timers.size;
  }
}

function flowWith(ads = new ManualAds(), clock = new FakeClock()): { ads: ManualAds; clock: FakeClock; flow: RewardedSkinFlow } {
  let seq = 0;
  const flow = new RewardedSkinFlow(ads, {
    clock,
    createRequestId: () => {
      seq += 1;
      return `reward-${seq}`;
    },
  });
  return { ads, clock, flow };
}

describe('rewarded skin flow', () => {
  it('does not grant a skin when the SDK is missing', () => {
    const ads = new ManualAds();
    ads.available = false;
    const { flow } = flowWith(ads);
    expect(flow.start(COMMON_ID)).toEqual({ ok: false, reason: 'unavailable' });
    expect(ads.calls).toHaveLength(0);
    expect(flow.consume()).toBeUndefined();
    expect(appearanceForRewardedGrant(undefined, DEFAULT_PLAYER_APPEARANCE.layers)).toBeUndefined();
  });

  it('keeps the ordinary confirm path from equipping a rewarded skin', () => {
    const selected = createPlayerAppearance({ skinId: COMMON_ID });
    expect(commitSelectedSkinAppearance(selected, 'frontier_explorer', undefined, REWARDED_SKIN_AVAILABILITY)).toBeUndefined();
    const ready = resolveSkinActionState({
      selectedSkinId: COMMON_ID,
      equippedSkinId: 'frontier_explorer',
      monetizationAvailability: REWARDED_SKIN_AVAILABILITY,
      advertisementReady: true,
    });
    expect(ready.kind).toBe('request_rewarded_ad');
    expect(ready.label).toBe('Смотреть рекламу');
    expect(ready.buttonEnabled).toBe(true);
    expect(ready.advertisementReady).toBe(true);
    expect(ready.rewardEarned).toBe(false);
    expect(ready.appearanceCommitAllowed).toBe(false);
    const offline = resolveSkinActionState({
      selectedSkinId: COMMON_ID,
      equippedSkinId: 'frontier_explorer',
      monetizationAvailability: REWARDED_SKIN_AVAILABILITY,
      advertisementReady: false,
    });
    expect(offline.buttonEnabled).toBe(false);
    expect(offline.detail).toContain('Реклама сейчас недоступна');
    expect(resolveSkinActionState({
      selectedSkinId: COMMON_ID,
      equippedSkinId: 'frontier_explorer',
      monetizationAvailability: STAGE1_MONETIZATION,
      advertisementReady: true,
    }).kind).toBe('rewarded_unavailable');
  });

  it('does not change appearance on open, and grants once after reward and close', () => {
    const { ads, flow } = flowWith();
    const started = flow.start(COMMON_ID);
    expect(started.ok).toBe(true);
    ads.calls[0]?.onOpen?.();
    expect(flow.inspect().phase).toBe('ad_open');
    expect(flow.consume()).toBeUndefined();
    ads.calls[0]?.onRewarded?.();
    expect(flow.inspect().phase).toBe('reward_received');
    expect(flow.consume()).toBeUndefined();
    ads.calls[0]?.onClose?.(true);
    const grant = flow.consume();
    expect(grant).toEqual({ requestId: 'reward-1', skinId: COMMON_ID });
    expect(flow.consume()).toBeUndefined();
    expect(appearanceForRewardedGrant(grant, DEFAULT_PLAYER_APPEARANCE.layers)?.skinId).toBe(COMMON_ID);
  });

  it('treats close without a reward as cancel, including when the ad was shown', () => {
    const { ads, flow } = flowWith();
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onClose?.(true);
    expect(flow.inspect().phase).toBe('cancelled');
    expect(flow.consume()).toBeUndefined();
  });

  it('grants nothing on error, including an error before open', () => {
    const { ads, flow } = flowWith();
    flow.start(COMMON_ID);
    ads.calls[0]?.onError?.(new Error('no fill'));
    expect(flow.inspect().phase).toBe('error');
    expect(flow.consume()).toBeUndefined();
    ads.calls[0]?.onRewarded?.();
    ads.calls[0]?.onClose?.(false);
    expect(flow.consume()).toBeUndefined();
  });

  it('applies one switch for reward plus close and ignores a second reward callback', () => {
    const { ads, flow } = flowWith();
    const settlements: string[] = [];
    flow.onSettled = (event) => settlements.push(event.outcome);
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onRewarded?.();
    ads.calls[0]?.onRewarded?.();
    ads.calls[0]?.onClose?.(true);
    ads.calls[0]?.onClose?.(true);
    ads.calls[0]?.onError?.(new Error('late'));
    expect(settlements).toEqual(['success']);
    expect(flow.consume()?.skinId).toBe(COMMON_ID);
    expect(flow.consume()).toBeUndefined();
    expect(flow.inspect().phase).toBe('idle');
  });

  it('starts only one video when the player clicks again', () => {
    const { ads, flow } = flowWith();
    expect(flow.start(COMMON_ID).ok).toBe(true);
    for (let time = 0; time < 9; time += 1) {
      expect(flow.start(OTHER_COMMON_ID)).toEqual({ ok: false, reason: 'busy' });
    }
    expect(ads.calls).toHaveLength(1);
    ads.calls[0]?.onRewarded?.();
    ads.calls[0]?.onClose?.(true);
    expect(flow.consume()?.skinId).toBe(COMMON_ID);
  });

  it('keeps a reward bound to the skin captured at the start', () => {
    const { ads, flow } = flowWith();
    flow.start(COMMON_ID);
    ads.calls[0]?.onRewarded?.();
    ads.calls[0]?.onClose?.(true);
    const grant = flow.consume();
    const switched = createPlayerAppearance({ skinId: OTHER_COMMON_ID });
    expect(commitRewardedSkinSwitch(switched, grant)).toBeUndefined();
    expect(appearanceForRewardedGrant(grant, DEFAULT_PLAYER_APPEARANCE.layers)?.skinId).toBe(COMMON_ID);
  });

  it('recovers when the SDK throws or never calls back', () => {
    const throwing = new ManualAds();
    throwing.throwOnShow = true;
    const crashed = flowWith(throwing);
    expect(crashed.flow.start(COMMON_ID).ok).toBe(true);
    expect(crashed.flow.inspect().phase).toBe('error');
    expect(crashed.flow.consume()).toBeUndefined();
    expect(crashed.clock.pending).toBe(0);

    const { ads, clock, flow } = flowWith();
    flow.start(COMMON_ID);
    clock.advance(REWARDED_REQUEST_TIMEOUT_MS);
    expect(flow.inspect().phase).toBe('error');
    expect(flow.consume()).toBeUndefined();
    expect(clock.pending).toBe(0);
    expect(flow.start(COMMON_ID).ok).toBe(true);
    expect(ads.calls).toHaveLength(2);
  });

  it('remembers a reward when close does not arrive and does not grant it yet', () => {
    const { ads, clock, flow } = flowWith();
    const settlements: string[] = [];
    flow.onSettled = (event) => settlements.push(event.outcome);
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onRewarded?.();
    clock.advance(REWARDED_FINISH_TIMEOUT_MS);
    expect(settlements).toEqual([]);
    expect(flow.inspect().phase).toBe('awaiting_close_recovery');
    expect(flow.consume()).toBeUndefined();
    expect(flow.isOperationActive).toBe(true);
    expect(flow.start(OTHER_COMMON_ID)).toEqual({ ok: false, reason: 'busy' });
    expect(ads.calls).toHaveLength(1);
    expect(clock.pending).toBe(0);
  });

  it('ignores a late reward after close and a callback after dispose', () => {
    const { ads, flow } = flowWith();
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onClose?.(false);
    ads.calls[0]?.onRewarded?.();
    expect(flow.consume()).toBeUndefined();

    const second = flowWith();
    second.flow.start(COMMON_ID);
    const stale = second.ads.calls[0];
    second.flow.dispose();
    stale?.onOpen?.();
    stale?.onRewarded?.();
    stale?.onClose?.(true);
    expect(second.flow.consume()).toBeUndefined();
    expect(second.flow.inspect().phase).toBe('idle');
    expect(second.clock.pending).toBe(0);
  });

  it('does not let an old callback grant the next request', () => {
    const { ads, flow } = flowWith();
    flow.start(COMMON_ID);
    const first = ads.calls[0];
    first?.onClose?.(false);
    flow.start(OTHER_COMMON_ID);
    first?.onRewarded?.();
    first?.onClose?.(true);
    expect(flow.consume()).toBeUndefined();
    ads.calls[1]?.onRewarded?.();
    ads.calls[1]?.onClose?.(true);
    expect(flow.consume()?.skinId).toBe(OTHER_COMMON_ID);
  });

  it('rejects rare, epic, legendary, and the free starter', () => {
    const { ads, flow } = flowWith();
    for (const skinId of ['frontier_explorer', RARE_ID, EPIC_ID, LEGENDARY_ID]) {
      expect(flow.start(skinId)).toEqual({ ok: false, reason: 'not_rewarded' });
    }
    expect(ads.calls).toHaveLength(0);
    for (const skinId of [RARE_ID, EPIC_ID, LEGENDARY_ID, 'frontier_explorer']) {
      expect(commitRewardedSkinSwitch(createPlayerAppearance({ skinId }), { skinId })).toBeUndefined();
      expect(resolveSkinActionState({
        selectedSkinId: skinId,
        equippedSkinId: 'frontier_explorer',
        monetizationAvailability: REWARDED_SKIN_AVAILABILITY,
        advertisementReady: true,
      }).kind).not.toBe('request_rewarded_ad');
    }
  });

  it('does not ask for another video when the common skin is already worn', () => {
    const worn = resolveSkinActionState({
      selectedSkinId: COMMON_ID,
      equippedSkinId: COMMON_ID,
      monetizationAvailability: REWARDED_SKIN_AVAILABILITY,
      advertisementReady: true,
    });
    expect(worn.kind).toBe('already_equipped');
    expect(worn.rewardEarned).toBe(false);
    expect(commitSelectedSkinAppearance(
      createPlayerAppearance({ skinId: COMMON_ID }),
      COMMON_ID,
      undefined,
      REWARDED_SKIN_AVAILABILITY,
    )).toBeUndefined();
  });

  it('asks for a new video when returning to a common skin that is no longer worn', () => {
    const again = resolveSkinActionState({
      selectedSkinId: COMMON_ID,
      equippedSkinId: 'frontier_explorer',
      monetizationAvailability: REWARDED_SKIN_AVAILABILITY,
      advertisementReady: true,
      accessSnapshot: { ownedSkinIds: [COMMON_ID] },
    });
    expect(again.kind).toBe('request_rewarded_ad');
    expect(again.appearanceCommitAllowed).toBe(false);
    expect(commitSelectedSkinAppearance(
      createPlayerAppearance({ skinId: COMMON_ID }),
      'frontier_explorer',
      { ownedSkinIds: [COMMON_ID] },
      REWARDED_SKIN_AVAILABILITY,
    )).toBeUndefined();
  });

  it('does not keep request ids after the grant is consumed', () => {
    const { ads, clock, flow } = flowWith();
    for (let time = 0; time < 20; time += 1) {
      flow.start(COMMON_ID);
      ads.calls.at(-1)?.onRewarded?.();
      ads.calls.at(-1)?.onClose?.(true);
      expect(flow.consume()?.requestId).toBe(`reward-${time + 1}`);
    }
    expect(flow.inspect()).toEqual({ phase: 'idle' });
    expect(clock.pending).toBe(0);
    expect(ads.calls).toHaveLength(20);
  });

  it('leaves server equip enforcement for a later stage', () => {
    const world = readFileSync('server/WorldInstance.ts', 'utf8');
    const server = readFileSync('server/AnarchyServer.ts', 'utf8');
    const join = world.slice(world.indexOf('join(options:'), world.indexOf('private notifyFriendsOfPresence'));
    expect(join).toContain('sanitizeRegisteredAppearance(options.appearance)');
    expect(join).not.toContain('rewardedSkinId');
    expect(join).not.toContain('evaluateServerSkinEquip');
    const appearance = world.slice(world.indexOf('setAppearance('), world.indexOf('private broadcastChat'));
    expect(appearance).toContain('sanitizeRegisteredAppearance');
    expect(appearance).not.toContain('evaluateServerSkinEquip');
    expect(server).toContain("case 'appearance'");
    expect(server).toContain('this.world.setAppearance(player, message)');
    expect(world).not.toContain('rewardedSkinId');
    expect(evaluateServerSkinEquip(COMMON_ID, {
      enforcement: 'on',
      equippedSkinId: 'frontier_explorer',
      ownedSkinIds: [COMMON_ID],
      ownedPackIds: [],
      adminLegendarySkinIds: [],
      rewardedSkinId: COMMON_ID,
    })).toMatchObject({ allowed: true, reason: 'rewarded_switch', consumeReward: true });
    expect(evaluateServerSkinEquip(COMMON_ID, {
      enforcement: 'on',
      equippedSkinId: COMMON_ID,
      ownedSkinIds: [],
      ownedPackIds: [],
      adminLegendarySkinIds: [],
    }).reason).toBe('reward_required');
  });
});

describe('rewarded close recovery', () => {
  function watch(flow: RewardedSkinFlow): string[] {
    const settlements: string[] = [];
    flow.onSettled = (event) => settlements.push(event.outcome);
    return settlements;
  }

  it('grants once for open, reward, and close', () => {
    const { ads, flow } = flowWith();
    const settlements = watch(flow);
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onRewarded?.();
    ads.calls[0]?.onClose?.(true);
    expect(settlements).toEqual(['success']);
    expect(flow.consume()?.skinId).toBe(COMMON_ID);
    expect(flow.consume()).toBeUndefined();
  });

  it('grants once when close arrives after the recovery wait', () => {
    const { ads, clock, flow } = flowWith();
    const settlements = watch(flow);
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onRewarded?.();
    clock.advance(REWARDED_FINISH_TIMEOUT_MS);
    ads.calls[0]?.onClose?.(true);
    ads.calls[0]?.onClose?.(true);
    expect(settlements).toEqual(['success']);
    expect(flow.consume()?.skinId).toBe(COMMON_ID);
    expect(flow.continueManually()).toEqual({ ok: false, reason: 'not_recovery' });
  });

  it('grants once when the player continues a counted recovery', () => {
    const { ads, clock, flow } = flowWith();
    const settlements = watch(flow);
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onRewarded?.();
    clock.advance(REWARDED_FINISH_TIMEOUT_MS);
    expect(flow.continueManually()).toEqual({ ok: true, outcome: 'success' });
    expect(settlements).toEqual(['success']);
    const grant = flow.consume();
    expect(grant?.skinId).toBe(COMMON_ID);
    ads.calls[0]?.onClose?.(true);
    ads.calls[0]?.onRewarded?.();
    expect(flow.consume()).toBeUndefined();
    expect(settlements).toEqual(['success']);
  });

  it('grants nothing when recovery is continued without a counted view', () => {
    const { ads, clock, flow } = flowWith();
    const settlements = watch(flow);
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    clock.advance(REWARDED_OPEN_TIMEOUT_MS);
    expect(flow.inspect().phase).toBe('awaiting_close_recovery');
    expect(flow.continueManually()).toEqual({ ok: true, outcome: 'error' });
    expect(settlements).toEqual(['error']);
    expect(flow.consume()).toBeUndefined();
    expect(flow.isOperationActive).toBe(false);
    expect(clock.pending).toBe(0);
  });

  it('does not grant when an open ad reports an error before a counted view', () => {
    const { ads, flow } = flowWith();
    const settlements = watch(flow);
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onError?.(new Error('playback'));
    expect(settlements).toEqual([]);
    expect(flow.inspect().phase).toBe('awaiting_close_recovery');
    expect(flow.continueManually()).toEqual({ ok: true, outcome: 'error' });
    expect(flow.consume()).toBeUndefined();
  });

  it('keeps a counted view when an error arrives before close', () => {
    const { ads, flow } = flowWith();
    const settlements = watch(flow);
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onRewarded?.();
    ads.calls[0]?.onError?.(new Error('late'));
    expect(settlements).toEqual([]);
    expect(flow.inspect().phase).toBe('reward_received');
    ads.calls[0]?.onClose?.(true);
    expect(settlements).toEqual(['success']);
    expect(flow.consume()?.skinId).toBe(COMMON_ID);
  });

  it('does not let an old generation finish the next request', () => {
    const { ads, clock, flow } = flowWith();
    const settlements = watch(flow);
    flow.start(COMMON_ID);
    const first = ads.calls[0];
    first?.onOpen?.();
    first?.onRewarded?.();
    clock.advance(REWARDED_FINISH_TIMEOUT_MS);
    first?.onClose?.(false);
    expect(flow.consume()?.skinId).toBe(COMMON_ID);
    flow.start(OTHER_COMMON_ID);
    first?.onRewarded?.();
    first?.onClose?.(true);
    expect(settlements).toEqual(['success']);
    expect(flow.consume()).toBeUndefined();
    expect(flow.inspect().skinId).toBe(OTHER_COMMON_ID);
  });

  it('drops timers and late grants on dispose', () => {
    const { ads, clock, flow } = flowWith();
    flow.start(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onRewarded?.();
    const callbacks = ads.calls[0];
    flow.dispose();
    clock.advance(REWARDED_FINISH_TIMEOUT_MS + REWARDED_OPEN_TIMEOUT_MS);
    callbacks?.onClose?.(true);
    expect(flow.consume()).toBeUndefined();
    expect(flow.inspect()).toEqual({ phase: 'idle' });
    expect(clock.pending).toBe(0);
    expect(flow.continueManually()).toEqual({ ok: false, reason: 'not_recovery' });
  });
});

describe('rewarded hold around recovery', () => {
  it('keeps the presentation hold until close or an explicit continue', () => {
    const { ads, clock, flow } = flowWith();
    const holds: string[] = [];
    const applied: string[] = [];
    let allow = true;
    const controller = new SkinRewardController(ads, {
      present: () => undefined,
      acceptEquipped: () => undefined,
    }, {
      beginPresentation: () => holds.push('begin'),
      endPresentation: () => holds.push('end'),
      apply: (appearance) => applied.push(appearance.skinId),
      currentAppearance: () => createPlayerAppearance({ skinId: 'frontier_explorer' }),
      stillOpen: () => true,
      canRecoverManually: () => allow,
    }, flow);
    controller.request(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    ads.calls[0]?.onRewarded?.();
    clock.advance(REWARDED_FINISH_TIMEOUT_MS);
    expect(applied).toEqual([]);
    expect(holds).toEqual(['begin']);
    expect(controller.isOperationActive()).toBe(true);
    allow = false;
    controller.continueFromRecovery();
    expect(applied).toEqual([]);
    expect(holds).toEqual(['begin']);
    allow = true;
    controller.continueFromRecovery();
    expect(applied).toEqual([COMMON_ID]);
    expect(holds).toEqual(['begin', 'end']);
    ads.calls[0]?.onClose?.(true);
    ads.calls[0]?.onRewarded?.();
    expect(applied).toEqual([COMMON_ID]);
    expect(holds).toEqual(['begin', 'end']);
  });

  it('does not apply a skin when recovery ends without a counted view', () => {
    const { ads, clock, flow } = flowWith();
    const applied: string[] = [];
    const controller = new SkinRewardController(ads, {
      present: () => undefined,
      acceptEquipped: () => undefined,
    }, {
      beginPresentation: () => undefined,
      endPresentation: () => undefined,
      apply: (appearance) => applied.push(appearance.skinId),
      currentAppearance: () => createPlayerAppearance({ skinId: 'frontier_explorer' }),
      stillOpen: () => true,
      canRecoverManually: () => true,
    }, flow);
    controller.request(COMMON_ID);
    ads.calls[0]?.onOpen?.();
    clock.advance(REWARDED_OPEN_TIMEOUT_MS);
    controller.continueFromRecovery();
    expect(applied).toEqual([]);
    expect(controller.isOperationActive()).toBe(false);
  });
});
