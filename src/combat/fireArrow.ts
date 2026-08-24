import { BlockId } from '../blocks';

/** Java 1.9 fire-arrow burn duration: 5 seconds at 20 TPS. */
export const FIRE_ARROW_IGNITE_TICKS = 100;

export type FlamingArrowBlockHit = 'prime_tnt' | 'none';

/**
 * Fire arrows are a combat/trigger projectile, not a world igniter.
 * They prime TNT and ignite living entities, but never place `BlockId.Fire`.
 */
export function flamingArrowBlockHit(block: BlockId): FlamingArrowBlockHit {
  return block === BlockId.Tnt ? 'prime_tnt' : 'none';
}
