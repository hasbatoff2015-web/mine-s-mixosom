/**
 * Decorative companions. Separate from tameable wolf/cat pets (`isPetKind`).
 *
 * The persistent choice lives on the player. The runtime entity exists only
 * while that player is connected. Privilege checks stay at the command so a
 * later rank gate can call the same selection without a second pet system.
 */

export const COSMETIC_PET_SELECTIONS = ['bee', 'creeper'] as const;
export type CosmeticPetSelection = (typeof COSMETIC_PET_SELECTIONS)[number];

export const COSMETIC_PET_KINDS = ['pet_bee', 'pet_creeper'] as const;
export type CosmeticPetKind = (typeof COSMETIC_PET_KINDS)[number];

/** Unscaled creeper rig, feet at world Y=0, top of the head at this height. */
export const CREEPER_MODEL_HEIGHT = 1.625;
/** Unscaled creeper body width (8 model units). */
export const CREEPER_MODEL_WIDTH = 0.5;
/**
 * Uniform rig scale. 1.625 × 0.49 = 0.79625, inside the 0.75–0.85 block target.
 * Applied every visual sync; a one-shot root scale is overwritten.
 */
export const PET_CREEPER_MODEL_SCALE = 0.49;
export const PET_CREEPER_HEIGHT = CREEPER_MODEL_HEIGHT * PET_CREEPER_MODEL_SCALE;
export const PET_CREEPER_WIDTH = CREEPER_MODEL_WIDTH * PET_CREEPER_MODEL_SCALE;

/** Hard ceiling for connected decorative pets. Not the wolf/cat tame cap. */
export const COSMETIC_PET_WORLD_CAP = 64;

export const BEE_BODY_WIDTH = 0.5;
export const BEE_BODY_HEIGHT = 0.78;
export const BEE_SHOULDER_OFFSET = 1.22;
export const BEE_CATCHUP_DISTANCE = 16;
export const BEE_MAX_SPEED = 9.2;

export const MINI_CREEPER_STOP_DISTANCE = 2;
export const MINI_CREEPER_START_DISTANCE = 3;
export const MINI_CREEPER_CATCHUP_DISTANCE = 16;

export function isCosmeticPetKind(kind: string | undefined): kind is CosmeticPetKind {
  return kind === 'pet_bee' || kind === 'pet_creeper';
}

export function isCosmeticPetSelection(value: string | undefined): value is CosmeticPetSelection {
  return value === 'bee' || value === 'creeper';
}

/** Missing and unknown persisted values both mean "no pet". */
export function parseCosmeticPetSelection(value: unknown): CosmeticPetSelection | null {
  return value === 'bee' || value === 'creeper' ? value : null;
}

export function cosmeticKindForSelection(selection: CosmeticPetSelection): CosmeticPetKind {
  return selection === 'bee' ? 'pet_bee' : 'pet_creeper';
}

export function selectionForCosmeticKind(kind: CosmeticPetKind): CosmeticPetSelection {
  return kind === 'pet_bee' ? 'bee' : 'creeper';
}

/** Stable 0..1 offset so two owners do not share the same hover angle. */
export function cosmeticOwnerSeed(ownerId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < ownerId.length; index += 1) {
    hash ^= ownerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}
