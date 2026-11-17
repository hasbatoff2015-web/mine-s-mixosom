import { BlockId, getBlockDefinition } from '../blocks';
import { PLAYER_HEIGHT } from '../core/constants';
import { isLiveFire } from '../blocks/fireBlocks';
import type { VoxelWorld } from './World';

export interface SafeStand {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function dangerous(block: BlockId): boolean {
  return block === BlockId.Lava || block === BlockId.Cactus || isLiveFire(block);
}

/** Feet at `y`, full player body clear, solid ground, no lava or fire. */
export function isSafeStand(world: VoxelWorld, x: number, feetY: number, z: number): boolean {
  const groundY = Math.floor(feetY) - 1;
  const feetBlockY = Math.floor(feetY);
  const headY = Math.floor(feetY + PLAYER_HEIGHT - 0.05);
  if (groundY < 0 || headY > 255) return false;
  const ground = world.getBlock(x, groundY, z, false);
  const groundDef = getBlockDefinition(ground);
  if (!groundDef.solid || dangerous(ground)) return false;
  for (let y = feetBlockY; y <= headY; y += 1) {
    const block = world.getBlock(x, y, z, false);
    const definition = getBlockDefinition(block);
    if (definition.solid || definition.liquid || dangerous(block)) return false;
  }
  return true;
}

/**
 * Prefer the requested point, then a 10-block radius, then the local surface.
 * Returns the player feet position.
 */
export function findSafeTeleport(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  radius = 10,
): SafeStand | undefined {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const iy = Math.floor(y);
  if (isSafeStand(world, ix, iy, iz)) return { x: ix + 0.5, y: iy, z: iz + 0.5 };
  for (let r = 1; r <= radius; r += 1) {
    for (let dz = -r; dz <= r; dz += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let dy = -r; dy <= r; dy += 1) {
          const feet = iy + dy;
          if (isSafeStand(world, ix + dx, feet, iz + dz)) {
            return { x: ix + dx + 0.5, y: feet, z: iz + dz + 0.5 };
          }
        }
      }
    }
  }
  const surface = world.surfaceY(ix, iz);
  for (let r = 0; r <= radius; r += 1) {
    for (let dz = -r; dz <= r; dz += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (r !== 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const sx = ix + dx;
        const sz = iz + dz;
        const top = r === 0 ? surface : world.surfaceY(sx, sz);
        const feet = top + 1;
        if (isSafeStand(world, sx, feet, sz)) return { x: sx + 0.5, y: feet, z: sz + 0.5 };
      }
    }
  }
  return undefined;
}
