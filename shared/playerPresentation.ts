import type { BlockId } from '../src/blocks';
import type { ItemStack } from '../src/inventory';

export interface EquippedArmorPresentation {
  readonly head: ItemStack['itemId'] | null;
  readonly chest: ItemStack['itemId'] | null;
  readonly legs: ItemStack['itemId'] | null;
  readonly feet: ItemStack['itemId'] | null;
}

export const EMPTY_EQUIPPED_ARMOR: EquippedArmorPresentation = Object.freeze({
  head: null,
  chest: null,
  legs: null,
  feet: null,
});

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
  /** Worn armor item ids. Missing on old snapshots means unequipped. */
  readonly armor?: EquippedArmorPresentation;
  /** Server-owned full-hurt counter. Join establishes a baseline, never replays history. */
  readonly hurtSeq?: number;
}

export interface ArmorSlotReader {
  getSlot(ref: { readonly section: 'armor'; readonly slot: keyof EquippedArmorPresentation }): {
    readonly itemId: string;
  } | null;
}

export function equippedArmorFromInventory(inventory: ArmorSlotReader): EquippedArmorPresentation {
  return {
    head: inventory.getSlot({ section: 'armor', slot: 'head' })?.itemId ?? null,
    chest: inventory.getSlot({ section: 'armor', slot: 'chest' })?.itemId ?? null,
    legs: inventory.getSlot({ section: 'armor', slot: 'legs' })?.itemId ?? null,
    feet: inventory.getSlot({ section: 'armor', slot: 'feet' })?.itemId ?? null,
  };
}

export function equippedArmorFromPartial(armor?: EquippedArmorPresentation | null): EquippedArmorPresentation {
  return {
    head: armor?.head ?? null,
    chest: armor?.chest ?? null,
    legs: armor?.legs ?? null,
    feet: armor?.feet ?? null,
  };
}

export function presentationHurtSeq(state: PlayerPresentationState): number {
  return state.hurtSeq ?? 0;
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
  armor: EMPTY_EQUIPPED_ARMOR,
  hurtSeq: 0,
});
