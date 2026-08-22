import { BlockId, type HorizontalFacing } from '../blocks';
import type { CollisionBox } from '../world/collision';
import { ladderPlaneLocal } from '../rendering/specialBlockGeometry';

/** Vanilla 0.2 block/tick. */
export const LADDER_CLIMB_SPEED = 4.0;
/** Vanilla 0.15 block/tick downward clamp. */
export const LADDER_MAX_DESCENT_SPEED = 3.0;
/** Extra thickness into the open cell so contact is playable, not pixel-perfect. */
export const LADDER_CONTACT_PADDING = 0.15;
/** Slight extra height so the lip at the top is not a one-frame drop. */
export const LADDER_TOP_PADDING = 0.2;
export const LADDER_CLIMB_INTENT_DOT = 0.25;

export interface LadderContact {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: HorizontalFacing;
  readonly towardX: number;
  readonly towardZ: number;
}

export interface LadderWorldView {
  getBlock(x: number, y: number, z: number, generate?: boolean): BlockId;
  getBlockState?(x: number, y: number, z: number): { facing?: HorizontalFacing } | undefined;
}

export interface BodyAabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export function ladderTowardSupport(facing: HorizontalFacing): { x: number; z: number } {
  const outward = ladderPlaneLocal(facing).outward;
  return { x: -outward[0], z: -outward[2] };
}

/** Climb volume: thin ladder box expanded into the open cell, not the whole voxel. */
export function ladderClimbBox(x: number, y: number, z: number, facing: HorizontalFacing): CollisionBox {
  const plane = ladderPlaneLocal(facing);
  const pad = LADDER_CONTACT_PADDING;
  if (plane.axis === 'x') {
    const minX = plane.outward[0] > 0 ? plane.min : plane.min - pad;
    const maxX = plane.outward[0] > 0 ? plane.max + pad : plane.max;
    return {
      minX: x + minX,
      maxX: x + maxX,
      minY: y,
      maxY: y + 1 + LADDER_TOP_PADDING,
      minZ: z,
      maxZ: z + 1,
    };
  }
  const minZ = plane.outward[2] > 0 ? plane.min : plane.min - pad;
  const maxZ = plane.outward[2] > 0 ? plane.max + pad : plane.max;
  return {
    minX: x,
    maxX: x + 1,
    minY: y,
    maxY: y + 1 + LADDER_TOP_PADDING,
    minZ: z + minZ,
    maxZ: z + maxZ,
  };
}

export function boxesOverlap(a: BodyAabb, b: CollisionBox, epsilon = 1e-7): boolean {
  return a.maxX > b.minX + epsilon && a.minX < b.maxX - epsilon
    && a.maxY > b.minY + epsilon && a.minY < b.maxY - epsilon
    && a.maxZ > b.minZ + epsilon && a.minZ < b.maxZ - epsilon;
}

export function desiredHorizontalWish(
  yaw: number,
  forward: number,
  right: number,
): { x: number; z: number; length: number } {
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  let x = forwardX * forward + rightX * right;
  let z = forwardZ * forward + rightZ * right;
  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }
  return { x, z, length };
}

export function isClimbIntent(
  wishX: number,
  wishZ: number,
  towardX: number,
  towardZ: number,
  threshold = LADDER_CLIMB_INTENT_DOT,
): boolean {
  const length = Math.hypot(wishX, wishZ);
  if (length < 1e-4) return false;
  return (wishX * towardX + wishZ * towardZ) / length >= threshold;
}

export function findLadderContact(world: LadderWorldView, body: BodyAabb): LadderContact | undefined {
  const minX = Math.floor(body.minX) - 1;
  const maxX = Math.floor(body.maxX - 1e-7) + 1;
  const minY = Math.floor(body.minY) - 1;
  const maxY = Math.floor(body.maxY - 1e-7);
  const minZ = Math.floor(body.minZ) - 1;
  const maxZ = Math.floor(body.maxZ - 1e-7) + 1;
  let best: LadderContact | undefined;
  let bestOverlap = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (world.getBlock(x, y, z, false) !== BlockId.Ladder) continue;
        const facing = world.getBlockState?.(x, y, z)?.facing ?? 'north';
        const box = ladderClimbBox(x, y, z, facing);
        if (!boxesOverlap(body, box)) continue;
        const overlap = overlapVolume(body, box);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          const toward = ladderTowardSupport(facing);
          best = { x, y, z, facing, towardX: toward.x, towardZ: toward.z };
        }
      }
    }
  }
  return best;
}

export function ladderVerticalVelocity(options: {
  readonly climbIntent: boolean;
  readonly sneak: boolean;
  readonly keepJump: boolean;
  readonly currentY: number;
}): number {
  if (options.climbIntent) return LADDER_CLIMB_SPEED;
  if (options.sneak) return 0;
  if (options.keepJump) return options.currentY;
  return -LADDER_MAX_DESCENT_SPEED;
}

function overlapVolume(a: BodyAabb, b: CollisionBox): number {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const y = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const z = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
  return x * y * z;
}
