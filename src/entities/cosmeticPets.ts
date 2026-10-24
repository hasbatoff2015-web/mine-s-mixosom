/**
 * Decorative companions. Separate from tameable wolf/cat pets (`isPetKind`).
 *
 * The persistent choice lives on the player. The runtime entity exists only
 * while that player is connected. The server checks `pet.bee` and `pet.creeper`
 * before it creates or keeps one. Wolf and cat pets stay on `isPetKind()`.
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

/** Half the first displayed bee. The source cube is the same 7×7×10 pixels. */
export const PET_BEE_MODEL_SCALE = 0.5;
/**
 * Body-cube center above the entity root before scale.
 * Bedrock body center Y is 5.5 pixels and the root is model Y=0.
 */
export const BEE_BODY_CENTER_LOCAL_Y = 5.5 / 16;
/** Visible body center above the owner's feet. Eyes sit near 1.62. */
export const BEE_SHOULDER_CENTER_HEIGHT = 1.22;
export const BEE_BODY_WIDTH = (7 / 16) * PET_BEE_MODEL_SCALE + 0.04;
export const BEE_BODY_HEIGHT = (9 / 16) * PET_BEE_MODEL_SCALE + 0.04;
export const BEE_CATCHUP_DISTANCE = 16;
export const BEE_MAX_SPEED = 9.2;

/** Root Y that puts the scaled body center on the shoulder line. */
export function beeRootYForShoulder(ownerFeetY: number): number {
  return ownerFeetY + BEE_SHOULDER_CENTER_HEIGHT - BEE_BODY_CENTER_LOCAL_Y * PET_BEE_MODEL_SCALE;
}

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
