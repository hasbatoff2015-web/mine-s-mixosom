import { BlockId, getBlockDefinition } from '../blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y } from '../core/constants';
import { Vec3, type Vec3Like } from '../math/vec3';
import type { VoxelWorld } from '../world/World';
import { moveVoxelBody } from './voxelPhysics';
import { clampHorizontalCenterToWorldBorder } from '../world/worldBorder';
import { findSafePetTeleport } from './petTeleport';
import {
  BEE_BODY_HEIGHT,
  BEE_BODY_WIDTH,
  BEE_CATCHUP_DISTANCE,
  BEE_MAX_SPEED,
  BEE_SHOULDER_OFFSET,
  MINI_CREEPER_CATCHUP_DISTANCE,
  MINI_CREEPER_START_DISTANCE,
  MINI_CREEPER_STOP_DISTANCE,
  PET_CREEPER_HEIGHT,
  PET_CREEPER_WIDTH,
  cosmeticOwnerSeed,
  type CosmeticPetKind,
} from './cosmeticPets';

export interface CosmeticOwnerFocus {
  readonly id: string;
  readonly position: Vec3Like;
  readonly alive?: boolean;
}

export interface CosmeticFlightBody {
  position: Vec3;
  velocity: Vec3;
  facingYaw: number;
  locomotionSpeed: number;
  ageSeconds: number;
  poseEpoch: number;
  cosmeticFollowActive: boolean;
  cosmeticAnchorX?: number;
  cosmeticAnchorY?: number;
  cosmeticAnchorZ?: number;
  readonly definition: { readonly width: number; readonly height: number };
}

export interface CosmeticStepResult {
  readonly teleported: boolean;
}

interface BodyShape {
  readonly width: number;
  readonly height: number;
}

const BEE_SHAPE: BodyShape = { width: BEE_BODY_WIDTH, height: BEE_BODY_HEIGHT };
const CREEPER_SHAPE: BodyShape = { width: PET_CREEPER_WIDTH, height: PET_CREEPER_HEIGHT };

const BEE_IDLE_OFFSETS: readonly (readonly [number, number])[] = [
  [1.45, 0.15], [-1.35, 0.2], [0.2, 1.5], [-0.15, -1.4],
  [1.05, 1.05], [1.1, -0.95], [-1.05, 1.0], [-0.95, -1.1],
  [1.9, 0.35], [-1.85, -0.3], [0.4, 1.9], [-0.45, -1.85],
];

function cellBlocksCosmetic(block: BlockId): boolean {
  if (block === BlockId.Air) return false;
  if (block === BlockId.Water || block === BlockId.Lava || block === BlockId.Fire) return true;
  const definition = getBlockDefinition(block);
  return definition.solid || definition.liquid === true;
}

export function cosmeticBodyClear(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  shape: BodyShape,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (y < MIN_WORLD_Y + 1 || y + shape.height > MAX_WORLD_Y - 1) return false;
  const clamped = clampHorizontalCenterToWorldBorder(x, z, shape.width);
  if (Math.abs(clamped.x - x) > 0.02 || Math.abs(clamped.z - z) > 0.02) return false;
  const minX = Math.floor(x - shape.width * 0.5);
  const maxX = Math.floor(x + shape.width * 0.5 - 1e-4);
  const minY = Math.floor(y);
  const maxY = Math.floor(y + shape.height - 1e-4);
  const minZ = Math.floor(z - shape.width * 0.5);
  const maxZ = Math.floor(z + shape.width * 0.5 - 1e-4);
  let checks = 0;
  for (let by = minY; by <= maxY; by += 1) {
    for (let bz = minZ; bz <= maxZ; bz += 1) {
      for (let bx = minX; bx <= maxX; bx += 1) {
        checks += 1;
        if (checks > 32) return false;
        if (cellBlocksCosmetic(world.getBlock(bx, by, bz, false))) return false;
      }
    }
  }
  return true;
}

function approach(current: number, desired: number, maxDelta: number): number {
  const delta = desired - current;
  if (Math.abs(delta) <= maxDelta) return desired;
  return current + Math.sign(delta) * maxDelta;
}

function approachAngle(current: number, target: number, maxDelta: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (delta > maxDelta) delta = maxDelta;
  if (delta < -maxDelta) delta = -maxDelta;
  return current + delta;
}

function horizontalSpeed(body: CosmeticFlightBody): number {
  return Math.hypot(body.velocity.x, body.velocity.z);
}

function beeHoverTarget(owner: Vec3Like, ageSeconds: number, ownerId: string): Vec3 {
  const seed = cosmeticOwnerSeed(ownerId);
  const angle = seed * Math.PI * 2 + Math.sin(ageSeconds * 0.55 + seed * 4) * 0.5;
  const radius = 1.45 + Math.sin(ageSeconds * 0.37 + seed) * 0.22;
  return new Vec3(
    owner.x + Math.cos(angle) * radius,
    owner.y + BEE_SHOULDER_OFFSET + Math.sin(ageSeconds * 1.25) * 0.03,
    owner.z + Math.sin(angle) * radius,
  );
}

function beeFollowTarget(owner: Vec3Like, movedX: number, movedZ: number): Vec3 {
  const step = Math.hypot(movedX, movedZ);
  const inverse = step > 1e-4 ? 1 / step : 0;
  const forwardX = movedX * inverse;
  const forwardZ = movedZ * inverse;
  const sideX = -forwardZ;
  const sideZ = forwardX;
  return new Vec3(
    owner.x - forwardX * 1.15 + sideX * 0.75,
    owner.y + BEE_SHOULDER_OFFSET,
    owner.z - forwardZ * 1.15 + sideZ * 0.75,
  );
}

function firstClearPoint(
  world: VoxelWorld,
  points: readonly Vec3Like[],
  shape: BodyShape,
): Vec3 | undefined {
  for (const point of points) {
    if (cosmeticBodyClear(world, point.x, point.y, point.z, shape)) {
      return new Vec3(point.x, point.y, point.z);
    }
  }
  return undefined;
}

export function findBeeHoverSpot(world: VoxelWorld, owner: Vec3Like): Vec3 | undefined {
  const shoulder = owner.y + BEE_SHOULDER_OFFSET;
  const points: Vec3[] = [];
  const heights = [shoulder, shoulder + 0.55, shoulder - 0.4, owner.y + 0.45, shoulder + 1.15];
  for (const y of heights) {
    for (const [ox, oz] of BEE_IDLE_OFFSETS) {
      points.push(new Vec3(owner.x + ox, y, owner.z + oz));
    }
  }
  return firstClearPoint(world, points, BEE_SHAPE);
}

export function findMiniCreeperSpot(world: VoxelWorld, owner: Vec3Like): Vec3 | undefined {
  const teleported = findSafePetTeleport(world, owner);
  if (teleported && cosmeticBodyClear(world, teleported.x, teleported.y, teleported.z, CREEPER_SHAPE)) {
    return new Vec3(teleported.x, teleported.y, teleported.z);
  }
  return undefined;
}

export function findCosmeticSpawnSpot(
  world: VoxelWorld,
  owner: Vec3Like,
  kind: CosmeticPetKind,
): Vec3 | undefined {
  return kind === 'pet_bee' ? findBeeHoverSpot(world, owner) : findMiniCreeperSpot(world, owner);
}

function placeBee(body: CosmeticFlightBody, spot: Vec3): void {
  body.position.copy(spot);
  body.velocity.set(0, 0, 0);
  body.poseEpoch += 1;
  body.locomotionSpeed = 0;
}

function dampHorizontal(body: CosmeticFlightBody, delta: number): void {
  const damping = Math.exp(-10 * delta);
  body.velocity.x *= damping;
  body.velocity.z *= damping;
  body.velocity.y *= damping;
  if (horizontalSpeed(body) < 0.05) {
    body.velocity.x = 0;
    body.velocity.z = 0;
  }
  body.locomotionSpeed = horizontalSpeed(body);
}

export function stepBeeFlight(
  body: CosmeticFlightBody,
  owner: CosmeticOwnerFocus | undefined,
  world: VoxelWorld,
  delta: number,
): CosmeticStepResult {
  const shape = { width: body.definition.width, height: body.definition.height };
  if (!owner || owner.alive === false) {
    body.cosmeticFollowActive = false;
    dampHorizontal(body, delta);
    integrateBee(body, world, delta, shape);
    return { teleported: false };
  }
  const ownerX = owner.position.x;
  const ownerY = owner.position.y;
  const ownerZ = owner.position.z;
  const movedX = body.cosmeticAnchorX === undefined ? 0 : ownerX - body.cosmeticAnchorX;
  const movedZ = body.cosmeticAnchorZ === undefined ? 0 : ownerZ - body.cosmeticAnchorZ;
  body.cosmeticAnchorX = ownerX;
  body.cosmeticAnchorY = ownerY;
  body.cosmeticAnchorZ = ownerZ;
  const toOwner = Math.hypot(ownerX - body.position.x, ownerY + BEE_SHOULDER_OFFSET - body.position.y, ownerZ - body.position.z);
  if (toOwner > BEE_CATCHUP_DISTANCE) {
    const spot = findBeeHoverSpot(world, owner.position);
    if (spot) {
      placeBee(body, spot);
      return { teleported: true };
    }
  }
  const ownerStep = Math.hypot(movedX, movedZ);
  const preferred = ownerStep > 0.08
    ? beeFollowTarget(owner.position, movedX, movedZ)
    : beeHoverTarget(owner.position, body.ageSeconds, owner.id);
  const goal = resolveBeeGoal(world, preferred, owner.position, shape);
  const toX = goal.x - body.position.x;
  const toY = goal.y - body.position.y;
  const toZ = goal.z - body.position.z;
  const distance = Math.hypot(toX, toY, toZ);
  let maxSpeed = BEE_MAX_SPEED;
  if (distance < 1.15) maxSpeed = 2.5;
  else if (distance < 3.4) maxSpeed = 5.4;
  else if (distance < 7) maxSpeed = 7.6;
  const desired = distance < 0.22 ? 0 : Math.min(maxSpeed, distance * 2.7);
  const scale = distance > 1e-4 ? desired / distance : 0;
  const accel = 24 * delta;
  body.velocity.x = approach(body.velocity.x, toX * scale, accel);
  body.velocity.y = approach(body.velocity.y, toY * scale, accel);
  body.velocity.z = approach(body.velocity.z, toZ * scale, accel);
  body.locomotionSpeed = horizontalSpeed(body);
  const facing = body.locomotionSpeed > 0.35
    ? Math.atan2(body.velocity.x, body.velocity.z) + Math.PI
    : Math.atan2(ownerX - body.position.x, ownerZ - body.position.z) + Math.PI;
  body.facingYaw = approachAngle(body.facingYaw, facing, 6 * delta);
  integrateBee(body, world, delta, shape);
  if (!cosmeticBodyClear(world, body.position.x, body.position.y, body.position.z, shape)) {
    const spot = findBeeHoverSpot(world, owner.position);
    if (spot) {
      placeBee(body, spot);
      return { teleported: true };
    }
  }
  return { teleported: false };
}

function resolveBeeGoal(world: VoxelWorld, preferred: Vec3, owner: Vec3Like, shape: BodyShape): Vec3 {
  if (cosmeticBodyClear(world, preferred.x, preferred.y, preferred.z, shape)) return preferred;
  const nudges: Vec3[] = [];
  for (const y of [preferred.y, preferred.y + 0.6, preferred.y - 0.45, owner.y + 0.5]) {
    nudges.push(new Vec3(preferred.x, y, preferred.z));
    nudges.push(new Vec3(preferred.x + 0.6, y, preferred.z));
    nudges.push(new Vec3(preferred.x - 0.6, y, preferred.z));
    nudges.push(new Vec3(preferred.x, y, preferred.z + 0.6));
    nudges.push(new Vec3(preferred.x, y, preferred.z - 0.6));
  }
  return firstClearPoint(world, nudges, shape) ?? preferred;
}

function integrateBee(body: CosmeticFlightBody, world: VoxelWorld, delta: number, shape: BodyShape): void {
  const substeps = Math.max(1, Math.ceil(delta / 0.05));
  const step = delta / substeps;
  for (let index = 0; index < substeps; index += 1) {
    moveVoxelBody(world, body.position, body.velocity, step, shape, { stepHeight: 0 });
  }
  const clamped = clampHorizontalCenterToWorldBorder(body.position.x, body.position.z, shape.width);
  if (clamped.x !== body.position.x) body.velocity.x = 0;
  if (clamped.z !== body.position.z) body.velocity.z = 0;
  body.position.x = clamped.x;
  body.position.z = clamped.z;
  if (body.position.y < MIN_WORLD_Y + 1) {
    body.position.y = MIN_WORLD_Y + 1;
    body.velocity.y = 0;
  }
  if (body.position.y + shape.height > MAX_WORLD_Y - 1) {
    body.position.y = MAX_WORLD_Y - 1 - shape.height;
    body.velocity.y = 0;
  }
}

export function stepMiniCreeperFollow(
  body: CosmeticFlightBody,
  owner: CosmeticOwnerFocus | undefined,
  world: VoxelWorld,
  delta: number,
): CosmeticStepResult {
  if (!owner || owner.alive === false) {
    body.cosmeticFollowActive = false;
    dampHorizontal(body, delta);
    return { teleported: false };
  }
  const dx = owner.position.x - body.position.x;
  const dz = owner.position.z - body.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance > MINI_CREEPER_CATCHUP_DISTANCE) {
    const spot = findMiniCreeperSpot(world, owner.position);
    if (spot) {
      body.position.copy(spot);
      body.velocity.set(0, 0, 0);
      body.poseEpoch += 1;
      body.locomotionSpeed = 0;
      body.cosmeticFollowActive = false;
      body.facingYaw = Math.atan2(dx, dz) + Math.PI;
      return { teleported: true };
    }
  }
  if (body.cosmeticFollowActive) {
    if (distance <= MINI_CREEPER_STOP_DISTANCE) body.cosmeticFollowActive = false;
  } else if (distance >= MINI_CREEPER_START_DISTANCE) {
    body.cosmeticFollowActive = true;
  }
  if (!body.cosmeticFollowActive) {
    dampHorizontal(body, delta);
    body.facingYaw = approachAngle(
      body.facingYaw,
      Math.atan2(dx, dz) + Math.PI,
      5 * delta,
    );
    return { teleported: false };
  }
  let maxSpeed = 4.4;
  if (distance > 8) maxSpeed = 8;
  else if (distance > 4.5) maxSpeed = 6.4;
  const desired = Math.min(maxSpeed, Math.max(0, distance - MINI_CREEPER_STOP_DISTANCE) * 3.1);
  const scale = distance > 1e-4 ? desired / distance : 0;
  const accel = 28 * delta;
  body.velocity.x = approach(body.velocity.x, dx * scale, accel);
  body.velocity.z = approach(body.velocity.z, dz * scale, accel);
  body.locomotionSpeed = desired;
  body.facingYaw = approachAngle(body.facingYaw, Math.atan2(body.velocity.x, body.velocity.z) + Math.PI, 7 * delta);
  return { teleported: false };
}
