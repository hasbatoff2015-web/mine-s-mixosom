import { ItemId } from '../items';
import type { CatVariant } from './petTypes';

export const PET_TAME_CHANCE = 1 / 3;

export const WOLF_TAME_ITEM = ItemId.Bone;
export const CAT_TAME_ITEMS: readonly string[] = [
  ItemId.CookedBeef,
  ItemId.CookedPorkchop,
  ItemId.CookedChicken,
];

export const CAT_VARIANT_WEIGHTS: readonly CatVariant[] = ['black', 'red', 'siamese'];

/** Idle around the owner at or inside this radius. */
export const PET_FOLLOW_STOP_DISTANCE = 4;
/** Direct-steer follow starts beyond the stop radius. */
export const PET_FOLLOW_START_DISTANCE = 4;
/** Catch-up teleport when farther than this from a living owner. */
export const PET_TELEPORT_DISTANCE = 16;
export const PET_TELEPORT_COOLDOWN_SECONDS = 0.75;
/** Drop combat and return if farther than this from the owner. */
export const PET_COMBAT_ABANDON_OWNER_DISTANCE = 18;
export const PET_COMBAT_TARGET_TIMEOUT_SECONDS = 8;
export const WILD_WOLF_ANGER_SECONDS = 20;
export const CAT_FEAR_DISTANCE = 6;
export const CAT_FEAR_SECONDS = 2.4;
export const PET_INTERACT_REACH = 3;
export const PET_FOLLOW_SPEED_FACTOR = 1.18;
export const PET_FLEE_SPEED_FACTOR = 1.7;
export const PET_COMBAT_SPEED_FACTOR = 1.22;
export const WOLF_ATTACK_DAMAGE = 2;
export const WOLF_MAX_HEALTH = 8;
export const CAT_MAX_HEALTH = 8;
export const WILD_PET_WANDER_RADIUS = 3.5;

/**
 * Bounded XZ ring around the owner. 24 candidates, no flood fill.
 * Distances 2–4 keep the pet near the owner without overlapping their AABB.
 */
export const PET_TELEPORT_OFFSETS: readonly (readonly [number, number])[] = [
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [2, 2], [2, -2], [-2, 2], [-2, -2],
  [3, 0], [-3, 0], [0, 3], [0, -3],
  [3, 1], [3, -1], [-3, 1], [-3, -1],
  [1, 3], [-1, 3], [1, -3], [-1, -3],
  [4, 0], [-4, 0], [0, 4], [0, -4],
];

export const PET_FOLLOW_STOP_DISTANCE_SQ = PET_FOLLOW_STOP_DISTANCE * PET_FOLLOW_STOP_DISTANCE;
export const PET_TELEPORT_DISTANCE_SQ = PET_TELEPORT_DISTANCE * PET_TELEPORT_DISTANCE;
export const PET_COMBAT_ABANDON_OWNER_DISTANCE_SQ =
  PET_COMBAT_ABANDON_OWNER_DISTANCE * PET_COMBAT_ABANDON_OWNER_DISTANCE;
export const CAT_FEAR_DISTANCE_SQ = CAT_FEAR_DISTANCE * CAT_FEAR_DISTANCE;
export const WILD_PET_WANDER_RADIUS_SQ = WILD_PET_WANDER_RADIUS * WILD_PET_WANDER_RADIUS;
