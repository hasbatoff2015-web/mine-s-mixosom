import * as THREE from 'three';
import { BlockId } from '../blocks';
import { applyKnockback, applyMeleeDrag } from '../combat';
import { blockCollisionBoxes, movementMultiplier, type CollisionBox } from '../world/collision';
import {
  CREATIVE_FLY_SPEED,
  CREATIVE_SPRINT_FLY_SPEED,
  CREATIVE_VERTICAL_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_SNEAK_EYE_HEIGHT,
  PLAYER_SNEAK_HEIGHT,
  PLAYER_WIDTH,
  SNEAK_SPEED,
  SPRINT_SPEED,
  TERMINAL_VELOCITY,
  WALK_SPEED,
  WATER_GRAVITY,
  WATER_SPEED,
  clamp,
} from '../core/constants';
import type { MoveInput } from '../input/InputManager';
import type { VoxelWorld } from '../world/World';
import {
  nextFlyWindowTicks,
  shouldAcceptFlyToggle,
} from './creativeFlight';
import {
  desiredHorizontalWish,
  findLadderContact,
  isClimbIntent,
  ladderVerticalVelocity,
} from './ladderMotion';

const COLLISION_EPSILON = 1e-7;
const GROUND_PROBE = 0.075;
const STEP_HEIGHT = 0.6;
const SNEAK_TRIM_INCREMENT = 0.05;

export interface PlayerInputSource {
  readonly yaw: number;
  readonly pitch: number;
  movement(): MoveInput;
  /** When false, look/fluids still update but the body does not walk or fall. */
  readonly locomotion?: boolean;
}

export interface PlayerAABB {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export type PlayerDamageCause = 'fall';
export type PlayerDamageHandler = (amount: number, cause: PlayerDamageCause) => void;

export interface PlayerControllerOptions {
  readonly position?: THREE.Vector3 | readonly [number, number, number] | Readonly<{ x: number; y: number; z: number }>;
  readonly yaw?: number;
  readonly pitch?: number;
}

export interface SerializedPlayerController {
  readonly position: [number, number, number];
  readonly velocity: [number, number, number];
  readonly yaw: number;
  readonly pitch: number;
}

export interface PlayerTickResult {
  readonly movedDistance: number;
  readonly horizontalDistance: number;
  readonly jumped: boolean;
  readonly landed: boolean;
  readonly fallDistance: number;
  readonly fallDamage: number;
  readonly inWater: boolean;
  readonly inLava: boolean;
  readonly inFire: boolean;
  readonly headSubmerged: boolean;
  readonly onLadder: boolean;
}

interface MoveResult {
  readonly actual: number;
  readonly collided: boolean;
}

function vectorFrom(
  value: PlayerControllerOptions['position'],
  fallback = new THREE.Vector3(0.5, 64, 0.5),
): THREE.Vector3 {
  if (value === undefined) return fallback.clone();
  if ('x' in value) return new THREE.Vector3(value.x, value.y, value.z);
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function reduceTowardsZero(value: number, amount: number): number {
  if (Math.abs(value) <= amount) return 0;
  return value - Math.sign(value) * amount;
}

/**
 * Fixed-step, voxel AABB controller. `position` is the centre of the player's
 * feet (not the eye or the centre of the hitbox), and velocities are blocks/s.
 */
export class PlayerController {
  readonly position: THREE.Vector3;
  readonly previousPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  sneaking = false;
  sprinting = false;
  private meleeKnockback = false;
  inWater = false;
  inLava = false;
  inFire = false;
  inCobweb = false;
  private webMultiplier = 1;
  headSubmerged = false;
  onLadder = false;
  isFlying = false;
  creativeFlightAllowed = false;
  fallDistance = 0;
  lastFallDistance = 0;
  lastFallDamage = 0;
  private jumpHeld = false;
  private flyWindowTicks = 0;
  private flyIgnoreGroundTicks = 0;

  constructor(options: PlayerControllerOptions | PlayerControllerOptions['position'] = {}) {
    const normalized: PlayerControllerOptions = options instanceof THREE.Vector3 || Array.isArray(options)
      || ('x' in options && 'y' in options && 'z' in options && !('position' in options))
      ? { position: options as Exclude<PlayerControllerOptions['position'], undefined> }
      : options as PlayerControllerOptions;
    this.position = vectorFrom(normalized.position);
    this.previousPosition.copy(this.position);
    this.yaw = finite(normalized.yaw ?? 0, 0);
    this.pitch = clamp(finite(normalized.pitch ?? 0, 0), -Math.PI / 2, Math.PI / 2);
  }

  get width(): number {
    return PLAYER_WIDTH;
  }

  get height(): number {
    return this.sneaking ? PLAYER_SNEAK_HEIGHT : PLAYER_HEIGHT;
  }

  get eyeHeight(): number {
    return this.sneaking ? PLAYER_SNEAK_EYE_HEIGHT : PLAYER_EYE_HEIGHT;
  }

  get aabb(): PlayerAABB {
    return this.aabbAt(this.position, this.height);
  }

  eyePosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  viewDirection(target = new THREE.Vector3()): THREE.Vector3 {
    const horizontal = Math.cos(this.pitch);
    return target.set(
      -Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * horizontal,
    ).normalize();
  }

  /** True when the given world-space boxes overlap the player AABB. */
  intersectsCollisionBoxes(boxes: readonly CollisionBox[]): boolean {
    const box = this.aabb;
    return boxes.some((collision) => this.boxesOverlap(box, collision));
  }

  /** True when a full unit block at the supplied cell would overlap the player. */
  intersectsBlock(x: number, y: number, z: number): boolean {
    return this.intersectsCollisionBoxes([{ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 }]);
  }

  intersectsBlockType(world: VoxelWorld, block: BlockId, padding = 0): boolean {
    const box = this.aabb;
    const minX = Math.floor(box.minX - padding);
    const maxX = Math.floor(box.maxX + padding - COLLISION_EPSILON);
    const minY = Math.floor(box.minY - padding);
    const maxY = Math.floor(box.maxY + padding - COLLISION_EPSILON);
    const minZ = Math.floor(box.minZ - padding);
    const maxZ = Math.floor(box.maxZ + padding - COLLISION_EPSILON);
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (world.getBlock(x, y, z) === block) return true;
        }
      }
    }
    return false;
  }

  teleport(position: THREE.Vector3 | readonly [number, number, number] | Readonly<{ x: number; y: number; z: number }>): void {
    this.meleeKnockback = false;
    this.position.copy(vectorFrom(position));
    this.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.sprinting = false;
    this.onGround = false;
    this.onLadder = false;
    this.fallDistance = 0;
    this.lastFallDistance = 0;
    this.lastFallDamage = 0;
    this.isFlying = false;
    this.jumpHeld = false;
    this.flyWindowTicks = 0;
  }

  respawn(position: THREE.Vector3 | readonly [number, number, number] | Readonly<{ x: number; y: number; z: number }>): void {
    this.teleport(position);
  }

  receiveMeleeKnockback(away: Readonly<{ x: number; z: number }>): void {
    applyKnockback(this.velocity, away);
    this.meleeKnockback = true;
  }

  tick(
    world: VoxelWorld,
    input: PlayerInputSource,
    dt: number,
    onDamage?: PlayerDamageHandler,
  ): PlayerTickResult {
    if (!Number.isFinite(dt) || dt <= 0) return this.tickResult(false, 0, 0, 0, false);
    // A generous cap keeps a paused tab from tunnelling through the terrain. The
    // main loop normally calls this with exactly 0.05 s.
    const stepDt = Math.min(dt, 0.1);
    this.previousPosition.copy(this.position);
    this.yaw = finite(input.yaw, this.yaw);
    this.pitch = clamp(finite(input.pitch, this.pitch), -Math.PI / 2, Math.PI / 2);

    const movement = input.movement();
    const jumpPressed = movement.jump && !this.jumpHeld;
    this.jumpHeld = movement.jump;
    if (!this.creativeFlightAllowed) {
      this.isFlying = false;
      this.flyWindowTicks = 0;
    } else {
      const flyAction = shouldAcceptFlyToggle(true, jumpPressed, this.flyWindowTicks);
      if (flyAction === 'toggle') {
        this.isFlying = !this.isFlying;
        if (this.isFlying) {
          this.velocity.y = 0;
          this.flyIgnoreGroundTicks = 2;
        }
      }
      this.flyWindowTicks = nextFlyWindowTicks(flyAction, this.flyWindowTicks);
    }

    const wasOnGround = this.onGround || this.hasGroundSupport(world, this.position);
    this.updateFluidState(world);
    if (this.isFlying || this.inWater || this.inLava || this.onLadder || input.locomotion === false) {
      this.meleeKnockback = false;
    }
    if (input.locomotion === false) {
      this.velocity.set(0, 0, 0);
      this.sprinting = false;
      this.onGround = true;
      this.fallDistance = 0;
      this.updateStance(world, movement.sneak);
      return this.tickResult(false, 0, 0, 0, false);
    }
    if (this.isFlying) this.sneaking = false;
    else this.updateStance(world, movement.sneak);
    this.sprinting = this.isFlying
      ? Boolean(movement.flySprint) && (Math.abs(movement.forward) > 0.05 || Math.abs(movement.right) > 0.05)
      : movement.sprint && movement.forward > 0.05
        && !this.sneaking && !this.inWater && !this.inLava;
    const jumped = !this.isFlying && !this.meleeKnockback && movement.jump && wasOnGround && !this.inWater && !this.inLava;

    if (this.isFlying) this.updateFlyVelocity(movement, stepDt);
    else this.updateHorizontalVelocity(movement, stepDt, wasOnGround);
    if (this.isFlying) {
      /* Flight owns vertical velocity. */
    } else if (this.inWater || this.inLava) this.updateFluidVerticalVelocity(movement, stepDt);
    else if (movement.jump && wasOnGround && !this.meleeKnockback) this.velocity.y = JUMP_VELOCITY;

    const wish = desiredHorizontalWish(this.yaw, movement.forward, movement.right);
    const ladderAtStart = this.isFlying ? undefined : findLadderContact(world, this.aabb);
    let climbIntent = false;
    if (ladderAtStart && !this.inWater && !this.inLava) {
      this.sprinting = false;
      climbIntent = isClimbIntent(wish.x, wish.z, ladderAtStart.towardX, ladderAtStart.towardZ);
      this.velocity.y = ladderVerticalVelocity({
        climbIntent,
        sneak: this.sneaking,
        keepJump: jumped,
        currentY: this.velocity.y,
      });
    }

    let dx = this.velocity.x * stepDt;
    let dy = this.velocity.y * stepDt;
    let dz = this.velocity.z * stepDt;
    if (this.sneaking && wasOnGround) [dx, dz] = this.trimSneakMovement(world, dx, dz);

    const vertical = this.moveAxis(world, 'y', dy);
    const afterVertical = this.position.clone();
    const xMove = this.moveAxis(world, 'x', dx);
    const zMove = this.moveAxis(world, 'z', dz);
    let actualX = xMove.actual;
    let actualZ = zMove.actual;
    let collidedX = xMove.collided;
    let collidedZ = zMove.collided;

    if ((collidedX || collidedZ) && (wasOnGround || ladderAtStart !== undefined) && !this.sneaking) {
      const baseline = this.position.clone();
      const baselineDistanceSq = actualX * actualX + actualZ * actualZ;
      this.position.copy(afterVertical);
      const up = this.moveAxis(world, 'y', STEP_HEIGHT);
      const stepX = this.moveAxis(world, 'x', dx);
      const stepZ = this.moveAxis(world, 'z', dz);
      this.moveAxis(world, 'y', -(up.actual + GROUND_PROBE));
      const steppedDistanceSq = stepX.actual * stepX.actual + stepZ.actual * stepZ.actual;
      if (up.actual > COLLISION_EPSILON && steppedDistanceSq > baselineDistanceSq + COLLISION_EPSILON) {
        actualX = stepX.actual;
        actualZ = stepZ.actual;
        collidedX = stepX.collided;
        collidedZ = stepZ.collided;
      } else {
        this.position.copy(baseline);
      }
    }

    const landed = dy < 0 && vertical.collided;
    const actualDrop = Math.max(0, this.previousPosition.y - this.position.y);
    this.updateFluidState(world);
    const supported = this.hasGroundSupport(world, this.position);
    this.onLadder = !this.isFlying && !this.inWater && !this.inLava && findLadderContact(world, this.aabb) !== undefined;
    this.onGround = !this.inWater && !this.inLava && (landed || (this.velocity.y <= 0 && supported));
    if (this.flyIgnoreGroundTicks > 0) this.flyIgnoreGroundTicks -= 1;
    if (this.isFlying && landed && this.flyIgnoreGroundTicks <= 0) this.isFlying = false;

    if (collidedX) this.velocity.x = 0;
    if (collidedZ) this.velocity.z = 0;
    if (vertical.collided) this.velocity.y = 0;

    let fallDamage = 0;
    if (!this.isFlying) {
      if (this.inWater || this.inLava || this.onLadder) {
        this.fallDistance = 0;
      } else if (!this.onGround) {
        if (actualDrop > 0) this.fallDistance += actualDrop;
      } else if (landed) {
        this.lastFallDistance = this.fallDistance + actualDrop;
        fallDamage = Math.max(0, Math.ceil(this.lastFallDistance - 3));
        this.lastFallDamage = fallDamage;
        this.fallDistance = 0;
        if (fallDamage > 0) onDamage?.(fallDamage, 'fall');
      }
    } else {
      this.fallDistance = 0;
    }

    if (this.isFlying) {
      /* No gravity while flying. */
    } else if (!this.inWater && !this.inLava && !this.onLadder) {
      if (this.onGround && this.velocity.y <= 0) this.velocity.y = 0;
      else this.velocity.y = Math.max(-TERMINAL_VELOCITY, (this.velocity.y - GRAVITY * stepDt) * Math.pow(0.98, stepDt / 0.05));
    }

    // Avoid keeping tiny floating point momentum forever.
    if (this.meleeKnockback) {
      applyMeleeDrag(this.velocity, wasOnGround, stepDt);
      if (this.onGround && this.velocity.y <= 0) this.meleeKnockback = false;
    }
    if (Math.abs(this.velocity.x) < 1e-5) this.velocity.x = 0;
    if (Math.abs(this.velocity.z) < 1e-5) this.velocity.z = 0;
    const movedX = this.position.x - this.previousPosition.x;
    const movedY = this.position.y - this.previousPosition.y;
    const movedZ = this.position.z - this.previousPosition.z;
    return this.tickResult(
      landed,
      fallDamage,
      Math.hypot(movedX, movedY, movedZ),
      Math.hypot(movedX, movedZ),
      jumped,
    );
  }

  serialize(): SerializedPlayerController {
    return {
      position: this.position.toArray() as [number, number, number],
      velocity: this.velocity.toArray() as [number, number, number],
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  restore(state: Partial<SerializedPlayerController>): void {
    this.meleeKnockback = false;
    this.sprinting = false;
    if (state.position && state.position.length === 3 && state.position.every(Number.isFinite)) {
      this.position.fromArray(state.position);
      this.previousPosition.copy(this.position);
    }
    if (state.velocity && state.velocity.length === 3 && state.velocity.every(Number.isFinite)) {
      this.velocity.fromArray(state.velocity);
    } else this.velocity.set(0, 0, 0);
    if (state.yaw !== undefined) this.yaw = finite(state.yaw, this.yaw);
    if (state.pitch !== undefined) this.pitch = clamp(finite(state.pitch, this.pitch), -Math.PI / 2, Math.PI / 2);
    this.onGround = false;
    this.onLadder = false;
    this.isFlying = false;
    this.jumpHeld = false;
    this.flyWindowTicks = 0;
    this.flyIgnoreGroundTicks = 0;
    this.fallDistance = 0;
  }

  static deserialize(state: SerializedPlayerController): PlayerController {
    const player = new PlayerController({ position: state.position, yaw: state.yaw, pitch: state.pitch });
    player.restore(state);
    return player;
  }

  private tickResult(
    landed: boolean,
    fallDamage: number,
    movedDistance: number,
    horizontalDistance = 0,
    jumped = false,
  ): PlayerTickResult {
    return {
      movedDistance,
      horizontalDistance,
      jumped,
      landed,
      fallDistance: this.fallDistance,
      fallDamage,
      inWater: this.inWater,
      inLava: this.inLava,
      inFire: this.inFire,
      headSubmerged: this.headSubmerged,
      onLadder: this.onLadder,
    };
  }

  private updateFlyVelocity(movement: MoveInput, dt: number): void {
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    let wishX = forwardX * movement.forward + rightX * movement.right;
    let wishZ = forwardZ * movement.forward + rightZ * movement.right;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 1) {
      wishX /= wishLength;
      wishZ /= wishLength;
    }
    const speed = movement.flySprint ? CREATIVE_SPRINT_FLY_SPEED : CREATIVE_FLY_SPEED;
    const desiredX = wishX * speed;
    const desiredZ = wishZ * speed;
    const blend = 1 - Math.exp(-10 * dt);
    this.velocity.x += (desiredX - this.velocity.x) * blend;
    this.velocity.z += (desiredZ - this.velocity.z) * blend;
    let desiredY = 0;
    if (movement.jump) desiredY += CREATIVE_VERTICAL_SPEED;
    if (movement.descend) desiredY -= CREATIVE_VERTICAL_SPEED;
    this.velocity.y += (desiredY - this.velocity.y) * blend;
  }

  private updateStance(world: VoxelWorld, wantsSneak: boolean): void {
    if (wantsSneak) {
      this.sneaking = true;
      return;
    }
    this.sneaking = this.collidesAt(world, this.position, PLAYER_HEIGHT);
  }

  private updateHorizontalVelocity(movement: MoveInput, dt: number, wasOnGround: boolean): void {
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    let wishX = forwardX * movement.forward + rightX * movement.right;
    let wishZ = forwardZ * movement.forward + rightZ * movement.right;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 1) {
      wishX /= wishLength;
      wishZ /= wishLength;
    }
    const speed = (this.inWater || this.inLava
      ? WATER_SPEED * (this.inLava ? 0.55 : 1)
      : this.sneaking ? SNEAK_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED)
      * this.webMultiplier;
    if (this.meleeKnockback) {
      // Keep the external impulse; input adds acceleration instead of replacing it.
      const acceleration = (wasOnGround ? 2 : 0.4) * (this.sprinting ? 1.3 : 1) * dt / 0.05;
      this.velocity.x += wishX * acceleration * this.webMultiplier;
      this.velocity.z += wishZ * acceleration * this.webMultiplier;
      return;
    }
    const desiredX = wishX * speed;
    const desiredZ = wishZ * speed;
    const response = this.inWater || this.inLava ? 7 : wasOnGround ? 22 : 3.5;
    const blend = 1 - Math.exp(-response * dt);
    this.velocity.x += (desiredX - this.velocity.x) * blend;
    this.velocity.z += (desiredZ - this.velocity.z) * blend;
    if (wishLength < 1e-4 && wasOnGround && !this.inWater && !this.inLava) {
      const braking = Math.exp(-18 * dt);
      this.velocity.x *= braking;
      this.velocity.z *= braking;
    }
  }

  private updateFluidVerticalVelocity(movement: MoveInput, dt: number): void {
    const gravity = this.inLava ? WATER_GRAVITY * 0.45 : WATER_GRAVITY;
    this.velocity.y -= gravity * dt;
    if (movement.jump) this.velocity.y += (this.inLava ? 6 : 10) * dt;
    if (movement.sneak) this.velocity.y -= (this.inLava ? 4 : 7) * dt;
    const drag = Math.pow(this.inLava ? 0.5 : 0.8, dt / 0.05);
    this.velocity.y = clamp(this.velocity.y * drag, -4, 3.5);
    this.velocity.x *= Math.pow(this.inLava ? 0.5 : 0.8, dt / 0.05);
    this.velocity.z *= Math.pow(this.inLava ? 0.5 : 0.8, dt / 0.05);
  }

  private updateFluidState(world: VoxelWorld): void {
    this.inWater = this.overlapsBlock(world, BlockId.Water);
    this.inLava = this.overlapsBlock(world, BlockId.Lava);
    this.inFire = this.overlapsBlock(world, BlockId.Fire);
    const box = this.aabb;
    this.webMultiplier = movementMultiplier(world, box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ);
    this.inCobweb = this.webMultiplier < 1;
    const eye = this.eyePosition();
    const eyeBlock = world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    this.headSubmerged = eyeBlock === BlockId.Water || eyeBlock === BlockId.Lava;
  }

  private overlapsBlock(world: VoxelWorld, block: BlockId): boolean {
    const box = this.aabb;
    for (let y = Math.floor(box.minY + COLLISION_EPSILON); y <= Math.floor(box.maxY - COLLISION_EPSILON); y += 1) {
      for (let z = Math.floor(box.minZ + COLLISION_EPSILON); z <= Math.floor(box.maxZ - COLLISION_EPSILON); z += 1) {
        for (let x = Math.floor(box.minX + COLLISION_EPSILON); x <= Math.floor(box.maxX - COLLISION_EPSILON); x += 1) {
          if (world.getBlock(x, y, z) === block) return true;
        }
      }
    }
    return false;
  }

  private trimSneakMovement(world: VoxelWorld, initialX: number, initialZ: number): [number, number] {
    let dx = initialX;
    let dz = initialZ;
    while (Math.abs(dx) > COLLISION_EPSILON && !this.hasGroundSupport(world, this.position, dx, 0)) {
      dx = reduceTowardsZero(dx, SNEAK_TRIM_INCREMENT);
    }
    while (Math.abs(dz) > COLLISION_EPSILON && !this.hasGroundSupport(world, this.position, 0, dz)) {
      dz = reduceTowardsZero(dz, SNEAK_TRIM_INCREMENT);
    }
    while ((Math.abs(dx) > COLLISION_EPSILON || Math.abs(dz) > COLLISION_EPSILON)
      && !this.hasGroundSupport(world, this.position, dx, dz)) {
      dx = reduceTowardsZero(dx, SNEAK_TRIM_INCREMENT);
      dz = reduceTowardsZero(dz, SNEAK_TRIM_INCREMENT);
    }
    return [dx, dz];
  }

  private hasGroundSupport(world: VoxelWorld, position: THREE.Vector3, offsetX = 0, offsetZ = 0): boolean {
    const probe = position.clone();
    probe.x += offsetX;
    probe.y -= GROUND_PROBE;
    probe.z += offsetZ;
    return this.collidesAt(world, probe, this.height);
  }

  private collidesAt(world: VoxelWorld, position: THREE.Vector3, height: number): boolean {
    const box = this.aabbAt(position, height);
    for (let y = Math.floor(box.minY + COLLISION_EPSILON); y <= Math.floor(box.maxY - COLLISION_EPSILON); y += 1) {
      for (let z = Math.floor(box.minZ + COLLISION_EPSILON); z <= Math.floor(box.maxZ - COLLISION_EPSILON); z += 1) {
        for (let x = Math.floor(box.minX + COLLISION_EPSILON); x <= Math.floor(box.maxX - COLLISION_EPSILON); x += 1) {
          const collisions = this.blockCollisionBoxes(world, x, y, z);
          for (const collision of collisions) {
            if (this.boxesOverlap(box, collision)) return true;
          }
        }
      }
    }
    return false;
  }

  private moveAxis(world: VoxelWorld, axis: 'x' | 'y' | 'z', requested: number): MoveResult {
    if (Math.abs(requested) <= COLLISION_EPSILON) return { actual: 0, collided: false };
    const player = this.aabb;
    const minX = Math.floor(Math.min(player.minX, player.minX + (axis === 'x' ? requested : 0)) + COLLISION_EPSILON);
    const maxX = Math.floor(Math.max(player.maxX, player.maxX + (axis === 'x' ? requested : 0)) - COLLISION_EPSILON);
    const minY = Math.floor(Math.min(player.minY, player.minY + (axis === 'y' ? requested : 0)) + COLLISION_EPSILON);
    const maxY = Math.floor(Math.max(player.maxY, player.maxY + (axis === 'y' ? requested : 0)) - COLLISION_EPSILON);
    const minZ = Math.floor(Math.min(player.minZ, player.minZ + (axis === 'z' ? requested : 0)) + COLLISION_EPSILON);
    const maxZ = Math.floor(Math.max(player.maxZ, player.maxZ + (axis === 'z' ? requested : 0)) - COLLISION_EPSILON);
    let allowed = requested;

    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const collisions = this.blockCollisionBoxes(world, x, y, z);
          for (const block of collisions) {
            if (!this.overlapsOtherAxes(player, block, axis)) continue;
            if (requested > 0) {
              const playerMax = axis === 'x' ? player.maxX : axis === 'y' ? player.maxY : player.maxZ;
              const blockMin = axis === 'x' ? block.minX : axis === 'y' ? block.minY : block.minZ;
              if (playerMax <= blockMin + COLLISION_EPSILON && playerMax + allowed > blockMin) {
                allowed = Math.min(allowed, blockMin - playerMax);
              }
            } else {
              const playerMin = axis === 'x' ? player.minX : axis === 'y' ? player.minY : player.minZ;
              const blockMax = axis === 'x' ? block.maxX : axis === 'y' ? block.maxY : block.maxZ;
              if (playerMin >= blockMax - COLLISION_EPSILON && playerMin + allowed < blockMax) {
                allowed = Math.max(allowed, blockMax - playerMin);
              }
            }
          }
        }
      }
    }

    this.position[axis] += allowed;
    return { actual: allowed, collided: Math.abs(allowed - requested) > COLLISION_EPSILON };
  }

  private blockCollisionBoxes(world: VoxelWorld, x: number, y: number, z: number): CollisionBox[] {
    return blockCollisionBoxes(world, x, y, z);
  }

  private overlapsOtherAxes(player: PlayerAABB, block: CollisionBox, movementAxis: 'x' | 'y' | 'z'): boolean {
    const x = movementAxis === 'x' || (player.maxX > block.minX + COLLISION_EPSILON && player.minX < block.maxX - COLLISION_EPSILON);
    const y = movementAxis === 'y' || (player.maxY > block.minY + COLLISION_EPSILON && player.minY < block.maxY - COLLISION_EPSILON);
    const z = movementAxis === 'z' || (player.maxZ > block.minZ + COLLISION_EPSILON && player.minZ < block.maxZ - COLLISION_EPSILON);
    return x && y && z;
  }

  private boxesOverlap(a: PlayerAABB, b: CollisionBox): boolean {
    return a.maxX > b.minX + COLLISION_EPSILON && a.minX < b.maxX - COLLISION_EPSILON
      && a.maxY > b.minY + COLLISION_EPSILON && a.minY < b.maxY - COLLISION_EPSILON
      && a.maxZ > b.minZ + COLLISION_EPSILON && a.minZ < b.maxZ - COLLISION_EPSILON;
  }

  private aabbAt(position: THREE.Vector3, height: number): PlayerAABB {
    const halfWidth = PLAYER_WIDTH / 2;
    return {
      minX: position.x - halfWidth,
      minY: position.y,
      minZ: position.z - halfWidth,
      maxX: position.x + halfWidth,
      maxY: position.y + height,
      maxZ: position.z + halfWidth,
    };
  }
}
