/**
 * Future server-owned one-switch permit.
 *
 * The live rewarded flow does not use these types. Yandex `onRewarded` is a
 * client callback. A `requestId` only correlates that callback with one skin.
 * It is not a signature, and the client can forge it. Do not treat it as proof.
 *
 * When server enforcement is added, the permit has to be created by the
 * server for its own session id, one skinId, and one request. Replaying the
 * id, swapping the skin, using an expired permit, or presenting another
 * session must fail. Reconnect of the skin already being worn is not a new
 * reward. That rollout is not this build: the menu can equip a skin before
 * any online session exists, and this contract is not wired into join or
 * `appearance`.
 */

/** One voluntary rewarded view for one not-yet-equipped common skin. */
export interface FutureRewardedSkinRequest {
  readonly kind: 'rewarded_skin_switch';
  readonly skinId: string;
  /** Correlation id only. Not a Yandex receipt and not server authority. */
  readonly requestId: string;
}

/**
 * Not issued by the live server. Fields describe the later check:
 * server session, one skin, one use, and an expiry.
 */
export interface FutureServerSkinSwitchPermit {
  readonly permitId: string;
  readonly sessionId: string;
  readonly skinId: string;
  readonly expiresAtMs: number;
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
