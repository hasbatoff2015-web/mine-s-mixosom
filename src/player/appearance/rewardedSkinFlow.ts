import { skinStoreEntry } from './skinStoreCatalog';

/**
 * One rewarded-video request for one common skin.
 *
 * `requestId` only ties callbacks to this attempt. It is not a signed
 * receipt and does not prove that Yandex showed an ad.
 */

export const REWARDED_REQUEST_TIMEOUT_MS = 15_000;
export const REWARDED_OPEN_TIMEOUT_MS = 120_000;
export const REWARDED_FINISH_TIMEOUT_MS = 8_000;

export const REWARDED_SKIN_COPY = {
  watch: 'Смотреть рекламу',
  loading: 'Загрузка рекламы...',
  opened: 'Реклама открыта',
  closing: 'Завершение рекламы...',
  rewardWaiting: 'Просмотр засчитан. Ожидаем закрытия рекламы.',
  continue: 'Продолжить',
  continueHint: 'Если реклама уже закрылась, нажмите «Продолжить».',
  unavailable: 'Реклама сейчас недоступна. Попробуйте позже.',
  offer: 'Одна реклама — одна смена скина. Постоянной разблокировки нет.',
  closed: 'Реклама закрыта. Скин не изменён.',
  applied: 'Скин применён. Следующая смена снова потребует рекламу.',
  soon: 'Реклама скоро',
  soonDetail: 'Каждая новая смена потребует рекламу. Реклама ещё не подключена.',
} as const;

export interface RewardedVideoCallbacks {
  onOpen?: () => void;
  onRewarded?: () => void;
  onClose?: (wasShown: boolean) => void;
  onError?: (error: unknown) => void;
}

export interface RewardedVideoPort {
  readonly available: boolean;
  showRewardedVideo(callbacks: RewardedVideoCallbacks): void;
}

export interface RewardedFlowClock {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export type RewardedFlowPhase =
  | 'idle'
  | 'requesting'
  | 'ad_open'
  | 'reward_received'
  | 'awaiting_close_recovery'
  | 'finishing'
  | 'success'
  | 'cancelled'
  | 'error';

export interface RewardedSkinGrant {
  readonly requestId: string;
  readonly skinId: string;
}

export type RewardedFlowSettlement = {
  readonly requestId: string;
  readonly skinId: string;
  readonly outcome: 'success' | 'cancelled' | 'error';
};

export type RewardedStartResult =
  | { readonly ok: true; readonly requestId: string; readonly phase: RewardedFlowPhase }
  | { readonly ok: false; readonly reason: 'busy' | 'disposed' | 'not_rewarded' | 'unavailable' };

const ACTIVE: ReadonlySet<RewardedFlowPhase> = new Set([
  'requesting',
  'ad_open',
  'reward_received',
  'awaiting_close_recovery',
  'finishing',
]);

const defaultClock: RewardedFlowClock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class RewardedSkinFlow {
  private phase: RewardedFlowPhase = 'idle';
  private generation = 0;
  private disposed = false;
  private requestId = '';
  private skinId = '';
  private rewarded = false;
  private grant?: RewardedSkinGrant;
  private timer?: unknown;
  private readonly clock: RewardedFlowClock;
  private readonly createRequestId: () => string;

  onOpened?: (event: { readonly requestId: string; readonly skinId: string }) => void;
  onRewardRecorded?: (event: { readonly requestId: string; readonly skinId: string }) => void;
  onRecovery?: (event: { readonly requestId: string; readonly skinId: string; readonly rewarded: boolean }) => void;
  onSettled?: (event: RewardedFlowSettlement) => void;

  constructor(
    private readonly port: RewardedVideoPort,
    options: {
      readonly clock?: RewardedFlowClock;
      readonly createRequestId?: () => string;
    } = {},
  ) {
    this.clock = options.clock ?? defaultClock;
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  }

  /** True while this request can still grant or must keep the ad hold. */
  get isOperationActive(): boolean {
    return ACTIVE.has(this.phase);
  }

  get isBusy(): boolean {
    return this.isOperationActive;
  }

  inspect(): {
    readonly phase: RewardedFlowPhase;
    readonly requestId?: string;
    readonly skinId?: string;
    readonly grant?: RewardedSkinGrant;
  } {
    return {
      phase: this.phase,
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(this.skinId ? { skinId: this.skinId } : {}),
      ...(this.grant ? { grant: this.grant } : {}),
    };
  }

  start(skinId: string): RewardedStartResult {
    if (this.disposed) return { ok: false, reason: 'disposed' };
    if (this.isBusy) return { ok: false, reason: 'busy' };
    if (skinStoreEntry(skinId)?.acquisition !== 'rewarded_ad') return { ok: false, reason: 'not_rewarded' };
    if (!this.port.available) return { ok: false, reason: 'unavailable' };

    this.generation += 1;
    const generation = this.generation;
    this.clearTimer();
    this.grant = undefined;
    this.rewarded = false;
    this.requestId = this.createRequestId();
    this.skinId = skinId;
    this.phase = 'requesting';
    this.arm(generation, REWARDED_REQUEST_TIMEOUT_MS);

    try {
      this.port.showRewardedVideo({
        onOpen: () => this.handleOpen(generation),
        onRewarded: () => this.handleRewarded(generation),
        onClose: () => this.handleClose(generation),
        onError: () => this.handleError(generation),
      });
    } catch {
      this.fail(generation);
    }

    return {
      ok: true,
      requestId: this.requestId,
      phase: this.phase,
    };
  }

  /**
   * Player says the ad overlay is already gone.
   * This does not start another video. Without `onRewarded` it grants nothing.
   */
  continueManually(): { readonly ok: true; readonly outcome: 'success' | 'error' } | { readonly ok: false; readonly reason: 'not_recovery' } {
    if (this.disposed || this.phase !== 'awaiting_close_recovery') return { ok: false, reason: 'not_recovery' };
    if (this.rewarded) {
      this.succeed(this.generation);
      return { ok: true, outcome: 'success' };
    }
    this.settle(this.generation, 'error');
    return { ok: true, outcome: 'error' };
  }

  /** One successful grant. A second call, or a grant for another attempt, returns nothing. */
  consume(): RewardedSkinGrant | undefined {
    const grant = this.grant;
    if (!grant) return undefined;
    this.grant = undefined;
    this.rewarded = false;
    this.requestId = '';
    this.skinId = '';
    this.phase = 'idle';
    return grant;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.clearTimer();
    this.grant = undefined;
    this.rewarded = false;
    this.requestId = '';
    this.skinId = '';
    this.phase = 'idle';
    this.onOpened = undefined;
    this.onRewardRecorded = undefined;
    this.onRecovery = undefined;
    this.onSettled = undefined;
  }

  private handleOpen(generation: number): void {
    if (!this.live(generation) || this.phase !== 'requesting') return;
    this.phase = 'ad_open';
    this.arm(generation, REWARDED_OPEN_TIMEOUT_MS);
    this.onOpened?.({ requestId: this.requestId, skinId: this.skinId });
  }

  private handleRewarded(generation: number): void {
    if (!this.live(generation) || this.rewarded) return;
    if (this.phase !== 'requesting' && this.phase !== 'ad_open' && this.phase !== 'awaiting_close_recovery') return;
    this.rewarded = true;
    const requestId = this.requestId;
    const skinId = this.skinId;
    if (this.phase === 'awaiting_close_recovery') {
      this.onRewardRecorded?.({ requestId, skinId });
      this.onRecovery?.({ requestId, skinId, rewarded: true });
      return;
    }
    this.phase = 'reward_received';
    this.arm(generation, REWARDED_FINISH_TIMEOUT_MS);
    this.onRewardRecorded?.({ requestId, skinId });
  }

  private handleClose(generation: number): void {
    if (!this.live(generation)) return;
    if (this.phase === 'idle' || this.phase === 'success' || this.phase === 'cancelled' || this.phase === 'error' || this.phase === 'finishing') return;
    if (this.rewarded) {
      this.succeed(generation);
      return;
    }
    if (this.phase === 'requesting' || this.phase === 'ad_open' || this.phase === 'awaiting_close_recovery') {
      this.settle(generation, 'cancelled');
    }
  }

  private handleError(generation: number): void {
    if (!this.live(generation)) return;
    if (this.rewarded) return;
    if (this.phase === 'requesting') {
      this.fail(generation);
      return;
    }
    if (this.phase === 'ad_open') this.enterRecovery(generation);
  }

  private succeed(generation: number): void {
    if (!this.live(generation) || this.grant) return;
    this.clearTimer();
    this.phase = 'finishing';
    this.grant = { requestId: this.requestId, skinId: this.skinId };
    this.phase = 'success';
    const event: RewardedFlowSettlement = {
      requestId: this.requestId,
      skinId: this.skinId,
      outcome: 'success',
    };
    this.onSettled?.(event);
  }

  private fail(generation: number): void {
    this.settle(generation, 'error');
  }

  private settle(generation: number, outcome: 'cancelled' | 'error'): void {
    if (!this.live(generation)) return;
    if (this.phase === 'success' || this.phase === 'cancelled' || this.phase === 'error' || this.phase === 'finishing') return;
    this.clearTimer();
    this.rewarded = false;
    this.grant = undefined;
    this.phase = outcome;
    this.onSettled?.({
      requestId: this.requestId,
      skinId: this.skinId,
      outcome,
    });
  }

  private arm(generation: number, ms: number): void {
    this.clearTimer();
    this.timer = this.clock.set(() => this.handleTimeout(generation), ms);
  }

  private enterRecovery(generation: number): void {
    if (!this.live(generation)) return;
    if (this.phase !== 'ad_open' && this.phase !== 'reward_received') return;
    this.clearTimer();
    this.phase = 'awaiting_close_recovery';
    this.onRecovery?.({
      requestId: this.requestId,
      skinId: this.skinId,
      rewarded: this.rewarded,
    });
  }

  private handleTimeout(generation: number): void {
    this.timer = undefined;
    if (!this.live(generation)) return;
    if (this.phase === 'reward_received' || this.phase === 'ad_open') {
      this.enterRecovery(generation);
      return;
    }
    if (this.phase === 'requesting') this.fail(generation);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.clock.clear(this.timer);
    this.timer = undefined;
  }

  private live(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}
