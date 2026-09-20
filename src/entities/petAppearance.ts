import type { CatVariant } from './petTypes';
import { fallbackCatVariant, isPetKind } from './petTypes';
import type { MobKind } from './mobDefinitions';

export type WolfAppearance = 'wild' | 'angry' | 'tamed';

export interface PetAppearanceState {
  readonly kind: MobKind;
  readonly ownerId?: string;
  readonly angry?: boolean;
  readonly variant?: string;
}

export function wolfAppearance(state: Pick<PetAppearanceState, 'ownerId' | 'angry'>): WolfAppearance {
  if (state.ownerId) return 'tamed';
  if (state.angry) return 'angry';
  return 'wild';
}

export function petBodyTexturePath(state: PetAppearanceState): string | undefined {
  if (state.kind === 'wolf') {
    const appearance = wolfAppearance(state);
    if (appearance === 'tamed') return 'entity/wolf/wolf_tame';
    if (appearance === 'angry') return 'entity/wolf/wolf_angry';
    return 'entity/wolf/wolf';
  }
  if (state.kind === 'cat') return `entity/cat/${fallbackCatVariant(state.variant)}`;
  return undefined;
}

export function petAppearanceKey(state: PetAppearanceState): string {
  if (!isPetKind(state.kind)) return state.kind;
  if (state.kind === 'wolf') {
    return `wolf:${wolfAppearance(state)}:${state.ownerId ? 'collar' : 'bare'}`;
  }
  return `cat:${fallbackCatVariant(state.variant)}`;
}

export function catTexturePath(variant: CatVariant): string {
  return `entity/cat/${variant}`;
}

export const WOLF_COLLAR_TEXTURE_PATH = 'entity/wolf/wolf_collar';
/** Minecraft 1.9 default red dye. The collar sheet itself is white + alpha. */
export const WOLF_COLLAR_COLOR = 0xb02e26;
