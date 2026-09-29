/** Damage the previous formula would deal: ceil(fallDistance - 3), minimum 0. */
export function vanillaFallDamage(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, Math.ceil(distance - 3));
}

/** About half of `vanillaFallDamage`. Fractional hits round down. */
export function scaledFallDamage(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw / 2);
}

/** Fall damage applied to the player. Computed once, then passed to survival. */
export function fallDamageFromDistance(distance: number): number {
  return scaledFallDamage(vanillaFallDamage(distance));
}

/** Half a heart. Fall damage may reduce the player to this, and no lower. */
export const FALL_DAMAGE_MIN_HEALTH = 1;
