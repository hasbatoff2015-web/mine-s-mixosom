import * as THREE from 'three';
import { BlockId } from '../blocks';
import { FIXED_DT, PLAYER_HEIGHT, PLAYER_WIDTH, WALK_SPEED } from '../core/constants';
import { interpolateVec3 } from '../core/entityInterpolation';
import {
  isMinecartEntityVisual,
  MinecartVisualFactory,
  MINECART_HEIGHT,
  MINECART_LENGTH,
  MINECART_WIDTH,
} from '../rendering/minecartGeometry';
import { applySampledEntityLight, worldDaylightUniform } from '../rendering/worldLighting';
import type { VoxelWorld } from '../world/World';
import { isSpaceClear, moveVoxelBody } from './voxelPhysics';
import {
  entryProgress,
  findRailCell,
  isRailChunkLoaded,
  nextRail,
  progressOnRail,
  railLength,
  sampleRail,
  type RailCell,
} from './railPath';

export const TNT_MINECART_FUSE_TICKS = 80;
export const TNT_MINECART_EXPLOSION_POWER = 4;
export const TNT_MINECART_EXPLOSION_RADIUS = 4;
export const MINECART_MAX_SPEED = WALK_SPEED;
const ACCEL_TIME = 0.5;
const COAST_FRICTION = 0.965;
const SLOPE_GRAVITY = 6.5;
const PUSH_GAIN = 0.28;
const BODY = Object.freeze({ width: MINECART_WIDTH, height: MINECART_HEIGHT });
const CART_AABB = Object.freeze({
  width: MINECART_WIDTH,
  length: MINECART_LENGTH,
  height: MINECART_HEIGHT,
});

export type MinecartVariant = 'normal' | 'tnt';

export interface SerializedMinecart {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly yaw: number;
  readonly variant?: MinecartVariant;
  readonly fuseTicks?: number;
}

export interface MinecartEntity {
  readonly id: string;
  readonly position: THREE.Vector3;
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly visual: THREE.Object3D;
  yaw: number;
  pitch: number;
  rider: boolean;
  variant: MinecartVariant;
  fuseTicks: number;
  alongSpeed: number;
  progress: number;
  rail?: RailCell;
}

export interface MinecartUpdateInput {
  readonly riderId?: string;
  readonly forward?: number;
  readonly strafe?: number;
  readonly riderYaw?: number;
}

export interface MinecartExplosionEvent {
  readonly id: string;
  readonly position: THREE.Vector3;
  readonly power: number;
  readonly radius: number;
}

export interface MinecartPushSource {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly aabb: {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly maxZ: number;
  };
}

export class MinecartManager {
  private readonly carts = new Map<string, MinecartEntity>();
  private readonly visuals = new MinecartVisualFactory();
  private readonly pendingExplosions: MinecartExplosionEvent[] = [];
  private idCounter = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world: VoxelWorld,
    _unusedVisuals?: unknown,
    private readonly maxCarts = 16,
  ) {}

  get entities(): readonly MinecartEntity[] {
    return [...this.carts.values()];
  }

  get count(): number {
    return this.carts.size;
  }

  spawn(x: number, y: number, z: number, id?: string, variant: MinecartVariant = 'normal'): MinecartEntity | undefined {
    if (this.disposed || this.carts.size >= this.maxCarts) return undefined;
    const entityId = id ?? `cart-${this.idCounter += 1}`;
    const visual = this.visuals.create();
    this.visuals.setVariant(visual, variant);
    this.scene.add(visual);
    const entity: MinecartEntity = {
      id: entityId,
      position: new THREE.Vector3(x + 0.5, y, z + 0.5),
      previousPosition: new THREE.Vector3(x + 0.5, y, z + 0.5),
      velocity: new THREE.Vector3(),
      visual,
      yaw: 0,
      pitch: 0,
      rider: false,
      variant,
      fuseTicks: 0,
      alongSpeed: 0,
      progress: 0.5,
    };
    this.snapToRail(entity);
    this.carts.set(entityId, entity);
    this.syncVisual(entity);
    return entity;
  }

  cartAt(x: number, y: number, z: number): MinecartEntity | undefined {
    for (const cart of this.carts.values()) {
      if (Math.abs(cart.position.x - (x + 0.5)) < 0.7
        && Math.abs(cart.position.z - (z + 0.5)) < 0.7
        && Math.abs(cart.position.y - y) < 1.2) {
        return cart;
      }
    }
    return undefined;
  }

  nearest(position: THREE.Vector3, maxDistance = 1.4): MinecartEntity | undefined {
    let best: MinecartEntity | undefined;
    let bestDistance = maxDistance;
    for (const cart of this.carts.values()) {
      const distance = cart.position.distanceTo(position);
      if (distance < bestDistance) {
        best = cart;
        bestDistance = distance;
      }
    }
    return best;
  }

  get(id: string): MinecartEntity | undefined {
    return this.carts.get(id);
  }

  isRideable(cart: MinecartEntity): boolean {
    return cart.variant === 'normal';
  }

  insertTnt(cart: MinecartEntity): boolean {
    if (cart.variant === 'tnt') return false;
    cart.variant = 'tnt';
    this.visuals.setVariant(cart.visual, 'tnt');
    return true;
  }

  primeTnt(cart: MinecartEntity, ticks = TNT_MINECART_FUSE_TICKS): boolean {
    if (cart.variant !== 'tnt') return false;
    if (cart.fuseTicks > 0) return false;
    cart.fuseTicks = Math.max(1, Math.floor(ticks));
    return true;
  }

  explodeNow(cart: MinecartEntity): boolean {
    if (cart.variant !== 'tnt') return false;
    this.detonate(cart);
    return true;
  }

  push(cart: MinecartEntity, direction: THREE.Vector3, strength = 0.18): void {
    const tangent = this.tangentOf(cart);
    const along = (direction.x * tangent.x + direction.z * tangent.z) * strength * 20;
    cart.alongSpeed = THREE.MathUtils.clamp(cart.alongSpeed + along, -MINECART_MAX_SPEED, MINECART_MAX_SPEED);
  }

  tryPushFromPlayer(player: MinecartPushSource, ridingId?: string): void {
    for (const cart of this.carts.values()) {
      if (cart.id === ridingId) continue;
      if (!this.overlapsCart(cart, player.aabb)) continue;
      const tangent = this.tangentOf(cart);
      const along = player.velocity.x * tangent.x + player.velocity.z * tangent.z;
      if (Math.abs(along) <= 0.05) continue;
      cart.alongSpeed += along * PUSH_GAIN;
      const cap = MINECART_MAX_SPEED;
      cart.alongSpeed = THREE.MathUtils.clamp(cart.alongSpeed, -cap, cap);
    }
  }

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): { cart: MinecartEntity; distance: number } | undefined {
    const inv = 1 / Math.max(1e-8, direction.length());
    const dx = direction.x * inv;
    const dy = direction.y * inv;
    const dz = direction.z * inv;
    let best: { cart: MinecartEntity; distance: number } | undefined;
    for (const cart of this.carts.values()) {
      const hit = rayAabb(
        origin.x, origin.y, origin.z, dx, dy, dz, maxDistance,
        cart.position.x - CART_AABB.width * 0.5,
        cart.position.y,
        cart.position.z - CART_AABB.length * 0.5,
        cart.position.x + CART_AABB.width * 0.5,
        cart.position.y + CART_AABB.height,
        cart.position.z + CART_AABB.length * 0.5,
      );
      if (hit === undefined) continue;
      if (!best || hit < best.distance) best = { cart, distance: hit };
    }
    return best;
  }

  findDismountPosition(cart: MinecartEntity): THREE.Vector3 {
    const offsets: Array<readonly [number, number]> = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    const shape = { width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
    for (const [dx, dz] of offsets) {
      const candidate = new THREE.Vector3(cart.position.x + dx, cart.position.y, cart.position.z + dz);
      if (!isSpaceClear(this.world, candidate, shape)) continue;
      const below = this.world.getBlock(
        Math.floor(candidate.x), Math.floor(candidate.y - 0.05), Math.floor(candidate.z), false,
      );
      if (below === BlockId.Rail && !isSpaceClear(this.world, candidate.clone().setY(candidate.y + 0.2), shape)) {
        continue;
      }
      return candidate;
    }
    return new THREE.Vector3(cart.position.x + 0.8, cart.position.y + 0.2, cart.position.z);
  }

  update(deltaSeconds: number, input: MinecartUpdateInput = {}): void {
    if (this.disposed) return;
    const dt = Number.isFinite(deltaSeconds) ? Math.min(deltaSeconds, 0.1) : FIXED_DT;
    for (const cart of [...this.carts.values()]) {
      cart.previousPosition.copy(cart.position);
      if (cart.fuseTicks > 0) {
        cart.fuseTicks -= 1;
        this.visuals.pulsePrimed(cart.visual, 1 - cart.fuseTicks / TNT_MINECART_FUSE_TICKS);
        if (cart.fuseTicks <= 0) {
          this.detonate(cart);
          continue;
        }
      }
      this.stepCart(cart, dt, input);
      this.syncVisual(cart);
    }
  }

  interpolateVisuals(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    for (const cart of this.carts.values()) {
      const visual = interpolateVec3(
        cart.previousPosition.x, cart.previousPosition.y, cart.previousPosition.z,
        cart.position.x, cart.position.y, cart.position.z,
        t,
      );
      cart.visual.position.set(visual.x, visual.y, visual.z);
      cart.visual.rotation.y = cart.yaw;
      cart.visual.rotation.x = cart.pitch;
    }
  }

  consumeExplosions(): MinecartExplosionEvent[] {
    return this.pendingExplosions.splice(0);
  }

  serialize(): SerializedMinecart[] {
    return [...this.carts.values()].map((cart) => ({
      id: cart.id,
      position: [cart.position.x, cart.position.y, cart.position.z],
      velocity: [cart.velocity.x, cart.velocity.y, cart.velocity.z],
      yaw: cart.yaw,
      variant: cart.variant,
      fuseTicks: cart.fuseTicks,
    }));
  }

  restore(serialized: readonly SerializedMinecart[]): void {
    this.clear();
    for (const entry of serialized) {
      const variant = entry.variant === 'tnt' ? 'tnt' : 'normal';
      const cart = this.spawn(entry.position[0] - 0.5, entry.position[1], entry.position[2] - 0.5, entry.id, variant);
      if (!cart) continue;
      cart.position.set(entry.position[0], entry.position[1], entry.position[2]);
      cart.previousPosition.copy(cart.position);
      cart.velocity.set(entry.velocity[0], entry.velocity[1], entry.velocity[2]);
      cart.yaw = entry.yaw;
      cart.fuseTicks = Math.max(0, Math.floor(entry.fuseTicks ?? 0));
      this.snapToRail(cart);
      const tangent = this.tangentOf(cart);
      cart.alongSpeed = cart.velocity.x * tangent.x + cart.velocity.z * tangent.z;
      this.syncVisual(cart);
    }
  }

  clear(): void {
    for (const cart of this.carts.values()) this.scene.remove(cart.visual);
    this.carts.clear();
  }

  dispose(): void {
    this.clear();
    this.visuals.dispose();
    this.disposed = true;
  }

  private stepCart(cart: MinecartEntity, dt: number, input: MinecartUpdateInput): void {
    this.ensureRail(cart);
    if (!cart.rail) {
      cart.velocity.y -= 32 * dt;
      const moved = moveVoxelBody(this.world, cart.position, cart.velocity, dt, BODY);
      if (moved.hitY && cart.velocity.y <= 0) cart.velocity.y = 0;
      cart.alongSpeed = 0;
      return;
    }
    const sample = sampleRail(cart.rail, cart.progress);
    const ridden = input.riderId === cart.id && cart.variant === 'normal';
    const forward = ridden ? (input.forward ?? 0) : 0;
    // A/D (`strafe`) is reserved for future junctions and must not slide the cart off the rail.
    void input.strafe;
    const accel = MINECART_MAX_SPEED / ACCEL_TIME;
    if (Math.abs(forward) > 0.05) {
      const yaw = input.riderYaw ?? cart.yaw;
      const wishX = -Math.sin(yaw) * forward;
      const wishZ = -Math.cos(yaw) * forward;
      const along = wishX * sample.tangentX + wishZ * sample.tangentZ;
      cart.alongSpeed += along * accel * dt;
    } else {
      cart.alongSpeed *= COAST_FRICTION;
    }
    if (sample.tangentY !== 0) {
      cart.alongSpeed += -sample.tangentY * SLOPE_GRAVITY * dt;
    }
    cart.alongSpeed = THREE.MathUtils.clamp(cart.alongSpeed, -MINECART_MAX_SPEED, MINECART_MAX_SPEED);
    if (Math.abs(cart.alongSpeed) < 0.02 && Math.abs(forward) <= 0.05) cart.alongSpeed = 0;

    let remaining = cart.alongSpeed * dt;
    let guard = 0;
    while (Math.abs(remaining) > 1e-5 && cart.rail && guard < 4) {
      guard += 1;
      const length = railLength(cart.rail.shape);
      const nextT = cart.progress + remaining / length;
      if (nextT >= 0 && nextT <= 1) {
        cart.progress = nextT;
        remaining = 0;
        break;
      }
      const tEnd: 0 | 1 = nextT > 1 ? 1 : 0;
      const leftover = nextT > 1 ? (nextT - 1) * length : nextT * length;
      const neighbor = nextRail(this.world, cart.rail, tEnd);
      if (!neighbor) {
        cart.progress = tEnd;
        cart.alongSpeed = 0;
        remaining = 0;
        break;
      }
      if (!isRailChunkLoaded(this.world, neighbor.x, neighbor.z)) {
        cart.progress = tEnd;
        cart.alongSpeed = 0;
        remaining = 0;
        break;
      }
      const enterT = entryProgress(
        neighbor.shape,
        cart.rail.x - neighbor.x,
        cart.rail.y - neighbor.y,
        cart.rail.z - neighbor.z,
      );
      const oldSample = sampleRail(cart.rail, tEnd);
      cart.rail = neighbor;
      cart.progress = enterT;
      const entered = sampleRail(neighbor, enterT);
      const aligned = oldSample.tangentX * entered.tangentX + oldSample.tangentZ * entered.tangentZ;
      if (aligned < 0) cart.alongSpeed *= -1;
      remaining = Math.sign(cart.alongSpeed) * Math.abs(leftover);
    }

    const pose = sampleRail(cart.rail, cart.progress);
    cart.position.set(pose.x, pose.y, pose.z);
    cart.velocity.set(pose.tangentX * cart.alongSpeed, pose.tangentY * cart.alongSpeed, pose.tangentZ * cart.alongSpeed);
    if (Math.abs(cart.alongSpeed) > 0.02) {
      cart.yaw = pose.yaw;
      cart.pitch = pose.pitch;
    } else {
      cart.yaw = pose.yaw;
      cart.pitch = pose.pitch;
    }
  }

  private ensureRail(cart: MinecartEntity): void {
    if (cart.rail && this.world.getBlock(cart.rail.x, cart.rail.y, cart.rail.z, false) === BlockId.Rail) {
      return;
    }
    this.snapToRail(cart);
  }

  private snapToRail(cart: MinecartEntity): void {
    const cell = findRailCell(this.world, cart.position.x, cart.position.y, cart.position.z);
    if (!cell) {
      cart.rail = undefined;
      return;
    }
    cart.rail = cell;
    cart.progress = progressOnRail(cell.shape, cart.position.x - cell.x, cart.position.z - cell.z);
    const pose = sampleRail(cell, cart.progress);
    cart.position.set(pose.x, pose.y, pose.z);
    cart.yaw = pose.yaw;
    cart.pitch = pose.pitch;
  }

  private tangentOf(cart: MinecartEntity): { x: number; z: number } {
    if (!cart.rail) return { x: Math.sin(cart.yaw), z: Math.cos(cart.yaw) };
    const sample = sampleRail(cart.rail, cart.progress);
    return { x: sample.tangentX, z: sample.tangentZ };
  }

  private overlapsCart(cart: MinecartEntity, box: MinecartPushSource['aabb']): boolean {
    const minX = cart.position.x - CART_AABB.width * 0.5;
    const maxX = cart.position.x + CART_AABB.width * 0.5;
    const minY = cart.position.y;
    const maxY = cart.position.y + CART_AABB.height;
    const minZ = cart.position.z - CART_AABB.length * 0.5;
    const maxZ = cart.position.z + CART_AABB.length * 0.5;
    return box.maxX > minX && box.minX < maxX
      && box.maxY > minY && box.minY < maxY
      && box.maxZ > minZ && box.minZ < maxZ;
  }

  private detonate(cart: MinecartEntity): void {
    this.pendingExplosions.push({
      id: cart.id,
      position: cart.position.clone(),
      power: TNT_MINECART_EXPLOSION_POWER,
      radius: TNT_MINECART_EXPLOSION_RADIUS,
    });
    this.scene.remove(cart.visual);
    this.carts.delete(cart.id);
  }

  private syncVisual(cart: MinecartEntity): void {
    cart.visual.position.set(cart.position.x, cart.position.y, cart.position.z);
    cart.visual.rotation.set(cart.pitch, cart.yaw, 0);
    this.visuals.setVariant(cart.visual, cart.variant);
    applySampledEntityLight(
      cart.visual, this.world, cart.position.x, cart.position.y + 0.3, cart.position.z, 0.3,
      worldDaylightUniform.value,
    );
  }
}

export { isMinecartEntityVisual };

function rayAabb(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number | undefined {
  const t1x = (minX - ox) / (dx || 1e-12);
  const t2x = (maxX - ox) / (dx || 1e-12);
  const t1y = (minY - oy) / (dy || 1e-12);
  const t2y = (maxY - oy) / (dy || 1e-12);
  const t1z = (minZ - oz) / (dz || 1e-12);
  const t2z = (maxZ - oz) / (dz || 1e-12);
  const tmin = Math.max(Math.min(t1x, t2x), Math.min(t1y, t2y), Math.min(t1z, t2z));
  const tmax = Math.min(Math.max(t1x, t2x), Math.max(t1y, t2y), Math.max(t1z, t2z));
  if (tmax < 0 || tmin > tmax || tmin > maxDistance) return undefined;
  return Math.max(0, tmin);
}
