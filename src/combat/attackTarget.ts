import type { MinecartEntity } from '../entities/MinecartManager';
import type { VoxelHit } from '../world/World';

export type PlayerAttackTarget =
  | { readonly kind: 'mob'; readonly distance: number }
  | { readonly kind: 'minecart'; readonly cart: MinecartEntity; readonly distance: number }
  | { readonly kind: 'block'; readonly hit: VoxelHit };

export function resolvePlayerAttackTarget(
  blockHit: VoxelHit | undefined,
  cartHit: { cart: MinecartEntity; distance: number } | undefined,
  mobHit: { distance: number } | undefined,
  riddenCartId?: string,
): PlayerAttackTarget | undefined {
  const cart = cartHit && cartHit.cart.id !== riddenCartId ? cartHit : undefined;
  const mobCloser = mobHit && (!cart || mobHit.distance < cart.distance)
    && (!blockHit || mobHit.distance < blockHit.distance);
  if (mobCloser && mobHit) return { kind: 'mob', distance: mobHit.distance };
  const cartCloser = cart && (!blockHit || cart.distance <= blockHit.distance);
  if (cartCloser && cart) return { kind: 'minecart', cart: cart.cart, distance: cart.distance };
  if (blockHit) return { kind: 'block', hit: blockHit };
  return undefined;
}
