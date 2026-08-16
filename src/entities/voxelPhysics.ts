import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../blocks';
import type { VoxelWorld } from '../world/World';

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
}

function isCollidable(world: VoxelWorld, x: number, y: number, z: number): boolean {
  const block = world.getBlock(x, y, z);
  return block !== BlockId.Air && getBlockDefinition(block).solid;
}

function bodyIntersectsBlock(
  position: Readonly<THREE.Vector3>,
  shape: VoxelBodyShape,
  x: number,
  y: number,
  z: number,
): boolean {
  const halfWidth = shape.width * 0.5;
  return position.x + halfWidth > x + COLLISION_EPSILON
    && position.x - halfWidth < x + 1 - COLLISION_EPSILON
    && position.y + shape.height > y + COLLISION_EPSILON
    && position.y < y + 1 - COLLISION_EPSILON
    && position.z + halfWidth > z + COLLISION_EPSILON
    && position.z - halfWidth < z + 1 - COLLISION_EPSILON;
}

function collidingBlocks(
  world: VoxelWorld,
  position: Readonly<THREE.Vector3>,
  shape: VoxelBodyShape,
): Array<readonly [number, number, number]> {
  const halfWidth = shape.width * 0.5;
  const minX = Math.floor(position.x - halfWidth + COLLISION_EPSILON);
  const maxX = Math.floor(position.x + halfWidth - COLLISION_EPSILON);
  const minY = Math.floor(position.y + COLLISION_EPSILON);
  const maxY = Math.floor(position.y + shape.height - COLLISION_EPSILON);
  const minZ = Math.floor(position.z - halfWidth + COLLISION_EPSILON);
  const maxZ = Math.floor(position.z + halfWidth - COLLISION_EPSILON);
  const blocks: Array<readonly [number, number, number]> = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (isCollidable(world, x, y, z) && bodyIntersectsBlock(position, shape, x, y, z)) {
          blocks.push([x, y, z]);
        }
      }
    }
  }
  return blocks;
}

function resolveAxis(
  world: VoxelWorld,
  position: THREE.Vector3,
  shape: VoxelBodyShape,
  axis: 'x' | 'y' | 'z',
  amount: number,
): boolean {
  if (amount === 0) return false;
  position[axis] += amount;
  const collisions = collidingBlocks(world, position, shape);
  if (collisions.length === 0) return false;

  const halfWidth = shape.width * 0.5;
  if (axis === 'x') {
    if (amount > 0) {
      let boundary = Infinity;
      for (const block of collisions) boundary = Math.min(boundary, block[0] - halfWidth);
      position.x = boundary - COLLISION_EPSILON;
    } else {
      let boundary = -Infinity;
      for (const block of collisions) boundary = Math.max(boundary, block[0] + 1 + halfWidth);
      position.x = boundary + COLLISION_EPSILON;
    }
  } else if (axis === 'y') {
    if (amount > 0) {
      let boundary = Infinity;
      for (const block of collisions) boundary = Math.min(boundary, block[1] - shape.height);
      position.y = boundary - COLLISION_EPSILON;
    } else {
      let boundary = -Infinity;
      for (const block of collisions) boundary = Math.max(boundary, block[1] + 1);
      position.y = boundary + COLLISION_EPSILON;
    }
  } else if (amount > 0) {
    let boundary = Infinity;
    for (const block of collisions) boundary = Math.min(boundary, block[2] - halfWidth);
    position.z = boundary - COLLISION_EPSILON;
  } else {
    let boundary = -Infinity;
    for (const block of collisions) boundary = Math.max(boundary, block[2] + 1 + halfWidth);
    position.z = boundary + COLLISION_EPSILON;
  }
  return true;
}

/**
 * Moves a feet-anchored AABB through the voxel field, one axis at a time.
 * The caller owns velocity response so items can bounce while mobs can stop/jump.
 */
export function moveVoxelBody(
  world: VoxelWorld,
  position: THREE.Vector3,
  velocity: Readonly<THREE.Vector3>,
  deltaSeconds: number,
  shape: VoxelBodyShape,
): VoxelMoveResult {
  const hitX = resolveAxis(world, position, shape, 'x', velocity.x * deltaSeconds);
  const hitZ = resolveAxis(world, position, shape, 'z', velocity.z * deltaSeconds);
  const hitY = resolveAxis(world, position, shape, 'y', velocity.y * deltaSeconds);
  const sample = world.getBlock(
    Math.floor(position.x),
    Math.floor(position.y + shape.height * 0.5),
    Math.floor(position.z),
  );
  return {
    hitX,
    hitY,
    hitZ,
    onGround: hitY && velocity.y <= 0,
    inLiquid: getBlockDefinition(sample).liquid === true,
  };
}

export function isSpaceClear(
  world: VoxelWorld,
  position: Readonly<THREE.Vector3>,
  shape: VoxelBodyShape,
): boolean {
  return collidingBlocks(world, position, shape).length === 0;
}

export function hasVoxelLineOfSight(
  world: VoxelWorld,
  from: Readonly<THREE.Vector3>,
  to: Readonly<THREE.Vector3>,
): boolean {
  const direction = new THREE.Vector3().subVectors(to, from);
  const distance = direction.length();
  if (distance <= COLLISION_EPSILON) return true;
  const hit = world.raycast(new THREE.Vector3(from.x, from.y, from.z), direction, distance);
  return hit === undefined || hit.distance >= distance - 0.05;
}
