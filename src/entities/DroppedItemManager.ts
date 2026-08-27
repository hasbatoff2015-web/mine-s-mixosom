import * as THREE from 'three';
import { migrateLegacyStack } from '../inventory/legacyItems';
import { BlockId } from '../blocks';
import { aabbFromBody, aabbOverlapsBlockType } from '../combat/fireSources';
import {
  canStacksMerge,
  cloneStack,
  validateItemStack,
  type ItemStack,
} from '../inventory';
import { getItemDefinition } from '../items';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { applySampledEntityLight, worldDaylightUniform } from '../rendering/worldLighting';
import type { VoxelWorld } from '../world/World';
import { interpolateVec3 } from '../core/entityInterpolation';
import { moveVoxelBody } from './voxelPhysics';

const ITEM_WIDTH = 0.28;
const ITEM_HEIGHT = 0.28;
const ITEM_SHAPE = Object.freeze({ width: ITEM_WIDTH, height: ITEM_HEIGHT });
export const DROPPED_ITEM_MAX_HEALTH = 5;
const ENVIRONMENT_DAMAGE_TICK_SECONDS = 0.05;

export type DroppedItemRemovalReason = 'picked-up' | 'despawned' | 'merged' | 'capacity' | 'removed' | 'cleared' | 'burned';
export type PickupDecision = number | boolean | void;

export interface SerializedDroppedItem {
  readonly id: string;
  readonly stack: ItemStack;
  /** Feet-anchored world position. */
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly ageSeconds: number;
  readonly pickupDelaySeconds: number;
  /** Optional for backward compatibility with saves made before item fire damage. */
  readonly environmentHealth?: number;
}

export interface DroppedItemSpawnOptions {
  readonly velocity?: Readonly<THREE.Vector3>;
  readonly pickupDelaySeconds?: number;
  readonly ageSeconds?: number;
  readonly environmentHealth?: number;
  /** Used by restore; normal callers should let the manager assign an ID. */
  readonly id?: string;
}

export interface DroppedItemUpdateContext {
  readonly collectorPosition?: Readonly<THREE.Vector3>;
  /**
   * Return the number accepted by inventory, `true` for all, or false/void for none.
   * This overrides the manager-level callback for this update.
   */
  readonly onPickup?: DroppedItemPickupHandler;
}

export type DroppedItemPickupHandler = (
  stack: Readonly<ItemStack>,
  entity: Readonly<DroppedItemEntity>,
) => PickupDecision;

export interface DroppedItemManagerOptions {
  readonly maxItems?: number;
  readonly pickupDelaySeconds?: number;
  readonly despawnSeconds?: number;
  readonly mergeRadius?: number;
  readonly pickupRadius?: number;
  readonly gravity?: number;
  /** Shared with the first-person renderer in the game runtime. */
  readonly visualFactory?: ItemVisualFactory;
  readonly onSpawn?: (entity: Readonly<DroppedItemEntity>) => void;
  readonly onPickup?: DroppedItemPickupHandler;
  readonly onRemove?: (
    entity: Readonly<DroppedItemEntity>,
    reason: DroppedItemRemovalReason,
  ) => void;
}

export class DroppedItemEntity {
  stack: ItemStack;
  readonly position: THREE.Vector3;
  readonly previousPosition = new THREE.Vector3();
  readonly velocity: THREE.Vector3;
  ageSeconds: number;
  pickupDelaySeconds: number;
  environmentHealth: number;
  environmentDamageSeconds = 0;
  onGround = false;
  readonly visual: THREE.Group;
  readonly bobPhase: number;

  constructor(
    readonly id: string,
    stack: ItemStack,
    position: Readonly<THREE.Vector3>,
    velocity: Readonly<THREE.Vector3>,
    ageSeconds: number,
    pickupDelaySeconds: number,
    environmentHealth: number,
    visual: THREE.Group,
    bobPhase: number,
  ) {
    this.stack = stack;
    this.position = new THREE.Vector3(position.x, position.y, position.z);
    this.previousPosition.copy(this.position);
    this.velocity = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
    this.ageSeconds = ageSeconds;
    this.pickupDelaySeconds = pickupDelaySeconds;
    this.environmentHealth = environmentHealth;
    this.visual = visual;
    this.bobPhase = bobPhase;
  }
}

/** Lightweight, capped item-entity simulation suitable for the fixed 20 TPS game loop. */
export class DroppedItemManager {
  private readonly itemsById = new Map<string, DroppedItemEntity>();
  private readonly visuals: ItemVisualFactory;
  private readonly ownsVisuals: boolean;
  private readonly maxItems: number;
  private readonly defaultPickupDelay: number;
  private readonly despawnSeconds: number;
  private readonly mergeRadiusSquared: number;
  private readonly pickupRadiusSquared: number;
  private readonly gravity: number;
  private idCounter = 0;
  private mergeTimer = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world: VoxelWorld,
    private readonly options: DroppedItemManagerOptions = {},
  ) {
    this.visuals = options.visualFactory ?? new ItemVisualFactory();
    this.ownsVisuals = options.visualFactory === undefined;
    this.maxItems = Math.max(1, Math.floor(options.maxItems ?? 128));
    this.defaultPickupDelay = Math.max(0, options.pickupDelaySeconds ?? 0.6);
    this.despawnSeconds = Math.max(1, options.despawnSeconds ?? 300);
    const mergeRadius = Math.max(0, options.mergeRadius ?? 0.9);
    const pickupRadius = Math.max(0, options.pickupRadius ?? 1.35);
    this.mergeRadiusSquared = mergeRadius * mergeRadius;
    this.pickupRadiusSquared = pickupRadius * pickupRadius;
    this.gravity = options.gravity ?? -18;
  }

  get count(): number {
    return this.itemsById.size;
  }

  get entities(): readonly DroppedItemEntity[] {
    return [...this.itemsById.values()];
  }

  get(id: string): DroppedItemEntity | undefined {
    return this.itemsById.get(id);
  }

  spawn(
    stack: Readonly<ItemStack>,
    position: Readonly<THREE.Vector3>,
    spawnOptions: DroppedItemSpawnOptions = {},
  ): DroppedItemEntity {
    this.assertActive();
    validateItemStack(stack as ItemStack);
    const clonedStack = cloneStack(stack as ItemStack) as ItemStack;
    const merged = this.mergeSpawnIntoNearby(clonedStack, position);
    if (merged) return merged;

    if (this.itemsById.size >= this.maxItems) this.evictOldest();
    const id = this.allocateId(spawnOptions.id);
    const visual = this.visuals.createDroppedItemVisual(clonedStack.itemId, clonedStack.count);
    visual.userData.entityId = id;
    this.scene.add(visual);
    const velocity = spawnOptions.velocity ?? new THREE.Vector3();
    const entity = new DroppedItemEntity(
      id,
      clonedStack,
      position,
      velocity,
      Math.max(0, spawnOptions.ageSeconds ?? 0),
      Math.max(0, spawnOptions.pickupDelaySeconds ?? this.defaultPickupDelay),
      this.normalizedEnvironmentHealth(spawnOptions.environmentHealth),
      visual,
      this.idCounter * 1.618,
    );
    this.itemsById.set(id, entity);
    this.updateCountScale(entity);
    this.syncVisual(entity, 1);
    this.options.onSpawn?.(entity);
    return entity;
  }

  /** Spawns a Q-style tossed item with forward and upward momentum. */
  drop(
    stack: Readonly<ItemStack>,
    origin: Readonly<THREE.Vector3>,
    direction: Readonly<THREE.Vector3>,
    speed = 3.2,
    pickupDelaySeconds = 1.25,
  ): DroppedItemEntity {
    const velocity = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(Math.max(0, speed));
    velocity.y += 1.6;
    return this.spawn(stack, origin, { velocity, pickupDelaySeconds });
  }

  update(deltaSeconds: number, context: DroppedItemUpdateContext = {}): void {
    if (this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const totalDelta = Math.min(deltaSeconds, 0.25);
    const substeps = Math.max(1, Math.ceil(totalDelta / 0.05));
    const step = totalDelta / substeps;
    const expired: Array<{ entity: DroppedItemEntity; reason: 'despawned' | 'burned' }> = [];

    for (const entity of this.itemsById.values()) {
      entity.previousPosition.copy(entity.position);
      entity.ageSeconds += totalDelta;
      entity.pickupDelaySeconds = Math.max(0, entity.pickupDelaySeconds - totalDelta);
      let burned = false;
      for (let substep = 0; substep < substeps; substep += 1) {
        if (this.simulateEntity(entity, step)) {
          burned = true;
          break;
        }
      }
      if (burned) {
        expired.push({ entity, reason: 'burned' });
        continue;
      }
      applySampledEntityLight(
        entity.visual,
        this.world,
        entity.position.x,
        entity.position.y,
        entity.position.z,
        ITEM_HEIGHT,
        worldDaylightUniform.value,
      );
      if (entity.ageSeconds >= this.despawnSeconds || entity.position.y < -32) {
        expired.push({ entity, reason: 'despawned' });
      }
    }
    for (const removal of expired) this.removeEntity(removal.entity, removal.reason);

    this.mergeTimer += totalDelta;
    if (this.mergeTimer >= 0.25) {
      this.mergeTimer %= 0.25;
      this.mergeNearby();
    }

    if (context.collectorPosition) {
      this.collectNearby(
        context.collectorPosition,
        context.onPickup ?? this.options.onPickup,
      );
    }
  }

  collectNearby(
    collectorPosition: Readonly<THREE.Vector3>,
    onPickup: DroppedItemPickupHandler | undefined = this.options.onPickup,
  ): number {
    if (!onPickup) return 0;
    let acceptedTotal = 0;
    for (const entity of [...this.itemsById.values()]) {
      if (entity.pickupDelaySeconds > 0) continue;
      if (entity.position.distanceToSquared(collectorPosition) > this.pickupRadiusSquared) continue;
      const decision = onPickup(cloneStack(entity.stack) as ItemStack, entity);
      const accepted = this.acceptedCount(decision, entity.stack.count);
      if (accepted <= 0) continue;
      acceptedTotal += accepted;
      if (accepted >= entity.stack.count) {
        this.removeEntity(entity, 'picked-up');
      } else {
        entity.stack = { ...entity.stack, count: entity.stack.count - accepted };
        this.updateCountScale(entity);
      }
    }
    return acceptedTotal;
  }

  remove(id: string): boolean {
    const entity = this.itemsById.get(id);
    if (!entity) return false;
    this.removeEntity(entity, 'removed');
    return true;
  }

  serialize(): SerializedDroppedItem[] {
    return [...this.itemsById.values()].map((entity) => ({
      id: entity.id,
      stack: cloneStack(entity.stack) as ItemStack,
      position: [entity.position.x, entity.position.y, entity.position.z],
      velocity: [entity.velocity.x, entity.velocity.y, entity.velocity.z],
      ageSeconds: entity.ageSeconds,
      pickupDelaySeconds: entity.pickupDelaySeconds,
      environmentHealth: entity.environmentHealth,
    }));
  }

  restore(serialized: readonly SerializedDroppedItem[], clearExisting = true): number {
    this.assertActive();
    if (clearExisting) this.clear();
    let restored = 0;
    for (const entry of serialized.slice(-this.maxItems)) {
      try {
        const stack = migrateLegacyStack(entry.stack);
        if (!stack) continue;
        if (!this.validTuple(entry.position) || !this.validTuple(entry.velocity)) continue;
        if (!Number.isFinite(entry.ageSeconds) || entry.ageSeconds >= this.despawnSeconds) continue;
        this.spawn(
          stack,
          new THREE.Vector3(...entry.position),
          {
            id: entry.id,
            velocity: new THREE.Vector3(...entry.velocity),
            ageSeconds: entry.ageSeconds,
            pickupDelaySeconds: entry.pickupDelaySeconds,
            environmentHealth: entry.environmentHealth,
          },
        );
        restored += 1;
      } catch {
        // A single corrupt/obsolete stack must not prevent the rest of a world from loading.
      }
    }
    return restored;
  }

  clear(): void {
    for (const entity of [...this.itemsById.values()]) this.removeEntity(entity, 'cleared');
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    if (this.ownsVisuals) this.visuals.dispose();
    this.disposed = true;
  }

  private simulateEntity(entity: DroppedItemEntity, deltaSeconds: number): boolean {
    const beforeBox = aabbFromBody(
      entity.position.x,
      entity.position.y,
      entity.position.z,
      ITEM_WIDTH,
      ITEM_HEIGHT,
    );
    const wasInLava = aabbOverlapsBlockType(this.world, beforeBox, BlockId.Lava);
    if (wasInLava) {
      // EntityItem in Java 1.9 receives an upward lava kick; water has no
      // equivalent modern item-buoyancy rule.
      entity.velocity.y = Math.max(entity.velocity.y, 4);
      const lavaDrag = Math.exp(-0.4 * deltaSeconds);
      entity.velocity.x *= lavaDrag;
      entity.velocity.z *= lavaDrag;
    } else {
      entity.velocity.y += this.gravity * deltaSeconds;
      const airDrag = Math.exp(-0.45 * deltaSeconds);
      entity.velocity.x *= airDrag;
      entity.velocity.z *= airDrag;
    }

    const result = moveVoxelBody(this.world, entity.position, entity.velocity, deltaSeconds, ITEM_SHAPE);
    entity.onGround = result.onGround;
    if (result.hitX) entity.velocity.x *= -0.25;
    if (result.hitZ) entity.velocity.z *= -0.25;
    if (result.hitY) {
      if (entity.velocity.y < -1.2) entity.velocity.y *= -0.28;
      else entity.velocity.y = 0;
    }
    if (entity.onGround) {
      const friction = Math.exp(-8 * deltaSeconds);
      entity.velocity.x *= friction;
      entity.velocity.z *= friction;
    }

    const afterBox = aabbFromBody(
      entity.position.x,
      entity.position.y,
      entity.position.z,
      ITEM_WIDTH,
      ITEM_HEIGHT,
    );
    const inLava = wasInLava || aabbOverlapsBlockType(this.world, afterBox, BlockId.Lava);
    const inFire = aabbOverlapsBlockType(this.world, beforeBox, BlockId.Fire)
      || aabbOverlapsBlockType(this.world, afterBox, BlockId.Fire);
    const damage = inLava ? 4 : (inFire ? 1 : 0);
    if (damage <= 0) {
      entity.environmentDamageSeconds = 0;
      return false;
    }
    entity.environmentDamageSeconds += deltaSeconds;
    while (entity.environmentDamageSeconds + 1e-9 >= ENVIRONMENT_DAMAGE_TICK_SECONDS) {
      entity.environmentDamageSeconds -= ENVIRONMENT_DAMAGE_TICK_SECONDS;
      entity.environmentHealth -= damage;
      if (entity.environmentHealth <= 0) return true;
    }
    return false;
  }

  interpolateVisuals(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    for (const entity of this.itemsById.values()) this.syncVisual(entity, t);
  }

  private syncVisual(entity: DroppedItemEntity, alpha = 1): void {
    const visual = interpolateVec3(
      entity.previousPosition.x,
      entity.previousPosition.y,
      entity.previousPosition.z,
      entity.position.x,
      entity.position.y,
      entity.position.z,
      alpha,
    );
    const bob = entity.onGround
      ? Math.sin(entity.ageSeconds * 2.5 + entity.bobPhase) * 0.035 + 0.045
      : 0;
    entity.visual.position.set(
      visual.x,
      visual.y + ITEM_HEIGHT * 0.5 + bob,
      visual.z,
    );
    entity.visual.rotation.y = entity.ageSeconds * 1.35 + entity.bobPhase;
  }

  private mergeSpawnIntoNearby(
    incoming: ItemStack,
    position: Readonly<THREE.Vector3>,
  ): DroppedItemEntity | undefined {
    const maximum = getItemDefinition(incoming.itemId).maxStack;
    for (const entity of this.itemsById.values()) {
      if (!canStacksMerge(entity.stack, incoming)) continue;
      if (entity.position.distanceToSquared(position) > this.mergeRadiusSquared) continue;
      const space = maximum - entity.stack.count;
      if (space < incoming.count) continue;
      entity.stack = { ...entity.stack, count: entity.stack.count + incoming.count };
      entity.pickupDelaySeconds = Math.max(entity.pickupDelaySeconds, this.defaultPickupDelay * 0.5);
      this.updateCountScale(entity);
      return entity;
    }
    return undefined;
  }

  private mergeNearby(): void {
    const entities = [...this.itemsById.values()];
    for (let sourceIndex = 0; sourceIndex < entities.length; sourceIndex += 1) {
      const target = entities[sourceIndex];
      if (!target || !this.itemsById.has(target.id)) continue;
      const maximum = getItemDefinition(target.stack.itemId).maxStack;
      if (target.stack.count >= maximum) continue;
      for (let incomingIndex = sourceIndex + 1; incomingIndex < entities.length; incomingIndex += 1) {
        const incoming = entities[incomingIndex];
        if (!incoming || !this.itemsById.has(incoming.id)) continue;
        if (!canStacksMerge(target.stack, incoming.stack)) continue;
        if (target.position.distanceToSquared(incoming.position) > this.mergeRadiusSquared) continue;
        const moved = Math.min(maximum - target.stack.count, incoming.stack.count);
        if (moved <= 0) break;
        target.stack = { ...target.stack, count: target.stack.count + moved };
        target.ageSeconds = Math.min(target.ageSeconds, incoming.ageSeconds);
        target.pickupDelaySeconds = Math.max(target.pickupDelaySeconds, incoming.pickupDelaySeconds);
        if (moved === incoming.stack.count) this.removeEntity(incoming, 'merged');
        else incoming.stack = { ...incoming.stack, count: incoming.stack.count - moved };
        this.updateCountScale(target);
        if (target.stack.count >= maximum) break;
      }
    }
  }

  private updateCountScale(entity: DroppedItemEntity): void {
    this.visuals.updateDroppedItemVisual(entity.visual, entity.stack.itemId, entity.stack.count);
    const maximum = getItemDefinition(entity.stack.itemId).maxStack;
    const fullness = maximum <= 1 ? 0 : entity.stack.count / maximum;
    entity.visual.scale.setScalar(0.9 + Math.min(0.22, fullness * 0.22));
  }

  private evictOldest(): void {
    let oldest: DroppedItemEntity | undefined;
    for (const entity of this.itemsById.values()) {
      if (!oldest || entity.ageSeconds > oldest.ageSeconds) oldest = entity;
    }
    if (oldest) this.removeEntity(oldest, 'capacity');
  }

  private removeEntity(entity: DroppedItemEntity, reason: DroppedItemRemovalReason): void {
    if (!this.itemsById.delete(entity.id)) return;
    entity.visual.removeFromParent();
    this.options.onRemove?.(entity, reason);
  }

  private acceptedCount(decision: PickupDecision, available: number): number {
    if (decision === true) return available;
    if (decision === false || decision === undefined || !Number.isFinite(decision)) return 0;
    return Math.max(0, Math.min(available, Math.floor(decision)));
  }

  private allocateId(requested: string | undefined): string {
    if (requested && !this.itemsById.has(requested)) {
      const numericSuffix = Number(requested.split('-').at(-1));
      if (Number.isFinite(numericSuffix)) this.idCounter = Math.max(this.idCounter, numericSuffix);
      return requested;
    }
    let id: string;
    do {
      this.idCounter += 1;
      id = `item-${this.idCounter}`;
    } while (this.itemsById.has(id));
    return id;
  }

  private validTuple(tuple: readonly number[]): tuple is readonly [number, number, number] {
    return tuple.length === 3 && tuple.every(Number.isFinite);
  }

  private normalizedEnvironmentHealth(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DROPPED_ITEM_MAX_HEALTH;
    return Math.max(1, Math.min(DROPPED_ITEM_MAX_HEALTH, Math.floor(value)));
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('DroppedItemManager has been disposed');
  }
}
