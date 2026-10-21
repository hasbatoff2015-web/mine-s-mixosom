/**
 * Typed seams for a later Yandex Games stage.
 * Nothing in the running game calls rewarded ads or purchases through these types.
 * `YandexGamesService` still only handles lifecycle and SDK startup.
 */

/** One voluntary rewarded view for one not-yet-equipped common skin. */
export interface FutureRewardedSkinRequest {
  readonly kind: 'rewarded_skin_switch';
  readonly skinId: string;
  /** Binds the callback to this request so one reward cannot equip a different skin. */
  readonly requestId: string;
}

export type FutureRewardedSkinResult =
  | { readonly requestId: string; readonly skinId: string; readonly status: 'rewarded' }
  | { readonly requestId: string; readonly skinId: string; readonly status: 'cancelled' | 'error' };

/**
 * Price row from the platform catalog. Stage 1 does not fetch this.
 * UI target prices are not a substitute for `formatted`.
 */
export interface FuturePlatformPrice {
  readonly sku: string;
  readonly formatted: string;
  readonly currency: string;
}

export interface FutureSkinPurchaseRequest {
  readonly sku: string;
}

export type FutureSkinPurchaseResult =
  | { readonly sku: string; readonly status: 'purchased'; readonly token: string }
  | { readonly sku: string; readonly status: 'cancelled' | 'error' };
