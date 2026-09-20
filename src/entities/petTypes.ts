import type { MobKind } from './mobDefinitions';

export const CAT_VARIANTS = ['black', 'red', 'siamese'] as const;
export type CatVariant = (typeof CAT_VARIANTS)[number];

export const PET_KINDS = ['wolf', 'cat'] as const;
export type PetKind = (typeof PET_KINDS)[number];

export type PetCombatTargetKind = 'mob' | 'player';
export type PetCombatPriority = 'defend' | 'assist';

export function isPetKind(kind: string | undefined): kind is PetKind {
  return kind === 'wolf' || kind === 'cat';
}

export function isCatVariant(value: string | undefined): value is CatVariant {
  return value === 'black' || value === 'red' || value === 'siamese';
}

export function isTameableMobKind(kind: MobKind): kind is PetKind {
  return isPetKind(kind);
}

export function fallbackCatVariant(value: string | undefined): CatVariant {
  return isCatVariant(value) ? value : 'black';
}

/** Owned pets of the same player never auto-target each other. */
export function samePetOwner(
  a: { readonly ownerId?: string },
  b: { readonly ownerId?: string },
): boolean {
  return Boolean(a.ownerId && b.ownerId && a.ownerId === b.ownerId);
}
