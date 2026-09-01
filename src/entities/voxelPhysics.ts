import { Vec3, type Vec3Like } from '../math/vec3';
import { getBlockDefinition } from '../blocks';
import type { VoxelWorld } from '../world/World';
import { blockCollisionBoxes, collisionCandidateCellRange } from '../world/collision';

const COLLISION_EPSILON = 1e-5;

export interface VoxelBodyShape {
  /** Horizontal size of the body. */
  readonly width: number;
  /** Height measured upward from `position.y` (the body's feet). */
  readonly height: number;
}

export interface VoxelMoveResult {
  readonly onGround: boolean;
  readonly hitX: boolean;
  readonly hitY: boolean;
  readonly hitZ: boolean;
  readonly inLiquid: boolean;
  readonly stepped: boolean;
}

export interface VoxelMoveOptions {
  /** When set, a grounded body may climb a single solid step of this height. */
  readonly stepHeight?: number;
}

interface BodyAABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function bodyAabb(position: Vec3Like, shape: VoxelBodyShape): BodyAABB {
  const halfWidth = shape.width * 0.5;
  return {
    minX: position.x - halfWidth,
    minY: position.y,
    minZ: position.z - halfWidth,
    maxX: position.x + halfWidth,
    maxY: position.y + shape.height,
    maxZ: position.z + halfWidth,
  };
}

function boxesOverlap(
  body: BodyAABB,
  block: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number },
): boolean {
  return body.maxX > block.minX + COLLISION_EPSILON
    && body.minX < block.maxX - COLLISION_EPSILON
    && body.maxY > block.minY + COLLISION_EPSILON
    && body.minY < block.maxY - COLLISION_EPSILON
    && body.maxZ > block.minZ + COLLISION_EPSILON
    && body.minZ < block.maxZ - COLLISION_EPSILON;
}

function collidingBoxes(
  world: VoxelWorld,
  position: Vec3Like,
  shape: VoxelBodyShape,
): Array<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }> {
  const body = bodyAabb(position, shape);
  const cells = collisionCandidateCellRange(
    body.minX, body.minY, body.minZ, body.maxX, body.maxY, body.maxZ, COLLISION_EPSILON,
  );
  const collected = [];
  for (let y = cells.minY; y <= cells.maxY; y += 1) {
    for (let z = cells.minZ; z <= cells.maxZ; z += 1) {
      for (let x = cells.minX; x <= cells.maxX; x += 1) {
        const solids = blockCollisionBoxes(world, x, y, z);
        for (const box of solids) {
          if (boxesOverlap(body, box)) collected.push(box);
        }
      }
    }
  }
  return collected;
}

function resolveAxis(
  world: VoxelWorld,
  position: Vec3,
  shape: VoxelBodyShape,
  axis: 'x' | 'y' | 'z',
  amount: number,
): boolean {
  if (amount === 0) return false;
  position[axis] += amount;
  const collisions = collidingBoxes(world, position, shape);
  if (collisions.length === 0) return false;

  const halfWidth = shape.width * 0.5;
  if (axis === 'x') {
    if (amount > 0) {
      let boundary = Infinity;
      for (const block of collisions) boundary = Math.min(boundary, block.minX - halfWidth);
      position.x = boundary - COLLISION_EPSILON;
    } else {
      let boundary = -Infinity;
      for (const block of collisions) boundary = Math.max(boundary, block.maxX + halfWidth);
      position.x = boundary + COLLISION_EPSILON;
    }
  } else if (axis === 'y') {
    if (amount > 0) {
      let boundary = Infinity;
      for (const block of collisions) boundary = Math.min(boundary, block.minY - shape.height);
      position.y = boundary - COLLISION_EPSILON;
    } else {
      let boundary = -Infinity;
      for (const block of collisions) boundary = Math.max(boundary, block.maxY);
      position.y = boundary + COLLISION_EPSILON;
    }
  } else if (amount > 0) {
    let boundary = Infinity;
    for (const block of collisions) boundary = Math.min(boundary, block.minZ - halfWidth);
    position.z = boundary - COLLISION_EPSILON;
  } else {
    let boundary = -Infinity;
    for (const block of collisions) boundary = Math.max(boundary, block.maxZ + halfWidth);
    position.z = boundary + COLLISION_EPSILON;
  }
  return true;
}

function supportedFromBelow(world: VoxelWorld, position: Vec3Like, shape: VoxelBodyShape): boolean {
  const probe = new Vec3(position.x, position.y - 0.08, position.z);
  return collidingBoxes(world, probe, shape).length > 0;
}

function horizontalDistanceSquared(from: Vec3Like, to: Vec3Like): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return dx * dx + dz * dz;
}

/**
 * Moves a feet-anchored AABB through the voxel field, one axis at a time.
 * Optional stepHeight lets mobs climb a single 1-block obstacle without a new pathfinder.
 */
export function moveVoxelBody(
  world: VoxelWorld,
  position: Vec3,
  velocity: Vec3Like,
  deltaSeconds: number,
  shape: VoxelBodyShape,
  options: VoxelMoveOptions = {},
): VoxelMoveResult {
  const dx = velocity.x * deltaSeconds;
  const dy = velocity.y * deltaSeconds;
  const dz = velocity.z * deltaSeconds;
  const beforeHorizontal = position.clone();
  const grounded = supportedFromBelow(world, position, shape);
  let hitX = resolveAxis(world, position, shape, 'x', dx);
  let hitZ = resolveAxis(world, position, shape, 'z', dz);
  const blocked = position.clone();
  let stepped = false;
  const stepHeight = options.stepHeight ?? 0;

  if ((hitX || hitZ) && grounded && stepHeight > 0) {
    position.copy(beforeHorizontal);
    resolveAxis(world, position, shape, 'y', stepHeight);
    if (position.y > beforeHorizontal.y + COLLISION_EPSILON) {
      resolveAxis(world, position, shape, 'x', dx);
      resolveAxis(world, position, shape, 'z', dz);
      if (horizontalDistanceSquared(beforeHorizontal, position)
        > horizontalDistanceSquared(beforeHorizontal, blocked) + COLLISION_EPSILON
        && collidingBoxes(world, position, shape).length === 0) {
        resolveAxis(world, position, shape, 'y', -(position.y - beforeHorizontal.y));
        stepped = true;
        hitX = false;
        hitZ = false;
      } else {
        position.copy(blocked);
      }
    } else {
      position.copy(blocked);
    }
  }

  const hitY = resolveAxis(world, position, shape, 'y', dy);
  const sample = world.getBlock(
    Math.floor(position.x),
    Math.floor(position.y + shape.height * 0.5),
    Math.floor(position.z),
    false,
  );
  return {
    hitX,
    hitY,
    hitZ,
    onGround: (hitY && velocity.y <= 0) || supportedFromBelow(world, position, shape),
    inLiquid: getBlockDefinition(sample).liquid === true,
    stepped,
  };
}

export function isSpaceClear(
  world: VoxelWorld,
  position: Vec3Like,
  shape: VoxelBodyShape,
): boolean {
  return collidingBoxes(world, position, shape).length === 0;
}

export function hasVoxelLineOfSight(
  world: VoxelWorld,
  from: Vec3Like,
  to: Vec3Like,
): boolean {
  const direction = new Vec3().subVectors(to, from);
  const distance = direction.length();
  if (distance <= COLLISION_EPSILON) return true;
  const hit = world.raycast(new Vec3(from.x, from.y, from.z), direction, distance);
  return hit === undefined || hit.distance >= distance - 0.05;
}
