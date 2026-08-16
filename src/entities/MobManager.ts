import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../blocks';
import { createItemStack, type ItemStack } from '../inventory';
import type { VoxelWorld } from '../world/World';
import {
  MOB_DEFINITIONS,
  getMobDefinition,
  isHostileMob,
  type MobDefinition,
  type MobDisposition,
  type MobKind,
  type MobState,
} from './mobDefinitions';
import { createMobModel, type MobModel } from './mobModels';
import { hasVoxelLineOfSight, isSpaceClear, moveVoxelBody } from './voxelPhysics';
import { VoxelVisualFactory } from './voxelVisuals';

const HOSTILE_KINDS: readonly MobKind[] = ['zombie', 'skeleton', 'creeper', 'spider'];
const PASSIVE_KINDS: readonly MobKind[] = ['cow', 'pig', 'chicken', 'sheep'];
const UP = new THREE.Vector3(0, 1, 0);
const PROJECTILE_FORWARD = new THREE.Vector3(0, 0, -1);

export type MobRemovalReason = 'death' | 'explosion' | 'despawn' | 'removed' | 'cleared' | 'capacity';
export type MobDamageSource = 'player' | 'projectile' | 'fire' | 'explosion' | 'environment';

export interface MobSpawnOptions {
  readonly id?: string;
  readonly velocity?: Readonly<THREE.Vector3>;
  readonly health?: number;
  readonly ageSeconds?: number;
  readonly state?: MobState;
  /** Bypasses population caps; intended for restore and debug commands. */
  readonly force?: boolean;
}

export interface MobDamageOptions {
  readonly source?: MobDamageSource;
  readonly attackerPosition?: Readonly<THREE.Vector3>;
  readonly knockback?: number;
}

export interface MobPlayerDamageEvent {
  readonly amount: number;
  readonly source: 'melee' | 'arrow';
  readonly mobId: string;
  readonly mobKind: MobKind;
  readonly position: THREE.Vector3;
  readonly knockback: THREE.Vector3;
}

export interface MobExplosionEvent {
  readonly sourceId: string;
  readonly position: THREE.Vector3;
  readonly radius: number;
  readonly power: number;
}

export interface MobDrop {
  readonly sourceId: string;
  readonly stack: ItemStack;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
}

export interface MobProjectileSpawnEvent {
  readonly projectileId: string;
  readonly ownerId: string;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
}

export interface MobUpdateContext {
  /** Feet-anchored player position. Omitting it pauses player-aware AI and auto-spawning. */
  readonly playerPosition?: Readonly<THREE.Vector3>;
  readonly playerEyePosition?: Readonly<THREE.Vector3>;
  readonly playerAlive?: boolean;
  /** False keeps spawning/despawning centred on the player but disables hostile targeting. */
  readonly playerTargetable?: boolean;
  /** 0..1; if omitted it is derived from `world.timeOfDay`. */
  readonly daylight?: number;
  readonly lightLevelAt?: (position: Readonly<THREE.Vector3>) => number;
  readonly onPlayerDamage?: (event: MobPlayerDamageEvent) => void;
  readonly onExplosion?: (event: MobExplosionEvent) => void;
  readonly onProjectileSpawn?: (event: MobProjectileSpawnEvent) => void;
}

export interface MobManagerOptions {
  readonly maxMobs?: number;
  readonly passiveCap?: number;
  readonly hostileCap?: number;
  readonly maxProjectiles?: number;
  readonly automaticSpawning?: boolean;
  readonly spawnIntervalSeconds?: number;
  readonly minimumSpawnDistance?: number;
  readonly maximumSpawnDistance?: number;
  readonly random?: () => number;
  readonly onSpawn?: (mob: Readonly<MobEntity>) => void;
  readonly onRemove?: (mob: Readonly<MobEntity>, reason: MobRemovalReason) => void;
  readonly onDrop?: (drop: MobDrop) => void;
  readonly onPlayerDamage?: (event: MobPlayerDamageEvent) => void;
  readonly onExplosion?: (event: MobExplosionEvent) => void;
  readonly onProjectileSpawn?: (event: MobProjectileSpawnEvent) => void;
}

export interface MobRaycastHit {
  readonly mob: MobEntity;
  readonly distance: number;
  readonly point: THREE.Vector3;
}

export interface SerializedMob {
  readonly id: string;
  readonly kind: MobKind;
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly health: number;
  readonly state: MobState;
  readonly ageSeconds: number;
  readonly fuseSeconds: number;
}

interface MobProjectile {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerKind: MobKind;
  readonly visual: THREE.Object3D;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  ageSeconds: number;
  damage: number;
}

export class MobEntity {
  readonly definition: MobDefinition;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly visual: THREE.Group;
  readonly model: MobModel;
  health: number;
  state: MobState;
  ageSeconds: number;
  onGround = false;
  attackCooldownSeconds = 0;
  stateSeconds = 0;
  decisionSeconds = 0;
  hurtSeconds = 0;
  deathSeconds = 0;
  fuseSeconds = 0;
  burnAccumulator = 0;
  farSeconds = 0;
  walkPhase = 0;
  fleeSeconds = 0;
  readonly wanderDirection = new THREE.Vector3();
  resumeState: MobState = 'idle';
  deathDropsEmitted = false;

  constructor(
    readonly id: string,
    readonly kind: MobKind,
    position: Readonly<THREE.Vector3>,
    velocity: Readonly<THREE.Vector3>,
    health: number,
    state: MobState,
    ageSeconds: number,
    model: MobModel,
  ) {
    this.definition = getMobDefinition(kind);
    this.position = new THREE.Vector3(position.x, position.y, position.z);
    this.velocity = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
    this.health = health;
    this.state = state;
    this.ageSeconds = ageSeconds;
    this.model = model;
    this.visual = model.root;
  }

  get alive(): boolean {
    return this.state !== 'die' && this.health > 0;
  }

  get eyePosition(): THREE.Vector3 {
    return this.position.clone().addScaledVector(UP, this.definition.eyeHeight);
  }
}

/**
 * Bounded voxel-mob simulation. It deliberately uses direct steering rather than
 * heavyweight pathfinding, keeping 20 TPS updates inexpensive in a browser.
 */
export class MobManager {
  private readonly mobsById = new Map<string, MobEntity>();
  private readonly projectiles = new Map<string, MobProjectile>();
  private readonly visuals = new VoxelVisualFactory();
  private readonly pendingDrops: MobDrop[] = [];
  private readonly pendingPlayerDamage: MobPlayerDamageEvent[] = [];
  private readonly pendingExplosions: MobExplosionEvent[] = [];
  private readonly maxMobs: number;
  private readonly passiveCap: number;
  private readonly hostileCap: number;
  private readonly maxProjectiles: number;
  private readonly automaticSpawning: boolean;
  private readonly spawnIntervalSeconds: number;
  private readonly minimumSpawnDistance: number;
  private readonly maximumSpawnDistance: number;
  private readonly random: () => number;
  private mobIdCounter = 0;
  private projectileIdCounter = 0;
  private spawnTimer = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world: VoxelWorld,
    private readonly options: MobManagerOptions = {},
  ) {
    this.maxMobs = Math.max(1, Math.floor(options.maxMobs ?? 48));
    this.passiveCap = Math.max(0, Math.min(this.maxMobs, Math.floor(options.passiveCap ?? 20)));
    this.hostileCap = Math.max(0, Math.min(this.maxMobs, Math.floor(options.hostileCap ?? 28)));
    this.maxProjectiles = Math.max(1, Math.floor(options.maxProjectiles ?? 64));
    this.automaticSpawning = options.automaticSpawning ?? true;
    this.spawnIntervalSeconds = Math.max(0.25, options.spawnIntervalSeconds ?? 2);
    this.minimumSpawnDistance = Math.max(4, options.minimumSpawnDistance ?? 14);
    this.maximumSpawnDistance = Math.max(
      this.minimumSpawnDistance + 1,
      options.maximumSpawnDistance ?? 34,
    );
    this.random = options.random ?? Math.random;
  }

  get count(): number {
    return this.mobsById.size;
  }

  get projectileCount(): number {
    return this.projectiles.size;
  }

  get entities(): readonly MobEntity[] {
    return [...this.mobsById.values()];
  }

  get(id: string): MobEntity | undefined {
    return this.mobsById.get(id);
  }

  countByDisposition(disposition: MobDisposition): number {
    let count = 0;
    for (const mob of this.mobsById.values()) {
      if (mob.alive && mob.definition.disposition === disposition) count += 1;
    }
    return count;
  }

  countByKind(kind: MobKind): number {
    let count = 0;
    for (const mob of this.mobsById.values()) if (mob.alive && mob.kind === kind) count += 1;
    return count;
  }

  spawn(
    kind: MobKind,
    position: Readonly<THREE.Vector3>,
    spawnOptions: MobSpawnOptions = {},
  ): MobEntity | undefined {
    this.assertActive();
    const definition = getMobDefinition(kind);
    if (!spawnOptions.force && !this.hasPopulationRoom(definition.disposition)) return undefined;
    if (this.mobsById.size >= this.maxMobs) {
      if (!spawnOptions.force) return undefined;
      this.evictFarthestOrOldest(position);
    }
    const model = createMobModel(this.visuals, kind);
    const id = this.allocateMobId(spawnOptions.id);
    model.root.userData.entityId = id;
    model.root.userData.mobKind = kind;
    const velocity = spawnOptions.velocity ?? new THREE.Vector3();
    const health = THREE.MathUtils.clamp(
      spawnOptions.health ?? definition.maxHealth,
      0,
      definition.maxHealth,
    );
    const state = health <= 0 ? 'die' : spawnOptions.state ?? 'idle';
    const mob = new MobEntity(
      id,
      kind,
      position,
      velocity,
      health,
      state,
      Math.max(0, spawnOptions.ageSeconds ?? 0),
      model,
    );
    this.mobsById.set(id, mob);
    this.scene.add(model.root);
    this.syncVisual(mob, 0);
    this.options.onSpawn?.(mob);
    return mob;
  }

  update(deltaSeconds: number, context: MobUpdateContext = {}): void {
    if (this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const delta = Math.min(deltaSeconds, 0.25);
    const daylight = THREE.MathUtils.clamp(context.daylight ?? this.daylightFactor(), 0, 1);
    const playerAlive = context.playerAlive ?? true;
    const playerPosition = playerAlive ? context.playerPosition : undefined;
    const targetPosition = context.playerTargetable === false ? undefined : playerPosition;

    if (this.automaticSpawning && playerPosition) {
      this.spawnTimer += delta;
      while (this.spawnTimer >= this.spawnIntervalSeconds) {
        this.spawnTimer -= this.spawnIntervalSeconds;
        this.tryAutomaticSpawn(playerPosition, daylight, context.lightLevelAt);
      }
    }

    for (const mob of [...this.mobsById.values()]) {
      mob.ageSeconds += delta;
      mob.attackCooldownSeconds = Math.max(0, mob.attackCooldownSeconds - delta);
      mob.stateSeconds += delta;
      mob.decisionSeconds -= delta;
      mob.fleeSeconds = Math.max(0, mob.fleeSeconds - delta);

      if (mob.state === 'die') {
        mob.deathSeconds += delta;
        this.syncVisual(mob, delta);
        if (mob.deathSeconds >= 0.7) this.finishDeath(mob);
        continue;
      }

      if (mob.hurtSeconds > 0) {
        mob.hurtSeconds = Math.max(0, mob.hurtSeconds - delta);
        if (mob.hurtSeconds === 0 && mob.alive) this.changeState(mob, mob.resumeState);
      } else {
        this.updateAi(mob, delta, targetPosition, context, daylight);
      }

      this.updateSunExposure(mob, delta, daylight, context.lightLevelAt);
      if (!mob.alive) {
        this.syncVisual(mob, delta);
        continue;
      }
      this.simulateMobPhysics(mob, delta);
      this.updateDistanceDespawn(mob, delta, playerPosition);
      this.syncVisual(mob, delta);
    }

    this.updateProjectiles(delta, targetPosition, context);
  }

  damage(
    target: string | MobEntity,
    amount: number,
    damageOptions: MobDamageOptions = {},
  ): boolean {
    const mob = typeof target === 'string' ? this.mobsById.get(target) : target;
    if (!mob || !this.mobsById.has(mob.id) || !mob.alive || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }
    mob.health = Math.max(0, mob.health - amount);
    mob.resumeState = mob.definition.disposition === 'hostile' ? 'chase' : 'wander';
    if (damageOptions.attackerPosition) {
      const away = new THREE.Vector3().subVectors(mob.position, damageOptions.attackerPosition);
      away.y = 0;
      if (away.lengthSq() > 1e-6) away.normalize();
      const knockback = Math.max(0, damageOptions.knockback ?? 3.2);
      mob.velocity.addScaledVector(away, knockback);
      mob.velocity.y = Math.max(mob.velocity.y, 3.2);
      mob.wanderDirection.copy(away);
      mob.fleeSeconds = mob.definition.disposition === 'passive' ? 3 : 0;
    }
    if (mob.health <= 0) {
      this.beginDeath(mob);
    } else {
      mob.hurtSeconds = 0.28;
      this.changeState(mob, 'hurt');
    }
    return true;
  }

  damageMob(
    target: string | MobEntity,
    amount: number,
    damageOptions: MobDamageOptions = {},
  ): boolean {
    return this.damage(target, amount, damageOptions);
  }

  raycast(
    origin: Readonly<THREE.Vector3>,
    direction: Readonly<THREE.Vector3>,
    maxDistance = 4.5,
  ): MobRaycastHit | undefined {
    const normalized = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (normalized.lengthSq() <= 1e-8 || maxDistance <= 0) return undefined;
    normalized.normalize();
    const rayOrigin = new THREE.Vector3(origin.x, origin.y, origin.z);
    const blockHit = this.world.raycast(rayOrigin, normalized, maxDistance);
    const limit = Math.min(maxDistance, blockHit?.distance ?? maxDistance);
    const ray = new THREE.Ray(rayOrigin, normalized);
    const point = new THREE.Vector3();
    let closest: MobRaycastHit | undefined;
    for (const mob of this.mobsById.values()) {
      if (!mob.alive) continue;
      const halfWidth = mob.definition.width * 0.5;
      const box = new THREE.Box3(
        new THREE.Vector3(mob.position.x - halfWidth, mob.position.y, mob.position.z - halfWidth),
        new THREE.Vector3(
          mob.position.x + halfWidth,
          mob.position.y + mob.definition.height,
          mob.position.z + halfWidth,
        ),
      );
      const intersection = ray.intersectBox(box, point);
      if (!intersection) continue;
      const distance = rayOrigin.distanceTo(intersection);
      if (distance > limit || (closest && distance >= closest.distance)) continue;
      closest = { mob, distance, point: intersection.clone() };
    }
    return closest;
  }

  attackTarget(
    origin: Readonly<THREE.Vector3>,
    direction: Readonly<THREE.Vector3>,
    damage: number,
    reach = 4.5,
    knockback = 3.2,
  ): MobRaycastHit | undefined {
    const hit = this.raycast(origin, direction, reach);
    if (!hit) return undefined;
    this.damage(hit.mob, damage, { source: 'player', attackerPosition: origin, knockback });
    return hit;
  }

  remove(id: string): boolean {
    const mob = this.mobsById.get(id);
    if (!mob) return false;
    this.removeMob(mob, 'removed');
    return true;
  }

  serialize(): SerializedMob[] {
    return [...this.mobsById.values()].map((mob) => ({
      id: mob.id,
      kind: mob.kind,
      position: [mob.position.x, mob.position.y, mob.position.z],
      velocity: [mob.velocity.x, mob.velocity.y, mob.velocity.z],
      health: mob.health,
      state: mob.state,
      ageSeconds: mob.ageSeconds,
      fuseSeconds: mob.fuseSeconds,
    }));
  }

  restore(serialized: readonly SerializedMob[], clearExisting = true): number {
    this.assertActive();
    if (clearExisting) this.clear();
    let restored = 0;
    for (const entry of serialized.slice(-this.maxMobs)) {
      if (!(entry.kind in MOB_DEFINITIONS)) continue;
      if (!this.validTuple(entry.position) || !this.validTuple(entry.velocity)) continue;
      if (!Number.isFinite(entry.health) || entry.health <= 0) continue;
      const mob = this.spawn(entry.kind, new THREE.Vector3(...entry.position), {
        id: entry.id,
        velocity: new THREE.Vector3(...entry.velocity),
        health: entry.health,
        state: entry.state,
        ageSeconds: entry.ageSeconds,
        force: true,
      });
      if (!mob) continue;
      mob.fuseSeconds = THREE.MathUtils.clamp(entry.fuseSeconds, 0, 1.5);
      restored += 1;
    }
    return restored;
  }

  getApproximateLight(position: Readonly<THREE.Vector3>, daylight = this.daylightFactor()): number {
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);
    const surface = this.world.surfaceY(x, z);
    let light = y > surface ? Math.round(THREE.MathUtils.clamp(daylight, 0, 1) * 15) : 0;
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const emission = getBlockDefinition(this.world.getBlock(x + dx, y + dy, z + dz)).emission ?? 0;
          light = Math.max(light, emission - Math.abs(dx) - Math.abs(dy) - Math.abs(dz));
        }
      }
    }
    return THREE.MathUtils.clamp(Math.round(light), 0, 15);
  }

  consumeDrops(): MobDrop[] {
    return this.pendingDrops.splice(0);
  }

  consumePlayerDamage(): MobPlayerDamageEvent[] {
    return this.pendingPlayerDamage.splice(0);
  }

  consumeExplosions(): MobExplosionEvent[] {
    return this.pendingExplosions.splice(0);
  }

  clear(): void {
    for (const mob of [...this.mobsById.values()]) this.removeMob(mob, 'cleared');
    for (const projectile of this.projectiles.values()) projectile.visual.removeFromParent();
    this.projectiles.clear();
    this.pendingDrops.length = 0;
    this.pendingPlayerDamage.length = 0;
    this.pendingExplosions.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.visuals.dispose();
    this.disposed = true;
  }

  private updateAi(
    mob: MobEntity,
    delta: number,
    playerPosition: Readonly<THREE.Vector3> | undefined,
    context: MobUpdateContext,
    daylight: number,
  ): void {
    if (mob.definition.disposition === 'passive') {
      this.updatePassiveAi(mob, delta);
      return;
    }
    if (!playerPosition) {
      this.updateWander(mob, delta, 0.55);
      return;
    }
    const playerEye = this.playerEye(playerPosition, context);
    const horizontal = new THREE.Vector3().subVectors(playerPosition, mob.position);
    horizontal.y = 0;
    const distance = mob.eyePosition.distanceTo(playerEye);
    if (distance > mob.definition.detectionRange) {
      mob.fuseSeconds = Math.max(0, mob.fuseSeconds - delta * 2);
      this.updateWander(mob, delta, 0.55);
      return;
    }

    if (mob.kind === 'creeper') {
      this.updateCreeper(mob, delta, playerPosition, distance, context);
      return;
    }
    if (mob.kind === 'skeleton') {
      this.updateSkeleton(mob, playerPosition, context, distance);
      return;
    }

    const lineOfSight = hasVoxelLineOfSight(this.world, mob.eyePosition, playerEye);
    if (distance <= mob.definition.attackRange && lineOfSight) {
      this.changeState(mob, 'attack');
      mob.velocity.x *= 0.25;
      mob.velocity.z *= 0.25;
      if (mob.attackCooldownSeconds <= 0) {
        this.emitPlayerDamage(mob, playerPosition, mob.definition.attackDamage, 'melee', context);
        mob.attackCooldownSeconds = mob.definition.attackCooldownSeconds;
      }
    } else {
      this.changeState(mob, 'chase');
      this.steerToward(mob, horizontal, mob.definition.speed * (mob.kind === 'spider' ? 1.05 : 1));
    }

    // Spiders become mostly neutral in full daylight unless already close enough to fight.
    if (mob.kind === 'spider' && daylight > 0.8 && distance > 5) this.updateWander(mob, delta, 0.65);
  }

  private updatePassiveAi(mob: MobEntity, delta: number): void {
    if (mob.fleeSeconds > 0 && mob.wanderDirection.lengthSq() > 0) {
      this.changeState(mob, 'wander');
      this.steerToward(mob, mob.wanderDirection, mob.definition.speed * 1.55);
      return;
    }
    this.updateWander(mob, delta, 0.72);
  }

  private updateWander(mob: MobEntity, delta: number, movementFraction: number): void {
    if (mob.decisionSeconds <= 0) {
      mob.decisionSeconds = 1.5 + this.random() * 3.5;
      if (this.random() < 0.38) {
        mob.wanderDirection.set(0, 0, 0);
        this.changeState(mob, 'idle');
      } else {
        const angle = this.random() * Math.PI * 2;
        mob.wanderDirection.set(Math.cos(angle), 0, Math.sin(angle));
        this.changeState(mob, 'wander');
      }
    }
    if (mob.state === 'wander' && mob.wanderDirection.lengthSq() > 0) {
      this.steerToward(mob, mob.wanderDirection, mob.definition.speed * movementFraction);
    } else {
      const damping = Math.exp(-8 * delta);
      mob.velocity.x *= damping;
      mob.velocity.z *= damping;
    }
  }

  private updateCreeper(
    mob: MobEntity,
    delta: number,
    playerPosition: Readonly<THREE.Vector3>,
    distance: number,
    context: MobUpdateContext,
  ): void {
    const lineOfSight = hasVoxelLineOfSight(this.world, mob.eyePosition, this.playerEye(playerPosition, context));
    if (distance <= 3.2 && lineOfSight) {
      this.changeState(mob, 'attack');
      mob.velocity.x *= 0.2;
      mob.velocity.z *= 0.2;
      mob.fuseSeconds += delta;
      if (mob.fuseSeconds >= 1.5) this.explodeCreeper(mob, context);
    } else {
      mob.fuseSeconds = Math.max(0, mob.fuseSeconds - delta * 1.8);
      this.changeState(mob, 'chase');
      const direction = new THREE.Vector3().subVectors(playerPosition, mob.position);
      direction.y = 0;
      this.steerToward(mob, direction, mob.definition.speed);
    }
  }

  private updateSkeleton(
    mob: MobEntity,
    playerPosition: Readonly<THREE.Vector3>,
    context: MobUpdateContext,
    distance: number,
  ): void {
    const targetEye = this.playerEye(playerPosition, context);
    const lineOfSight = hasVoxelLineOfSight(this.world, mob.eyePosition, targetEye);
    const horizontal = new THREE.Vector3().subVectors(playerPosition, mob.position);
    horizontal.y = 0;
    if (lineOfSight && distance <= mob.definition.attackRange) {
      this.changeState(mob, 'attack');
      if (distance < 5) this.steerToward(mob, horizontal.multiplyScalar(-1), mob.definition.speed);
      else {
        mob.velocity.x *= 0.5;
        mob.velocity.z *= 0.5;
      }
      if (mob.attackCooldownSeconds <= 0) {
        this.spawnArrow(mob, targetEye, context);
        mob.attackCooldownSeconds = mob.definition.attackCooldownSeconds;
      }
    } else {
      this.changeState(mob, 'chase');
      this.steerToward(mob, horizontal, mob.definition.speed);
    }
  }

  private simulateMobPhysics(mob: MobEntity, delta: number): void {
    const substeps = Math.max(1, Math.ceil(delta / 0.05));
    const step = delta / substeps;
    for (let index = 0; index < substeps; index += 1) {
      const sampled = getBlockDefinition(this.world.getBlock(
        Math.floor(mob.position.x),
        Math.floor(mob.position.y + mob.definition.height * 0.5),
        Math.floor(mob.position.z),
      ));
      if (sampled.liquid) {
        mob.velocity.y += 4.5 * step;
        mob.velocity.multiplyScalar(Math.exp(-2.8 * step));
      } else {
        mob.velocity.y -= 20 * step;
      }
      const result = moveVoxelBody(
        this.world,
        mob.position,
        mob.velocity,
        step,
        { width: mob.definition.width, height: mob.definition.height },
      );
      mob.onGround = result.onGround;
      if (result.hitY) mob.velocity.y = 0;
      if (result.hitX) {
        mob.velocity.x = 0;
        if (mob.onGround) mob.velocity.y = 5.2;
        mob.wanderDirection.x *= -1;
      }
      if (result.hitZ) {
        mob.velocity.z = 0;
        if (mob.onGround) mob.velocity.y = 5.2;
        mob.wanderDirection.z *= -1;
      }
    }
  }

  private updateSunExposure(
    mob: MobEntity,
    delta: number,
    daylight: number,
    customLight: MobUpdateContext['lightLevelAt'],
  ): void {
    if ((mob.kind !== 'zombie' && mob.kind !== 'skeleton') || daylight < 0.82) {
      mob.burnAccumulator = 0;
      return;
    }
    const light = customLight?.(mob.eyePosition) ?? this.getApproximateLight(mob.eyePosition, daylight);
    if (light < 14) {
      mob.burnAccumulator = 0;
      return;
    }
    mob.burnAccumulator += delta;
    if (mob.burnAccumulator >= 1) {
      mob.burnAccumulator %= 1;
      this.damage(mob, 1, { source: 'fire' });
    }
  }

  private updateDistanceDespawn(
    mob: MobEntity,
    delta: number,
    playerPosition: Readonly<THREE.Vector3> | undefined,
  ): void {
    if (!playerPosition) return;
    const distanceSquared = mob.position.distanceToSquared(playerPosition);
    if (distanceSquared > 72 * 72) mob.farSeconds += delta;
    else mob.farSeconds = 0;
    if (mob.farSeconds > 8 || mob.position.y < -32) this.removeMob(mob, 'despawn');
  }

  private syncVisual(mob: MobEntity, delta: number): void {
    const speed = Math.hypot(mob.velocity.x, mob.velocity.z);
    if (speed > 0.05) {
      mob.visual.rotation.y = Math.atan2(mob.velocity.x, mob.velocity.z) + Math.PI;
      mob.walkPhase += delta * Math.max(3, speed * 4.5);
    }
    const swing = Math.sin(mob.walkPhase) * Math.min(0.65, speed * 0.22);
    if (mob.kind === 'spider') {
      mob.model.legs.forEach((leg, index) => {
        const side = index < 4 ? -1 : 1;
        const pair = index % 4;
        const phase = Math.sin(mob.walkPhase + pair * 0.85);
        leg.rotation.x = 0;
        leg.rotation.y = Number(leg.userData.baseRotationY ?? 0) + phase * 0.18;
        leg.rotation.z = Number(leg.userData.baseRotationZ ?? 0)
          + Math.cos(mob.walkPhase + pair * 0.7) * 0.08 * side;
      });
    } else {
      mob.model.legs.forEach((leg, index) => {
        leg.rotation.x = index % 2 === 0 ? swing : -swing;
      });
    }
    if (mob.kind === 'zombie') {
      const pose = mob.state === 'attack' ? -1.55 : -1.2;
      mob.model.arms.forEach((arm, index) => {
        arm.rotation.x = pose + (index % 2 === 0 ? swing : -swing) * 0.25;
      });
    } else if (mob.kind === 'skeleton') {
      mob.model.arms.forEach((arm, index) => {
        arm.rotation.x = mob.state === 'attack'
          ? -1.15
          : (index % 2 === 0 ? swing : -swing) * 0.5;
      });
    }
    if (mob.kind === 'creeper') {
      const fuseProgress = THREE.MathUtils.clamp(mob.fuseSeconds / 1.5, 0, 1);
      const pulse = fuseProgress > 0
        ? Math.sin(mob.fuseSeconds * (10 + fuseProgress * 18)) * 0.025 * fuseProgress
        : 0;
      mob.visual.scale.set(1 + pulse, 1 + fuseProgress * 0.08, 1 + pulse);
    } else if (mob.state === 'die') {
      const progress = THREE.MathUtils.clamp(mob.deathSeconds / 0.7, 0, 1);
      mob.visual.rotation.z = progress * Math.PI * 0.5;
      mob.visual.scale.setScalar(1 - progress * 0.25);
    } else {
      mob.visual.scale.setScalar(1);
      mob.visual.rotation.z = 0;
    }
    const hurtJolt = mob.state === 'hurt' ? Math.sin(mob.stateSeconds * 45) * 0.035 : 0;
    mob.visual.position.set(mob.position.x + hurtJolt, mob.position.y, mob.position.z);
  }

  private steerToward(mob: MobEntity, direction: Readonly<THREE.Vector3>, speed: number): void {
    const length = Math.hypot(direction.x, direction.z);
    if (length <= 1e-6) return;
    mob.velocity.x = direction.x / length * speed;
    mob.velocity.z = direction.z / length * speed;
  }

  private tryAutomaticSpawn(
    playerPosition: Readonly<THREE.Vector3>,
    daylight: number,
    customLight: MobUpdateContext['lightLevelAt'],
  ): MobEntity | undefined {
    const hostileRoom = this.hasPopulationRoom('hostile');
    const passiveRoom = this.hasPopulationRoom('passive');
    if (!hostileRoom && !passiveRoom) return undefined;

    const preferHostile = hostileRoom && (daylight < 0.45 || !passiveRoom || this.random() < 0.22);
    const disposition: MobDisposition = preferHostile ? 'hostile' : 'passive';
    const kinds = disposition === 'hostile' ? HOSTILE_KINDS : PASSIVE_KINDS;
    const kind = kinds[Math.floor(this.random() * kinds.length)] ?? kinds[0]!;
    const definition = getMobDefinition(kind);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = this.random() * Math.PI * 2;
      const distance = this.minimumSpawnDistance
        + this.random() * (this.maximumSpawnDistance - this.minimumSpawnDistance);
      const x = Math.floor(playerPosition.x + Math.cos(angle) * distance) + 0.5;
      const z = Math.floor(playerPosition.z + Math.sin(angle) * distance) + 0.5;
      const surfaceY = this.world.surfaceY(Math.floor(x), Math.floor(z));
      let y = surfaceY + 1;
      if (disposition === 'hostile' && this.random() < 0.38 && surfaceY > 8) {
        y = this.findCaveSpawnY(Math.floor(x), Math.floor(z), surfaceY, definition) ?? y;
      }
      const position = new THREE.Vector3(x, y, z);
      if (!this.spawnPositionIsValid(position, definition, disposition)) continue;
      const light = customLight?.(position) ?? this.getApproximateLight(position, daylight);
      if (disposition === 'hostile' ? light > 7 : light < 9) continue;
      return this.spawn(kind, position);
    }
    return undefined;
  }

  private findCaveSpawnY(
    x: number,
    z: number,
    surfaceY: number,
    definition: MobDefinition,
  ): number | undefined {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const y = 3 + Math.floor(this.random() * Math.max(1, surfaceY - 5));
      const candidate = new THREE.Vector3(x + 0.5, y, z + 0.5);
      if (isSpaceClear(this.world, candidate, definition)
        && getBlockDefinition(this.world.getBlock(x, y - 1, z)).solid) return y;
    }
    return undefined;
  }

  private spawnPositionIsValid(
    position: Readonly<THREE.Vector3>,
    definition: MobDefinition,
    disposition: MobDisposition,
  ): boolean {
    if (!isSpaceClear(this.world, position, definition)) return false;
    const below = this.world.getBlock(
      Math.floor(position.x),
      Math.floor(position.y) - 1,
      Math.floor(position.z),
    );
    const belowDefinition = getBlockDefinition(below);
    if (!belowDefinition.solid || belowDefinition.liquid) return false;
    if (disposition === 'passive' && below !== BlockId.GrassBlock) return false;
    return true;
  }

  private spawnArrow(
    owner: MobEntity,
    target: Readonly<THREE.Vector3>,
    context: MobUpdateContext,
  ): void {
    if (this.projectiles.size >= this.maxProjectiles) {
      const oldest = this.projectiles.values().next().value as MobProjectile | undefined;
      if (oldest) this.removeProjectile(oldest.id);
    }
    this.projectileIdCounter += 1;
    const id = `projectile-${this.projectileIdCounter}`;
    const position = owner.eyePosition;
    const velocity = new THREE.Vector3().subVectors(target, position);
    const distance = velocity.length();
    if (distance <= 1e-6) return;
    velocity.y += distance * 0.035;
    velocity.normalize().multiplyScalar(11);
    const visual = new THREE.Group();
    this.visuals.addBox(visual, [0.06, 0.06, 0.55], [0, 0, 0], 0x7c684a);
    visual.position.copy(position);
    this.scene.add(visual);
    const projectile: MobProjectile = {
      id,
      ownerId: owner.id,
      ownerKind: owner.kind,
      visual,
      position,
      velocity,
      ageSeconds: 0,
      damage: owner.definition.attackDamage,
    };
    this.projectiles.set(id, projectile);
    const event: MobProjectileSpawnEvent = {
      projectileId: id,
      ownerId: owner.id,
      position: position.clone(),
      velocity: velocity.clone(),
    };
    context.onProjectileSpawn?.(event);
    this.options.onProjectileSpawn?.(event);
  }

  private updateProjectiles(
    delta: number,
    playerPosition: Readonly<THREE.Vector3> | undefined,
    context: MobUpdateContext,
  ): void {
    for (const projectile of [...this.projectiles.values()]) {
      projectile.ageSeconds += delta;
      if (projectile.ageSeconds > 8) {
        this.removeProjectile(projectile.id);
        continue;
      }
      const previous = projectile.position.clone();
      projectile.velocity.y -= 5.5 * delta;
      const movement = projectile.velocity.clone().multiplyScalar(delta);
      const distance = movement.length();
      const blockHit = distance > 0
        ? this.world.raycast(previous, movement, distance)
        : undefined;
      if (blockHit) {
        this.removeProjectile(projectile.id);
        continue;
      }
      projectile.position.add(movement);
      projectile.visual.position.copy(projectile.position);
      if (projectile.velocity.lengthSq() > 0) {
        projectile.visual.quaternion.setFromUnitVectors(
          PROJECTILE_FORWARD,
          projectile.velocity.clone().normalize(),
        );
      }
      if (playerPosition && this.projectileHitsPlayer(previous, projectile.position, playerPosition)) {
        const source = this.mobsById.get(projectile.ownerId);
        if (source) this.emitPlayerDamage(source, playerPosition, projectile.damage, 'arrow', context);
        else {
          const knockback = projectile.velocity.clone().setY(0).normalize().multiplyScalar(2.4);
          const event: MobPlayerDamageEvent = {
            amount: projectile.damage,
            source: 'arrow',
            mobId: projectile.ownerId,
            mobKind: projectile.ownerKind,
            position: projectile.position.clone(),
            knockback,
          };
          this.pendingPlayerDamage.push(event);
          context.onPlayerDamage?.(event);
          this.options.onPlayerDamage?.(event);
        }
        this.removeProjectile(projectile.id);
      }
    }
  }

  private projectileHitsPlayer(
    from: Readonly<THREE.Vector3>,
    to: Readonly<THREE.Vector3>,
    playerPosition: Readonly<THREE.Vector3>,
  ): boolean {
    const movement = new THREE.Vector3().subVectors(to, from);
    const distance = movement.length();
    if (distance <= 1e-8) return false;
    const ray = new THREE.Ray(new THREE.Vector3(from.x, from.y, from.z), movement.normalize());
    const box = new THREE.Box3(
      new THREE.Vector3(playerPosition.x - 0.32, playerPosition.y, playerPosition.z - 0.32),
      new THREE.Vector3(playerPosition.x + 0.32, playerPosition.y + 1.8, playerPosition.z + 0.32),
    );
    const hit = ray.intersectBox(box, new THREE.Vector3());
    return hit !== null && hit.distanceTo(from) <= distance;
  }

  private emitPlayerDamage(
    mob: MobEntity,
    playerPosition: Readonly<THREE.Vector3>,
    amount: number,
    source: MobPlayerDamageEvent['source'],
    context: MobUpdateContext,
  ): void {
    const knockback = new THREE.Vector3().subVectors(playerPosition, mob.position).setY(0);
    if (knockback.lengthSq() > 0) knockback.normalize().multiplyScalar(source === 'arrow' ? 2.4 : 3.2);
    knockback.y = source === 'melee' ? 1.2 : 0.5;
    const event: MobPlayerDamageEvent = {
      amount,
      source,
      mobId: mob.id,
      mobKind: mob.kind,
      position: mob.position.clone(),
      knockback,
    };
    this.pendingPlayerDamage.push(event);
    context.onPlayerDamage?.(event);
    this.options.onPlayerDamage?.(event);
  }

  private explodeCreeper(mob: MobEntity, context: MobUpdateContext): void {
    const event: MobExplosionEvent = {
      sourceId: mob.id,
      position: mob.position.clone().addScaledVector(UP, mob.definition.height * 0.45),
      radius: 3.5,
      power: 3,
    };
    this.pendingExplosions.push(event);
    context.onExplosion?.(event);
    this.options.onExplosion?.(event);
    this.removeMob(mob, 'explosion');
  }

  private beginDeath(mob: MobEntity): void {
    mob.health = 0;
    mob.velocity.x = 0;
    mob.velocity.z = 0;
    mob.deathSeconds = 0;
    this.changeState(mob, 'die');
  }

  private finishDeath(mob: MobEntity): void {
    if (!mob.deathDropsEmitted) {
      mob.deathDropsEmitted = true;
      this.emitDrops(mob);
    }
    this.removeMob(mob, 'death');
  }

  private emitDrops(mob: MobEntity): void {
    for (const loot of mob.definition.loot) {
      if (loot.chance !== undefined && this.random() > loot.chance) continue;
      const count = loot.min + Math.floor(this.random() * (loot.max - loot.min + 1));
      if (count <= 0) continue;
      const drop: MobDrop = {
        sourceId: mob.id,
        stack: createItemStack(loot.itemId, count),
        position: mob.position.clone().add(new THREE.Vector3(0, 0.3, 0)),
        velocity: new THREE.Vector3(
          (this.random() - 0.5) * 2,
          2 + this.random(),
          (this.random() - 0.5) * 2,
        ),
      };
      this.pendingDrops.push(drop);
      this.options.onDrop?.(drop);
    }
  }

  private changeState(mob: MobEntity, state: MobState): void {
    if (mob.state === state) return;
    mob.state = state;
    mob.stateSeconds = 0;
  }

  private removeMob(mob: MobEntity, reason: MobRemovalReason): void {
    if (!this.mobsById.delete(mob.id)) return;
    mob.visual.removeFromParent();
    this.options.onRemove?.(mob, reason);
  }

  private removeProjectile(id: string): void {
    const projectile = this.projectiles.get(id);
    if (!projectile) return;
    projectile.visual.removeFromParent();
    this.projectiles.delete(id);
  }

  private hasPopulationRoom(disposition: MobDisposition): boolean {
    if (this.mobsById.size >= this.maxMobs) return false;
    const count = this.countByDisposition(disposition);
    return count < (disposition === 'passive' ? this.passiveCap : this.hostileCap);
  }

  private evictFarthestOrOldest(reference: Readonly<THREE.Vector3>): void {
    let selected: MobEntity | undefined;
    let bestScore = -Infinity;
    for (const mob of this.mobsById.values()) {
      const score = mob.position.distanceToSquared(reference) + mob.ageSeconds;
      if (score > bestScore) {
        selected = mob;
        bestScore = score;
      }
    }
    if (selected) this.removeMob(selected, 'capacity');
  }

  private daylightFactor(): number {
    const time = ((this.world.timeOfDay % 24_000) + 24_000) % 24_000;
    if (time < 11_000) return 1;
    if (time < 13_000) return 1 - (time - 11_000) / 2_000 * 0.8;
    if (time < 22_000) return 0.2;
    return 0.2 + (time - 22_000) / 2_000 * 0.8;
  }

  private playerEye(
    playerPosition: Readonly<THREE.Vector3>,
    context: MobUpdateContext,
  ): THREE.Vector3 {
    return context.playerEyePosition
      ? new THREE.Vector3(
        context.playerEyePosition.x,
        context.playerEyePosition.y,
        context.playerEyePosition.z,
      )
      : new THREE.Vector3(playerPosition.x, playerPosition.y + 1.62, playerPosition.z);
  }

  private allocateMobId(requested: string | undefined): string {
    if (requested && !this.mobsById.has(requested)) {
      const numericSuffix = Number(requested.split('-').at(-1));
      if (Number.isFinite(numericSuffix)) this.mobIdCounter = Math.max(this.mobIdCounter, numericSuffix);
      return requested;
    }
    let id: string;
    do {
      this.mobIdCounter += 1;
      id = `mob-${this.mobIdCounter}`;
    } while (this.mobsById.has(id));
    return id;
  }

  private validTuple(tuple: readonly number[]): tuple is readonly [number, number, number] {
    return tuple.length === 3 && tuple.every(Number.isFinite);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('MobManager has been disposed');
  }
}
