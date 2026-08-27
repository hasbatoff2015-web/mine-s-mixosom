import * as THREE from 'three';
import { embedArrow, arrowSupportIntact, releaseEmbeddedArrow, type EmbeddedArrowState } from '../combat/ArrowPhysics';
import { BlockId, getBlockDefinition } from '../blocks';
import { applyArrowDragAndGravity, arrowDamageFromVelocity, inaccurateArrowDirection } from '../combat/ArrowPhysics';
import { applyExtraKnockback, applyKnockback, applyMeleeDrag } from '../combat/CombatSystem';
import { HurtResistance } from '../combat/HurtResistance';
import {
  aabbFromBody,
  aabbOverlapsBlockType,
  FIRE_DAMAGE_INTERVAL_SECONDS,
  hasDirectSkyLight,
  isSunHighEnough,
} from '../combat/fireSources';
import { createItemStack, type ItemStack } from '../inventory';
import { ARROW_FORWARD, ArrowVisualFactory } from '../rendering/ArrowVisualFactory';
import { SharedFireTexture } from '../rendering/fireTexture';
import { applySampledEntityLight, disposeOwnedEntityMaterials, worldDaylightUniform } from '../rendering/worldLighting';
import { combinedLight } from '../world/LightEngine';
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
import { interpolatePose, interpolateVec3, shouldSnapPose } from '../core/entityInterpolation';
import { CHUNK_SIZE, FIXED_DT, GRAVITY, floorDiv } from '../core/constants';
import { VoxelVisualFactory } from './voxelVisuals';

export const MOB_HURT_FLASH_SECONDS = 0.22;
/** Night surface hostile attempts relative to the previous unrestricted rate. */
export const SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR = 0.5;
/** Skip a new cave hostile if another living hostile is already this close. */
export const CAVE_HOSTILE_DENSITY_RADIUS = 12;
/** At most one newly spawned cave hostile per chunk in a single spawn event. */
export const MAX_NEW_CAVE_HOSTILES_PER_CHUNK_EVENT = 1;
const HOSTILE_SPAWN_LIGHT_MAX = 7;
const PASSIVE_SPAWN_LIGHT_MIN = 9;
const CAVE_SPAWN_SKY_MAX = 7;

export function mobHurtFlashIntensity(secondsLeft: number): number {
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return 0;
  return Math.min(1, secondsLeft / MOB_HURT_FLASH_SECONDS);
}

export function applyMobHurtTint(
  rgb: readonly [number, number, number],
  intensity: number,
): [number, number, number] {
  const t = Math.max(0, Math.min(1, intensity));
  return [
    Math.min(1.2, rgb[0] * (1 - t * 0.12) + t * 0.95),
    rgb[1] * (1 - t * 0.82),
    rgb[2] * (1 - t * 0.82),
  ];
}

const HOSTILE_KINDS: readonly MobKind[] = ['zombie', 'skeleton', 'creeper', 'spider'];
const PASSIVE_KINDS: readonly MobKind[] = ['cow', 'pig', 'chicken', 'sheep'];
const UP = new THREE.Vector3(0, 1, 0);
const MAX_SEPARATION_PAIRS = 1_024;

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
  readonly attackerYaw?: number;
  readonly extraKnockbackLevel?: number;
  /** Existing projectile/explosion impulse only; never used for melee. Blocks/s. */
  readonly knockback?: number;
  readonly igniteTicks?: number;
}

export interface MobPlayerDamageEvent {
  readonly amount: number;
  readonly source: 'melee' | 'arrow';
  readonly mobId: string;
  readonly mobKind: MobKind;
  readonly position: THREE.Vector3;
  /** Projectile impulse only. Melee uses the canonical full-hurt transform. */
  readonly knockback?: THREE.Vector3;
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
  /** Test override. Production night surface hostiles use `SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR`. */
  readonly surfaceHostileSpawnFactor?: number;
  readonly caveHostileDensityRadius?: number;
  readonly random?: () => number;
  readonly arrowVisualFactory?: ArrowVisualFactory;
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
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  ageSeconds: number;
  damage: number;
  inGround: boolean;
  embedded?: EmbeddedArrowState;
}

export class MobEntity {
  readonly definition: MobDefinition;
  readonly position: THREE.Vector3;
  readonly previousPosition = new THREE.Vector3();
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
  readonly hurtResistance = new HurtResistance();
  /** Transient melee motion: AI must not replace an airborne hurt impulse. */
  meleeKnockback = false;
  hurtFlashSeconds = 0;
  deathSeconds = 0;
  fuseSeconds = 0;
  burnAccumulator = 0;
  fireDamageTimer = 0;
  farSeconds = 0;
  walkPhase = 0;
  /** AI locomotion intent, never recoil/separation velocity. */
  locomotionSpeed = 0;
  previousWalkPhase = 0;
  facingYaw = 0;
  previousFacingYaw = 0;
  fleeSeconds = 0;
  fireTicks = 0;
  contactBurning = false;
  sunlightBurning = false;
  fireOverlay?: THREE.Mesh;
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
    this.previousPosition.copy(this.position);
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

  get isOnFire(): boolean {
    return this.alive && (this.fireTicks > 0 || this.contactBurning || this.sunlightBurning);
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
  private readonly arrowVisuals: ArrowVisualFactory;
  private readonly ownsArrowVisuals: boolean;
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
  private readonly surfaceHostileSpawnFactor: number;
  private readonly caveHostileDensityRadius: number;
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
    this.surfaceHostileSpawnFactor = Math.max(
      0,
      Math.min(1, options.surfaceHostileSpawnFactor ?? SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR),
    );
    this.caveHostileDensityRadius = Math.max(
      4,
      options.caveHostileDensityRadius ?? CAVE_HOSTILE_DENSITY_RADIUS,
    );
    this.random = options.random ?? Math.random;
    this.arrowVisuals = options.arrowVisualFactory ?? new ArrowVisualFactory();
    this.ownsArrowVisuals = options.arrowVisualFactory === undefined;
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
    this.syncVisual(mob, 0, 1);
    this.applyMobLight(mob);
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

    this.applyBoundedSeparation(delta);

    for (const mob of [...this.mobsById.values()]) {
      mob.previousPosition.copy(mob.position);
      mob.previousFacingYaw = mob.facingYaw;
      mob.previousWalkPhase = mob.walkPhase;
      mob.locomotionSpeed = 0;
      mob.ageSeconds += delta;
      mob.hurtResistance.advance(delta);
      mob.attackCooldownSeconds = Math.max(0, mob.attackCooldownSeconds - delta);
      mob.stateSeconds += delta;
      mob.decisionSeconds -= delta;
      mob.fleeSeconds = Math.max(0, mob.fleeSeconds - delta);

      if (mob.state === 'die') {
        mob.deathSeconds += delta;
        this.snapMobRender(mob);
        if (mob.deathSeconds >= 0.7) this.finishDeath(mob);
        continue;
      }

      if (mob.hurtSeconds > 0) {
        mob.hurtSeconds = Math.max(0, mob.hurtSeconds - delta);
        if (mob.hurtSeconds === 0 && mob.alive) this.changeState(mob, mob.resumeState);
      } else if (!mob.meleeKnockback) {
        this.updateAi(mob, delta, targetPosition, context, daylight);
      }
      if (mob.hurtFlashSeconds > 0) {
        mob.hurtFlashSeconds = Math.max(0, mob.hurtFlashSeconds - delta);
      }

      this.updateBurning(mob, delta, daylight);
      if (!mob.alive) {
        this.snapMobRender(mob);
        continue;
      }
      this.simulateMobPhysics(mob, delta);
      const speed = mob.locomotionSpeed;
      if (speed > 0.05) {
        mob.walkPhase += delta * Math.max(3, speed * 4.5);
      }
      this.snapIfTeleported(mob);
      this.updateDistanceDespawn(mob, delta, playerPosition);
      this.applyMobLight(mob);
    }

    this.updateProjectiles(delta, targetPosition, context);
  }

  /**
   * Render-only interpolation. Gameplay/AI/hitboxes keep using simulation transforms.
   */
  interpolateVisuals(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    for (const mob of this.mobsById.values()) {
      this.syncVisual(mob, 0, t);
    }
    for (const projectile of this.projectiles.values()) {
      const visual = interpolateVec3(
        projectile.previousPosition.x,
        projectile.previousPosition.y,
        projectile.previousPosition.z,
        projectile.position.x,
        projectile.position.y,
        projectile.position.z,
        t,
      );
      projectile.visual.position.set(visual.x, visual.y, visual.z);
    }
  }

  private snapMobRender(mob: MobEntity): void {
    mob.previousPosition.copy(mob.position);
    mob.previousFacingYaw = mob.facingYaw;
    mob.previousWalkPhase = mob.walkPhase;
  }

  private snapIfTeleported(mob: MobEntity): void {
    if (shouldSnapPose(
      { x: mob.previousPosition.x, y: mob.previousPosition.y, z: mob.previousPosition.z, yaw: mob.previousFacingYaw, walkPhase: mob.previousWalkPhase },
      { x: mob.position.x, y: mob.position.y, z: mob.position.z, yaw: mob.facingYaw, walkPhase: mob.walkPhase },
    )) {
      this.snapMobRender(mob);
    }
  }

  /**
   * The hard mob cap keeps this allocation-free pair pass below 1,024 checks.
   * It is intentionally a soft horizontal steering approximation, not rigid-body collision.
   */
  private applyBoundedSeparation(delta: number): void {
    let checked = 0;
    for (const first of this.mobsById.values()) {
      if (!first.alive) continue;
      for (const second of this.mobsById.values()) {
        if (second === first) break;
        if (!second.alive || checked >= MAX_SEPARATION_PAIRS) return;
        checked += 1;
        const verticalOverlap = Math.min(
          first.position.y + first.definition.height,
          second.position.y + second.definition.height,
        ) - Math.max(first.position.y, second.position.y);
        if (verticalOverlap <= 0) continue;
        const dx = first.position.x - second.position.x;
        const dz = first.position.z - second.position.z;
        const minimumDistance = (first.definition.width + second.definition.width) * 0.48;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared >= minimumDistance * minimumDistance) continue;
        const distance = Math.sqrt(distanceSquared);
        const directionX = distance > 1e-5 ? dx / distance : (first.id < second.id ? -1 : 1);
        const directionZ = distance > 1e-5 ? dz / distance : 0;
        const impulse = Math.min(1.8, (minimumDistance - distance) * 7.5) * delta;
        first.velocity.x += directionX * impulse;
        first.velocity.z += directionZ * impulse;
        second.velocity.x -= directionX * impulse;
        second.velocity.z -= directionZ * impulse;
      }
    }
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
    const hurt = mob.hurtResistance.receive(amount);
    if (!hurt.accepted) return false;
    mob.health = Math.max(0, mob.health - hurt.rawDamage);
    mob.resumeState = mob.definition.disposition === 'hostile' ? 'chase' : 'wander';
    if (damageOptions.attackerPosition) {
      const dx = mob.position.x - damageOptions.attackerPosition.x;
      const dz = mob.position.z - damageOptions.attackerPosition.z;
      const length = Math.hypot(dx, dz);
      const nx = length > 1e-8 ? dx / length : 1;
      const nz = length > 1e-8 ? dz / length : 0;
      if (hurt.fullHurt) {
        if (damageOptions.source === 'projectile' || damageOptions.source === 'explosion') {
          const impulse = Math.max(0, damageOptions.knockback ?? 3.2);
          mob.velocity.x += nx * impulse;
          mob.velocity.z += nz * impulse;
          mob.velocity.y = Math.max(mob.velocity.y, 3.2);
        } else {
          applyKnockback(mob.velocity, { x: dx, z: dz });
          mob.meleeKnockback = true;
        }
      }
      mob.wanderDirection.set(nx, 0, nz);
      mob.fleeSeconds = mob.definition.disposition === 'passive' ? 3 : 0;
    }
    if (damageOptions.source === 'player') {
      applyExtraKnockback(mob.velocity, damageOptions.attackerYaw ?? 0, damageOptions.extraKnockbackLevel ?? 0);
      if ((damageOptions.extraKnockbackLevel ?? 0) > 0) mob.meleeKnockback = true;
    }
    if (damageOptions.igniteTicks) {
      mob.fireTicks = Math.max(mob.fireTicks, damageOptions.igniteTicks);
    }
    if (mob.health <= 0) {
      if (hurt.fullHurt && damageOptions.source !== 'fire') {
        mob.hurtFlashSeconds = MOB_HURT_FLASH_SECONDS;
        this.applyMobLight(mob);
      }
      this.beginDeath(mob);
    } else if (hurt.fullHurt && damageOptions.source !== 'fire') {
      mob.locomotionSpeed = 0;
      // Periodic fire/sunlight DOT must not stun-lock AI (creeper fuse, chase).
      mob.hurtSeconds = 0.28;
      mob.hurtFlashSeconds = MOB_HURT_FLASH_SECONDS;
      this.changeState(mob, 'hurt');
      this.applyMobLight(mob);
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
    reach = 3,
  ): MobRaycastHit | undefined {
    const hit = this.raycast(origin, direction, reach);
    if (!hit) return undefined;
    this.damage(hit.mob, damage, { source: 'player', attackerPosition: origin });
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
    return THREE.MathUtils.clamp(
      Math.round(combinedLight(
        this.world,
        Math.floor(position.x),
        Math.floor(position.y),
        Math.floor(position.z),
        daylight,
      )),
      0,
      15,
    );
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
    if (this.ownsArrowVisuals) this.arrowVisuals.dispose();
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
    if (horizontal.lengthSq() > 1e-8) mob.facingYaw = Math.atan2(horizontal.x, horizontal.z) + Math.PI;

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
      if (distance < 5) this.steerToward(mob, horizontal.multiplyScalar(-1), mob.definition.speed, false);
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
      const groundedBeforeMove = mob.onGround;
      const sampled = getBlockDefinition(this.world.getBlock(
        Math.floor(mob.position.x),
        Math.floor(mob.position.y + mob.definition.height * 0.5),
        Math.floor(mob.position.z),
      ));
      if (sampled.liquid) {
        mob.meleeKnockback = false;
        mob.velocity.y += 4.5 * step;
        mob.velocity.multiplyScalar(Math.exp(-2.8 * step));
        if (sampled.id === BlockId.Lava) {
          mob.fireTicks = Math.max(mob.fireTicks, 60);
        }
      } else if (!mob.meleeKnockback) {
        mob.velocity.y -= 20 * step;
      }
      const web = this.world.getBlock(
        Math.floor(mob.position.x),
        Math.floor(mob.position.y + 0.5),
        Math.floor(mob.position.z),
        false,
      );
      if (web === BlockId.Cobweb) {
        mob.velocity.multiplyScalar(0.15);
      }
      const result = moveVoxelBody(
        this.world,
        mob.position,
        mob.velocity,
        step,
        { width: mob.definition.width, height: mob.definition.height },
        { stepHeight: 1.05 },
      );
      mob.onGround = result.onGround;
      if (result.hitY || result.stepped) mob.velocity.y = 0;
      if (result.hitX) {
        mob.velocity.x = 0;
        if (!result.stepped) mob.wanderDirection.x *= -1;
      }
      if (result.hitZ) {
        mob.velocity.z = 0;
        if (!result.stepped) mob.wanderDirection.z *= -1;
      }
      if (mob.meleeKnockback) {
        // 1.8 living travel: move first, then gravity/drag. Ground friction is
        // ordinary block slipperiness 0.6 * 0.91; no second velocity conversion.
        applyMeleeDrag(mob.velocity, groundedBeforeMove, step);
        if (!result.hitY && !result.stepped) {
          mob.velocity.y = (mob.velocity.y - GRAVITY * step) * Math.pow(0.98, step / FIXED_DT);
        }
        if (result.onGround && mob.velocity.y <= 0) mob.meleeKnockback = false;
      }
    }
  }

  private updateBurning(
    mob: MobEntity,
    delta: number,
    daylight: number,
  ): void {
    const box = aabbFromBody(
      mob.position.x, mob.position.y, mob.position.z,
      mob.definition.width, mob.definition.height,
    );
    const inWater = aabbOverlapsBlockType(this.world, box, BlockId.Water);
    mob.contactBurning = aabbOverlapsBlockType(this.world, box, BlockId.Fire);
    if (inWater) {
      mob.fireTicks = 0;
      mob.sunlightBurning = false;
    } else {
      const skyX = Math.floor(mob.position.x);
      const skyY = Math.floor(mob.position.y + mob.definition.height * 0.9);
      const skyZ = Math.floor(mob.position.z);
      mob.sunlightBurning = isHostileMob(mob.kind)
        && isSunHighEnough(daylight)
        && hasDirectSkyLight(this.world, skyX, skyY, skyZ);
    }
    if (mob.fireTicks > 0) {
      mob.fireTicks = Math.max(0, mob.fireTicks - Math.round(delta * 20));
    }
    if (mob.isOnFire) {
      mob.fireDamageTimer += delta;
      if (mob.fireDamageTimer >= FIRE_DAMAGE_INTERVAL_SECONDS) {
        mob.fireDamageTimer = 0;
        this.damage(mob, 1, { source: 'fire' });
      }
    } else {
      mob.fireDamageTimer = 0;
      mob.burnAccumulator = 0;
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

  private syncVisual(mob: MobEntity, _delta: number, alpha = 1): void {
    const pose = interpolatePose(
      {
        x: mob.previousPosition.x,
        y: mob.previousPosition.y,
        z: mob.previousPosition.z,
        yaw: mob.previousFacingYaw,
        walkPhase: mob.previousWalkPhase,
      },
      {
        x: mob.position.x,
        y: mob.position.y,
        z: mob.position.z,
        yaw: mob.facingYaw,
        walkPhase: mob.walkPhase,
      },
      alpha,
    );
    const speed = mob.locomotionSpeed;
    const walkPhase = pose.walkPhase;
    const swing = Math.sin(walkPhase) * Math.min(0.65, speed * 0.22);
    mob.visual.rotation.y = pose.yaw;
    if (mob.kind === 'spider') {
      mob.model.legs.forEach((leg, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const pair = Math.floor(index / 2);
        const phase = Math.sin(walkPhase + pair * 0.85) * Math.min(1, speed);
        leg.rotation.x = Number(leg.userData.baseRotationX ?? 0);
        leg.rotation.y = Number(leg.userData.baseRotationY ?? 0) - phase * 0.18 * side;
        leg.rotation.z = Number(leg.userData.baseRotationZ ?? 0)
          - Math.abs(Math.cos(walkPhase + pair * 0.7)) * 0.08 * side * Math.min(1, speed);
      });
    } else {
      mob.model.legs.forEach((leg, index) => {
        leg.rotation.x = Number(leg.userData.baseRotationX ?? 0)
          + swing * (mob.model.legSwingSigns[index] ?? (index % 2 === 0 ? 1 : -1));
        leg.rotation.y = Number(leg.userData.baseRotationY ?? 0);
        leg.rotation.z = Number(leg.userData.baseRotationZ ?? 0);
      });
    }
    if (mob.kind === 'chicken') {
      const visualAge = mob.ageSeconds - FIXED_DT * (1 - alpha);
      const flap = Math.sin(visualAge * (speed > 0.1 ? 14 : 4)) * (speed > 0.1 ? 0.35 : 0.08);
      mob.model.wings.forEach((wing, index) => {
        wing.rotation.x = Number(wing.userData.baseRotationX ?? 0);
        wing.rotation.y = Number(wing.userData.baseRotationY ?? 0);
        wing.rotation.z = Number(wing.userData.baseRotationZ ?? 0) + (index === 0 ? flap : -flap);
      });
    }
    if (mob.kind === 'zombie') {
      const poseArms = mob.state === 'attack' ? 1.55 : 1.2;
      mob.model.arms.forEach((arm, index) => {
        arm.rotation.x = Number(arm.userData.baseRotationX ?? 0)
          + poseArms + (index % 2 === 0 ? swing : -swing) * 0.25;
        arm.rotation.y = Number(arm.userData.baseRotationY ?? 0);
        arm.rotation.z = Number(arm.userData.baseRotationZ ?? 0);
      });
    } else if (mob.kind === 'skeleton') {
      mob.model.arms.forEach((arm, index) => {
        arm.rotation.x = Number(arm.userData.baseRotationX ?? 0) + (mob.state === 'attack'
          ? -1.15
          : (index % 2 === 0 ? swing : -swing) * 0.5);
        arm.rotation.y = Number(arm.userData.baseRotationY ?? 0);
        arm.rotation.z = Number(arm.userData.baseRotationZ ?? 0);
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
    mob.visual.position.set(pose.x + hurtJolt, pose.y, pose.z);
    this.syncFireOverlay(mob);
  }

  private syncFireOverlay(mob: MobEntity): void {
    if (mob.isOnFire) {
      if (!mob.fireOverlay) {
        mob.fireOverlay = SharedFireTexture.instance().createScaledOverlay(
          mob.definition.width,
          mob.definition.height,
        );
        mob.visual.add(mob.fireOverlay);
      }
      mob.fireOverlay.visible = true;
      mob.fireOverlay.rotation.y = -mob.visual.rotation.y;
    } else if (mob.fireOverlay) {
      mob.fireOverlay.visible = false;
    }
  }

  private applyMobLight(mob: MobEntity): void {
    const sample = applySampledEntityLight(
      mob.visual,
      this.world,
      mob.position.x,
      mob.position.y,
      mob.position.z,
      mob.definition.height,
      worldDaylightUniform.value,
    );
    const flash = mobHurtFlashIntensity(mob.hurtFlashSeconds);
    if (flash <= 0) return;
    const tinted = applyMobHurtTint(sample.rgb, flash);
    const light = mob.visual.userData.entityLight as THREE.Vector3 | undefined;
    if (light instanceof THREE.Vector3) light.set(tinted[0], tinted[1], tinted[2]);
  }

  private steerToward(mob: MobEntity, direction: Readonly<THREE.Vector3>, speed: number, faceMovement = true): void {
    const length = Math.hypot(direction.x, direction.z);
    if (length <= 1e-6) return;
    mob.locomotionSpeed = speed;
    if (faceMovement) mob.facingYaw = Math.atan2(direction.x, direction.z) + Math.PI;
    mob.velocity.x = direction.x / length * speed;
    mob.velocity.z = direction.z / length * speed;
  }

  private tryAutomaticSpawn(
    playerPosition: Readonly<THREE.Vector3>,
    daylight: number,
    customLight: MobUpdateContext['lightLevelAt'],
  ): void {
    const hostileRoom = this.hasPopulationRoom('hostile');
    const passiveRoom = this.hasPopulationRoom('passive');
    if (!hostileRoom && !passiveRoom) return;

    const preferHostile = hostileRoom && (daylight < 0.45 || !passiveRoom || this.random() < 0.22);
    if (!preferHostile) {
      this.tryPassiveSpawn(playerPosition, daylight, customLight);
      return;
    }

    const allowSurfaceHostile = daylight < 0.45 && this.random() < this.surfaceHostileSpawnFactor;
    const usedChunksThisEvent = new Set<string>();
    let spawnedCave = 0;
    let spawnedSurface = false;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sample = this.randomSpawnColumn(playerPosition);
      if (!sample) continue;

      if (
        spawnedCave < MAX_NEW_CAVE_HOSTILES_PER_CHUNK_EVENT
        && this.tryCaveHostileSpawn(sample, playerPosition, daylight, customLight, usedChunksThisEvent)
      ) {
        spawnedCave += 1;
      }

      if (
        allowSurfaceHostile
        && !spawnedSurface
        && !usedChunksThisEvent.has(sample.chunkKey)
        && this.trySurfaceHostileSpawn(sample, daylight, customLight)
      ) {
        usedChunksThisEvent.add(sample.chunkKey);
        spawnedSurface = true;
      }

      if (
        (spawnedCave > 0 || !this.hasPopulationRoom('hostile'))
        && (spawnedSurface || !allowSurfaceHostile)
      ) {
        return;
      }
    }
  }

  private tryPassiveSpawn(
    playerPosition: Readonly<THREE.Vector3>,
    daylight: number,
    customLight: MobUpdateContext['lightLevelAt'],
  ): MobEntity | undefined {
    if (!this.hasPopulationRoom('passive')) return undefined;
    const kind = PASSIVE_KINDS[Math.floor(this.random() * PASSIVE_KINDS.length)] ?? PASSIVE_KINDS[0]!;
    const definition = getMobDefinition(kind);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sample = this.randomSpawnColumn(playerPosition);
      if (!sample) continue;
      const y = sample.surfaceY + 1;
      const position = new THREE.Vector3(sample.x + 0.5, y, sample.z + 0.5);
      if (!this.spawnPositionIsValid(position, definition, 'passive')) continue;
      const light = customLight?.(position) ?? this.getApproximateLight(position, daylight);
      if (light < PASSIVE_SPAWN_LIGHT_MIN) continue;
      return this.spawn(kind, position);
    }
    return undefined;
  }

  private randomSpawnColumn(playerPosition: Readonly<THREE.Vector3>): {
    x: number;
    z: number;
    surfaceY: number;
    chunkKey: string;
  } | undefined {
    const angle = this.random() * Math.PI * 2;
    const distance = this.minimumSpawnDistance
      + this.random() * (this.maximumSpawnDistance - this.minimumSpawnDistance);
    const x = Math.floor(playerPosition.x + Math.cos(angle) * distance);
    const z = Math.floor(playerPosition.z + Math.sin(angle) * distance);
    const dx = (x + 0.5) - playerPosition.x;
    const dz = (z + 0.5) - playerPosition.z;
    if (dx * dx + dz * dz < this.minimumSpawnDistance * this.minimumSpawnDistance) return undefined;
    return {
      x,
      z,
      surfaceY: this.world.surfaceY(x, z),
      chunkKey: `${floorDiv(x, CHUNK_SIZE)},${floorDiv(z, CHUNK_SIZE)}`,
    };
  }

  private tryCaveHostileSpawn(
    sample: { x: number; z: number; surfaceY: number; chunkKey: string },
    playerPosition: Readonly<THREE.Vector3>,
    daylight: number,
    customLight: MobUpdateContext['lightLevelAt'],
    caveChunksThisEvent: Set<string>,
  ): boolean {
    if (!this.hasPopulationRoom('hostile')) return false;
    if (caveChunksThisEvent.has(sample.chunkKey)) return false;
    if (sample.surfaceY <= 8) return false;
    if (this.chunkHasLivingHostile(sample.chunkKey)) return false;
    const y = this.findCaveSpawnY(sample.x, sample.z, sample.surfaceY);
    if (y === undefined) return false;
    const position = new THREE.Vector3(sample.x + 0.5, y, sample.z + 0.5);
    const distX = position.x - playerPosition.x;
    const distZ = position.z - playerPosition.z;
    if (distX * distX + distZ * distZ < this.minimumSpawnDistance * this.minimumSpawnDistance) {
      return false;
    }
    if (this.hostileCountNear(position.x, position.z, this.caveHostileDensityRadius) > 0) return false;
    const kind = HOSTILE_KINDS[Math.floor(this.random() * HOSTILE_KINDS.length)] ?? HOSTILE_KINDS[0]!;
    const definition = getMobDefinition(kind);
    if (!this.spawnPositionIsValid(position, definition, 'hostile')) return false;
    if (!this.caveSpawnEnvironmentOk(position)) return false;
    const light = customLight?.(position) ?? this.getApproximateLight(position, daylight);
    if (light > HOSTILE_SPAWN_LIGHT_MAX) return false;
    if (!this.spawn(kind, position)) return false;
    caveChunksThisEvent.add(sample.chunkKey);
    return true;
  }

  private trySurfaceHostileSpawn(
    sample: { x: number; z: number; surfaceY: number },
    daylight: number,
    customLight: MobUpdateContext['lightLevelAt'],
  ): boolean {
    if (!this.hasPopulationRoom('hostile')) return false;
    const kind = HOSTILE_KINDS[Math.floor(this.random() * HOSTILE_KINDS.length)] ?? HOSTILE_KINDS[0]!;
    const definition = getMobDefinition(kind);
    const position = new THREE.Vector3(sample.x + 0.5, sample.surfaceY + 1, sample.z + 0.5);
    if (!this.spawnPositionIsValid(position, definition, 'hostile')) return false;
    if (this.world.skyLightAt(sample.x, Math.floor(position.y), sample.z) < 8) return false;
    const light = customLight?.(position) ?? this.getApproximateLight(position, daylight);
    if (light > HOSTILE_SPAWN_LIGHT_MAX) return false;
    return this.spawn(kind, position) !== undefined;
  }

  private findCaveSpawnY(
    x: number,
    z: number,
    surfaceY: number,
  ): number | undefined {
    const minY = 4;
    const maxY = Math.max(minY, surfaceY - 6);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const y = minY + Math.floor(this.random() * Math.max(1, maxY - minY + 1));
      if (y >= surfaceY - 4) continue;
      if (!this.caveColumnLooksSpawnable(x, y, z)) continue;
      return y;
    }
    return undefined;
  }

  private caveColumnLooksSpawnable(x: number, y: number, z: number): boolean {
    const below = this.world.getBlock(x, y - 1, z);
    const belowDefinition = getBlockDefinition(below);
    if (!belowDefinition.solid || belowDefinition.liquid) return false;
    if (this.bodyTouchesLiquid(x + 0.5, y, z + 0.5, 1.8)) return false;
    if (this.world.getBlock(x, y, z) !== BlockId.Air) return false;
    if (this.world.getBlock(x, y + 1, z) !== BlockId.Air) return false;
    if (hasDirectSkyLight(this.world, x, y, z)) return false;
    if (this.world.skyLightAt(x, y, z) > CAVE_SPAWN_SKY_MAX) return false;
    return true;
  }

  private caveSpawnEnvironmentOk(position: Readonly<THREE.Vector3>): boolean {
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);
    return this.caveColumnLooksSpawnable(x, y, z);
  }

  private spawnPositionIsValid(
    position: Readonly<THREE.Vector3>,
    definition: MobDefinition,
    disposition: MobDisposition,
  ): boolean {
    if (!isSpaceClear(this.world, position, definition)) return false;
    if (this.bodyTouchesLiquid(position.x, position.y, position.z, definition.height)) return false;
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

  private bodyTouchesLiquid(x: number, y: number, z: number, height: number): boolean {
    const minX = Math.floor(x - 0.3);
    const maxX = Math.floor(x + 0.3);
    const minZ = Math.floor(z - 0.3);
    const maxZ = Math.floor(z + 0.3);
    const minY = Math.floor(y);
    const maxY = Math.floor(y + height - 0.01);
    for (let by = minY; by <= maxY; by += 1) {
      for (let bz = minZ; bz <= maxZ; bz += 1) {
        for (let bx = minX; bx <= maxX; bx += 1) {
          if (this.world.isLiquid(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  private hostileCountNear(x: number, z: number, radius: number): number {
    const radiusSq = radius * radius;
    let count = 0;
    for (const mob of this.mobsById.values()) {
      if (!mob.alive || mob.definition.disposition !== 'hostile') continue;
      const dx = mob.position.x - x;
      const dz = mob.position.z - z;
      if (dx * dx + dz * dz <= radiusSq) count += 1;
    }
    return count;
  }

  private chunkHasLivingHostile(chunkKey: string): boolean {
    for (const mob of this.mobsById.values()) {
      if (!mob.alive || mob.definition.disposition !== 'hostile') continue;
      const key = `${floorDiv(Math.floor(mob.position.x), CHUNK_SIZE)},${floorDiv(Math.floor(mob.position.z), CHUNK_SIZE)}`;
      if (key === chunkKey) return true;
    }
    return false;
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
    const aim = new THREE.Vector3().subVectors(target, position);
    const distance = aim.length();
    if (distance <= 1e-6) return;
    aim.y += distance * 0.025;
    const velocity = inaccurateArrowDirection(aim, this.random, 0.028).multiplyScalar(1.6);
    const visual = this.arrowVisuals.create();
    visual.position.copy(position);
    visual.quaternion.setFromUnitVectors(ARROW_FORWARD, velocity.clone().normalize());
    this.scene.add(visual);
    const projectile: MobProjectile = {
      id,
      ownerId: owner.id,
      ownerKind: owner.kind,
      visual,
      position,
      previousPosition: position.clone(),
      velocity,
      ageSeconds: 0,
      damage: owner.definition.attackDamage,
      inGround: false,
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
      projectile.previousPosition.copy(projectile.position);
      projectile.ageSeconds += delta;
      if (projectile.ageSeconds > 8) {
        this.removeProjectile(projectile.id);
        continue;
      }
      if (projectile.inGround) {
        if (!projectile.embedded || arrowSupportIntact(this.world, projectile.embedded)) continue;
        releaseEmbeddedArrow(projectile.velocity, projectile.embedded, this.random);
        projectile.embedded = undefined;
        projectile.inGround = false;
      }
      const previous = projectile.position.clone();
      const movement = projectile.velocity.clone();
      const distance = movement.length();
      const blockHit = distance > 0
        ? this.world.raycast(previous, movement.clone().normalize(), distance)
        : undefined;
      if (blockHit) {
        projectile.embedded = embedArrow(blockHit, projectile.velocity);
        projectile.position.addScaledVector(movement.clone().normalize(), Math.max(0, blockHit.distance - 0.035));
        projectile.visual.position.copy(projectile.position);
        applySampledEntityLight(
          projectile.visual,
          this.world,
          projectile.position.x,
          projectile.position.y,
          projectile.position.z,
          0.25,
          worldDaylightUniform.value,
        );
        projectile.velocity.set(0, 0, 0);
        projectile.inGround = true;
        continue;
      }
      projectile.position.add(movement);
      const inWater = this.world.getBlock(
        Math.floor(projectile.position.x), Math.floor(projectile.position.y), Math.floor(projectile.position.z),
      ) === BlockId.Water;
      applyArrowDragAndGravity(projectile.velocity, inWater);
      projectile.visual.position.copy(projectile.position);
      applySampledEntityLight(
        projectile.visual,
        this.world,
        projectile.position.x,
        projectile.position.y,
        projectile.position.z,
        0.25,
        worldDaylightUniform.value,
      );
      if (projectile.velocity.lengthSq() > 0) {
        projectile.visual.quaternion.setFromUnitVectors(
          ARROW_FORWARD,
          projectile.velocity.clone().normalize(),
        );
      }
      if (playerPosition && this.projectileHitsPlayer(previous, projectile.position, playerPosition)) {
        const source = this.mobsById.get(projectile.ownerId);
        const damage = Math.max(projectile.damage, arrowDamageFromVelocity(projectile.velocity));
        if (source) this.emitPlayerDamage(source, playerPosition, damage, 'arrow', context);
        else {
          const knockback = projectile.velocity.clone().setY(0).normalize().multiplyScalar(2.4);
          const event: MobPlayerDamageEvent = {
            amount: damage,
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
    // Projectile impulse is deliberately unchanged by the melee migration.
    const knockback = source === 'arrow'
      ? new THREE.Vector3().subVectors(playerPosition, mob.position).setY(0).normalize().multiplyScalar(2.4).setY(0.5)
      : undefined;
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
    if (mob.fireOverlay) {
      mob.fireOverlay.removeFromParent();
      mob.fireOverlay.geometry.dispose();
      mob.fireOverlay = undefined;
    }
    disposeOwnedEntityMaterials(mob.visual);
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
