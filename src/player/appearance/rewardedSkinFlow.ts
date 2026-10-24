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

const BUSY: ReadonlySet<RewardedFlowPhase> = new Set([
  'requesting',
  'ad_open',
  'reward_received',
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

  get isBusy(): boolean {
    return BUSY.has(this.phase);
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
    this.onSettled = undefined;
  }

  private handleOpen(generation: number): void {
    if (!this.live(generation) || this.phase !== 'requesting') return;
    this.phase = 'ad_open';
    this.arm(generation, REWARDED_OPEN_TIMEOUT_MS);
    this.onOpened?.({ requestId: this.requestId, skinId: this.skinId });
  }

  private handleRewarded(generation: number): void {
    if (!this.live(generation)) return;
    if (this.phase !== 'requesting' && this.phase !== 'ad_open') return;
    this.rewarded = true;
    this.phase = 'reward_received';
    this.arm(generation, REWARDED_FINISH_TIMEOUT_MS);
  }

  private handleClose(generation: number): void {
    if (!this.live(generation)) return;
    if (this.rewarded && (this.phase === 'reward_received' || this.phase === 'ad_open' || this.phase === 'requesting')) {
      this.succeed(generation);
      return;
    }
    if (this.phase !== 'requesting' && this.phase !== 'ad_open') return;
    this.settle(generation, 'cancelled');
  }

  private handleError(generation: number): void {
    if (!this.live(generation)) return;
    if (this.phase !== 'requesting' && this.phase !== 'ad_open') return;
    this.fail(generation);
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

  private handleTimeout(generation: number): void {
    this.timer = undefined;
    if (!this.live(generation)) return;
    if (this.phase === 'reward_received') {
      this.succeed(generation);
      return;
    }
    if (this.phase === 'requesting' || this.phase === 'ad_open') this.fail(generation);
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
