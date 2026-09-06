import type { BlockId } from '../src/blocks';
import type { ItemStack } from '../src/inventory';

/** Latest authoritative state, separate from the spatial interpolation timeline. */
export interface PlayerPresentationState {
  /** Null means idle; progress is the server's normalized mining accumulator. */
  readonly mining: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly blockId: BlockId;
    readonly progress: number;
  } | null;
  readonly heldItemId: ItemStack['itemId'] | null;
  readonly bowCharge: number;
  readonly foodUseProgress: number;
  readonly swordBlocking: boolean;
  /** Server-owned swing counter. A join establishes a baseline, never replays history. */
  readonly swingSeq: number;
}

/** Safety timeout only: never advances progress or predicts a break. */
export const REMOTE_ACTION_STALE_MS = 1500;

export const IDLE_PLAYER_PRESENTATION: PlayerPresentationState = Object.freeze({
  mining: null,
  heldItemId: null,
  bowCharge: 0,
  foodUseProgress: 0,
  swordBlocking: false,
  swingSeq: 0,
});
