import * as THREE from 'three';
import { BlockId } from '../blocks';
import { CHUNK_SIZE, FIXED_DT, floorDiv } from '../core/constants';
import { interpolateVec3 } from '../core/entityInterpolation';
import type { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { applySampledEntityLight, worldDaylightUniform } from '../rendering/worldLighting';
import type { RailShape } from '../blocks';
import { defaultRailShape, resolveRailShape } from '../rendering/specialBlockGeometry';
import type { VoxelWorld } from '../world/World';
import { moveVoxelBody } from './voxelPhysics';

export interface SerializedMinecart {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly yaw: number;
}

export interface MinecartEntity {
  readonly id: string;
  readonly position: THREE.Vector3;
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly visual: THREE.Object3D;
  yaw: number;
  rider: boolean;
}

const BODY = Object.freeze({ width: 0.98, height: 0.7 });
const MAX_SPEED = 0.4;
const FRICTION = 0.96;
const SLOPE_ACCEL = 0.04;

function railAt(world: VoxelWorld, x: number, y: number, z: number): RailShape | undefined {
  if (world.getBlock(x, y, z, false) !== BlockId.Rail) return undefined;
  return resolveRailShape(world, x, y, z) ?? defaultRailShape(world.getBlockState(x, y, z));
}

function findRail(world: VoxelWorld, position: THREE.Vector3): { x: number; y: number; z: number; shape: RailShape } | undefined {
  const x = Math.floor(position.x);
  const y = Math.floor(position.y + 0.05);
  const z = Math.floor(position.z);
  for (const sampleY of [y, y - 1, y + 1]) {
    const shape = railAt(world, x, sampleY, z);
    if (shape) return { x, y: sampleY, z, shape };
  }
  return undefined;
}

function railAxis(shape: RailShape): { x: number; z: number; y: number } {
  switch (shape) {
    case 'east_west':
    case 'north_east':
    case 'north_west':
    case 'south_east':
    case 'south_west':
      return { x: 1, z: 0, y: 0 };
    case 'ascending_east':
      return { x: 1, z: 0, y: 1 };
    case 'ascending_west':
      return { x: -1, z: 0, y: 1 };
    case 'ascending_south':
      return { x: 0, z: 1, y: 1 };
    case 'ascending_north':
      return { x: 0, z: -1, y: 1 };
    default:
      return { x: 0, z: 1, y: 0 };
  }
}

export class MinecartManager {
  private readonly carts = new Map<string, MinecartEntity>();
  private idCounter = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world: VoxelWorld,
    private readonly visuals: ItemVisualFactory,
    private readonly maxCarts = 16,
  ) {}

  get entities(): readonly MinecartEntity[] {
    return [...this.carts.values()];
  }

  get count(): number {
    return this.carts.size;
  }

  spawn(x: number, y: number, z: number, id?: string): MinecartEntity | undefined {
    if (this.disposed || this.carts.size >= this.maxCarts) return undefined;
    const entityId = id ?? `cart-${this.idCounter += 1}`;
    const position = new THREE.Vector3(x + 0.5, y, z + 0.5);
    const visual = this.createVisual();
    visual.position.copy(position);
    visual.position.y += 0.35;
    this.scene.add(visual);
    const entity: MinecartEntity = {
      id: entityId,
      position,
      previousPosition: position.clone(),
      velocity: new THREE.Vector3(),
      visual,
      yaw: 0,
      rider: false,
    };
    this.carts.set(entityId, entity);
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

  push(cart: MinecartEntity, direction: THREE.Vector3, strength = 0.18): void {
    cart.velocity.x += direction.x * strength;
    cart.velocity.z += direction.z * strength;
  }

  update(deltaSeconds: number): void {
    if (this.disposed) return;
    const dt = Number.isFinite(deltaSeconds) ? Math.min(deltaSeconds, 0.1) : FIXED_DT;
    for (const cart of [...this.carts.values()]) {
      cart.previousPosition.copy(cart.position);
      const rail = findRail(this.world, cart.position);
      if (!rail) {
        cart.velocity.y -= 32 * dt;
        const moved = moveVoxelBody(this.world, cart.position, cart.velocity, dt, BODY);
        if (moved.hitY && cart.velocity.y <= 0) cart.velocity.y = 0;
        this.syncVisual(cart);
        continue;
      }
      const axis = railAxis(rail.shape);
      const along = cart.velocity.x * axis.x + cart.velocity.z * axis.z;
      let speed = along;
      if (axis.y !== 0) {
        const downhill = axis.y > 0
          ? (axis.x !== 0 ? -Math.sign(axis.x) : -Math.sign(axis.z))
          : 0;
        // Ascending rails: moving toward the high end costs speed.
        if (speed * (axis.x || axis.z) > 0) speed -= SLOPE_ACCEL;
        else speed += SLOPE_ACCEL;
        void downhill;
      } else {
        speed *= FRICTION;
      }
      speed = THREE.MathUtils.clamp(speed, -MAX_SPEED, MAX_SPEED);
      if (Math.abs(speed) < 0.004) speed = 0;
      cart.velocity.set(axis.x * speed, 0, axis.z * speed);
      cart.position.x = rail.x + 0.5 + axis.x * ((cart.position.x - (rail.x + 0.5)) * Math.abs(axis.x));
      cart.position.z = rail.z + 0.5 + axis.z * ((cart.position.z - (rail.z + 0.5)) * Math.abs(axis.z));
      cart.position.addScaledVector(cart.velocity, dt * 20);
      cart.position.x = rail.x + 0.5 + (axis.x !== 0 ? (cart.position.x - (rail.x + 0.5)) : 0);
      cart.position.z = rail.z + 0.5 + (axis.z !== 0 ? (cart.position.z - (rail.z + 0.5)) : 0);
      if (axis.x === 0) cart.position.x = rail.x + 0.5;
      if (axis.z === 0) cart.position.z = rail.z + 0.5;
      cart.position.y = rail.y;
      if (rail.shape.startsWith('ascending_')) {
        const t = axis.x !== 0
          ? THREE.MathUtils.clamp(cart.position.x - rail.x, 0, 1)
          : THREE.MathUtils.clamp(cart.position.z - rail.z, 0, 1);
        const rising = rail.shape === 'ascending_east' || rail.shape === 'ascending_south';
        cart.position.y = rail.y + (rising ? t : 1 - t);
      }
      if (speed !== 0) cart.yaw = Math.atan2(cart.velocity.x, cart.velocity.z);
      if (!this.world.getChunk(floorDiv(Math.floor(cart.position.x), CHUNK_SIZE), floorDiv(Math.floor(cart.position.z), CHUNK_SIZE), false)) {
        continue;
      }
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
      cart.visual.position.set(visual.x, visual.y + 0.35, visual.z);
      cart.visual.rotation.y = cart.yaw;
    }
  }

  serialize(): SerializedMinecart[] {
    return [...this.carts.values()].map((cart) => ({
      id: cart.id,
      position: [cart.position.x, cart.position.y, cart.position.z],
      velocity: [cart.velocity.x, cart.velocity.y, cart.velocity.z],
      yaw: cart.yaw,
    }));
  }

  restore(serialized: readonly SerializedMinecart[]): void {
    this.clear();
    for (const entry of serialized) {
      const cart = this.spawn(entry.position[0] - 0.5, entry.position[1], entry.position[2] - 0.5, entry.id);
      if (!cart) continue;
      cart.position.set(entry.position[0], entry.position[1], entry.position[2]);
      cart.previousPosition.copy(cart.position);
      cart.velocity.set(entry.velocity[0], entry.velocity[1], entry.velocity[2]);
      cart.yaw = entry.yaw;
      this.syncVisual(cart);
    }
  }

  clear(): void {
    for (const cart of this.carts.values()) this.scene.remove(cart.visual);
    this.carts.clear();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  private createVisual(): THREE.Object3D {
    try {
      const visual = this.visuals.createItemModel('minecart');
      visual.scale.set(0.98, 0.7, 0.98);
      return visual;
    } catch {
      return new THREE.Object3D();
    }
  }

  private syncVisual(cart: MinecartEntity): void {
    cart.visual.position.set(cart.position.x, cart.position.y + 0.35, cart.position.z);
    cart.visual.rotation.y = cart.yaw;
    applySampledEntityLight(
      cart.visual, this.world, cart.position.x, cart.position.y + 0.4, cart.position.z, 0.3,
      worldDaylightUniform.value,
    );
  }
}
