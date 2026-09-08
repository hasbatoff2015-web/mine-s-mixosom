import type { Vec3Like } from '../math/vec3';
import type { MinecartEntity, MinecartManager } from './MinecartManager';

export interface EjectedMinecartTnt {
  readonly blockId: number;
  readonly position: Vec3Like;
  readonly velocity: Vec3Like;
}

interface MinecartTntLauncher {
  launchMinecartTnt(
    position: Vec3Like,
    velocity: Vec3Like,
    blockId: number,
  ): unknown;
}

/**
 * Fire-arrow ignition of TNT cargo: eject the stored type as primed TNT.
 * Ordinary arrows and flint must not call this.
 */
export function igniteMinecartTntFromFireArrow(
  minecarts: MinecartManager,
  redstone: MinecartTntLauncher,
  cart: MinecartEntity,
): boolean {
  const cargo = minecarts.ejectTntCargo(cart);
  if (!cargo) return false;
  return redstone.launchMinecartTnt(cargo.position, cargo.velocity, cargo.blockId) !== undefined;
}
