import * as THREE from 'three';
import { BlockId } from '../blocks';
import { ItemId } from '../items';
import type { PlayerAABB } from '../player';
import type { MobManager } from '../entities';
import type { MinecartEntity, MinecartManager } from '../entities/MinecartManager';
import type { ArrowVisualFactory } from '../rendering/ArrowVisualFactory';
import type { VoxelWorld } from '../world/World';
import { interpolateVec3 } from '../core/entityInterpolation';
import type { EntityHost } from '../entities/EntityHost';
import { isEntityHost } from '../entities/EntityHost';
import { resolveEntityHost } from '../entities/resolveEntityHost';
import { applyArrowDragAndGravity, arrowDamageFromVelocity, inaccurateArrowDirection } from './ArrowPhysics';
import { FIRE_ARROW_IGNITE_TICKS } from './fireArrow';
import { embedArrow, arrowSupportIntact, releaseEmbeddedArrow, type EmbeddedArrowState } from './ArrowPhysics';
import { systemRandomFn } from '../gameplay/random';
import { rayAabbDistance } from '../world/collision';

interface PlayerArrow {
  readonly id: string;
  readonly ownerId?: string;
  readonly position: THREE.Vector3;
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly visual?: THREE.Object3D;
  age: number;
  critical: boolean;
  inGround: boolean;
  embedded?: EmbeddedArrowState;
  flaming: boolean;
  pickupDelay: number;
}

export interface ArrowPlayerTarget {
  readonly id: string;
  readonly aabb: PlayerAABB;
}

export interface ArrowTickOptions {
  readonly players?: readonly ArrowPlayerTarget[];
  readonly onPlayerHit?: (
    playerId: string,
    damage: number,
    flaming: boolean,
    position: THREE.Vector3,
  ) => void;
}

/** Prefer a cart over a rail/block that is only slightly closer (cart sits on the rail). */
const CART_BLOCK_SLOP = 0.5;
/** Flying arrows keep the existing short lifetime; in-ground player arrows last ~Java 1.8 60 s. */
export const ARROW_FLYING_LIFETIME_SECONDS = 8;
export const ARROW_GROUND_LIFETIME_SECONDS = 60;
export const ARROW_PICKUP_DELAY_SECONDS = 0.25;
const ARROW_PICKUP_SIZE = 0.5;
const ARROW_PICKUP_PADDING = 0.2;

export class PlayerArrowManager {
  private readonly arrows: PlayerArrow[] = [];
  private readonly host: EntityHost;
  private readonly ownsHost: boolean;
  private readonly random: () => number;
  private idCounter = 0;

  constructor(
    sceneOrHost: THREE.Object3D | EntityHost,
    private readonly world: VoxelWorld,
    private readonly mobs: MobManager,
    options: {
      readonly visualFactory?: ArrowVisualFactory;
      readonly random?: () => number;
      readonly minecarts?: MinecartManager;
      readonly onBlockHit?: (x: number, y: number, z: number, flaming: boolean) => void;
      readonly onMobHit?: (accepted: boolean, position: THREE.Vector3) => void;
      readonly onMinecartHit?: (cart: MinecartEntity, flaming: boolean) => void;
      readonly onSpawn?: (id: string) => void;
      readonly onRemove?: (id: string) => void;
    } = {},
  ) {
    this.ownsHost = !isEntityHost(sceneOrHost);
    this.host = resolveEntityHost(sceneOrHost, {
      arrowVisuals: options.visualFactory,
      ownsArrowVisuals: options.visualFactory ? false : undefined,
    });
    this.random = options.random ?? systemRandomFn;
    this.minecarts = options.minecarts;
    this.onBlockHit = options.onBlockHit;
    this.onMobHit = options.onMobHit;
    this.onMinecartHit = options.onMinecartHit;
    this.onSpawn = options.onSpawn;
    this.onRemove = options.onRemove;
  }

  private readonly minecarts?: MinecartManager;
  private readonly onBlockHit?: (x: number, y: number, z: number, flaming: boolean) => void;
  private readonly onMobHit?: (accepted: boolean, position: THREE.Vector3) => void;
  private readonly onMinecartHit?: (cart: MinecartEntity, flaming: boolean) => void;
  private readonly onSpawn?: (id: string) => void;
  private readonly onRemove?: (id: string) => void;

  get count(): number {
    return this.arrows.length;
  }

  get entities(): readonly PlayerArrow[] {
    return this.arrows;
  }

  spawn(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speedBlocksPerTick: number,
    _damage: number,
    critical: boolean,
    flaming = false,
    id?: string,
    ownerId?: string,
  ): void {
    if (this.arrows.length >= 48) this.remove(0);
    const velocity = inaccurateArrowDirection(direction, this.random).multiplyScalar(speedBlocksPerTick);
    const visual = this.host.createArrow(flaming) as THREE.Object3D | undefined;
    if (visual) {
      this.host.setPosition(visual, origin.x, origin.y, origin.z);
      this.host.orientArrow(visual, velocity.x, velocity.y, velocity.z);
      this.host.attach(visual);
    }
    this.arrows.push({
      id: id ?? `arrow-${this.idCounter += 1}`,
      ownerId,
      position: origin.clone(),
      previousPosition: origin.clone(),
      velocity,
      visual,
      age: 0,
      critical,
      inGround: false,
      flaming,
      pickupDelay: ARROW_PICKUP_DELAY_SECONDS,
    });
    this.onSpawn?.(this.arrows[this.arrows.length - 1]!.id);
  }

  applyNetwork(
    id: string,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    flaming: boolean,
    options?: { readonly snapVisual?: boolean },
  ): void {
    const existing = this.arrows.find((arrow) => arrow.id === id);
    if (existing) {
      existing.previousPosition.copy(existing.position);
      existing.position.set(x, y, z);
      existing.velocity.set(vx, vy, vz);
      existing.flaming = flaming;
      if (options?.snapVisual !== false) this.syncArrowVisual(existing);
      return;
    }
    const speed = Math.hypot(vx, vy, vz) || 1;
    this.spawn(new THREE.Vector3(x, y, z), new THREE.Vector3(vx, vy, vz), speed, 0, false, flaming, id);
    const created = this.arrows[this.arrows.length - 1];
    if (created && created.id === id) {
      created.velocity.set(vx, vy, vz);
      created.position.set(x, y, z);
      created.previousPosition.set(x, y, z);
      this.syncArrowVisual(created);
    }
  }

  applyRenderPose(id: string, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const arrow = this.arrows.find((entry) => entry.id === id);
    if (!arrow) return;
    const speedSq = vx * vx + vy * vy + vz * vz;
    if (speedSq > 1e-8) arrow.velocity.set(vx, vy, vz);
    if (arrow.visual) {
      this.host.setPosition(arrow.visual, x, y, z);
      this.host.orientArrow(arrow.visual, arrow.velocity.x, arrow.velocity.y, arrow.velocity.z);
    }
  }

  removeById(id: string): void {
    const index = this.arrows.findIndex((arrow) => arrow.id === id);
    if (index >= 0) this.remove(index);
  }

  retain(ids: ReadonlySet<string>): void {
    for (let index = this.arrows.length - 1; index >= 0; index -= 1) {
      if (!ids.has(this.arrows[index]!.id)) this.remove(index);
    }
  }

  tick(dt: number, options: ArrowTickOptions = {}): void {
    const tickSteps = Math.max(1, Math.round(dt * 20));
    for (let index = this.arrows.length - 1; index >= 0; index -= 1) {
      const arrow = this.arrows[index]!;
      arrow.previousPosition.copy(arrow.position);
      arrow.age += dt;
      const lifetime = arrow.inGround ? ARROW_GROUND_LIFETIME_SECONDS : ARROW_FLYING_LIFETIME_SECONDS;
      if (arrow.age > lifetime) {
        this.remove(index);
        continue;
      }
      if (arrow.inGround) {
        arrow.pickupDelay = Math.max(0, arrow.pickupDelay - dt);
        if (!arrow.embedded || arrowSupportIntact(this.world, arrow.embedded)) continue;
        releaseEmbeddedArrow(arrow.velocity, arrow.embedded, this.random);
        arrow.embedded = undefined;
        arrow.inGround = false;
        arrow.pickupDelay = ARROW_PICKUP_DELAY_SECONDS;
        arrow.age = 0;
      }
      let removed = false;
      for (let step = 0; step < tickSteps; step += 1) {
        const movement = arrow.velocity.clone();
        const distance = movement.length();
        if (distance <= 1e-8) {
          applyArrowDragAndGravity(arrow.velocity, this.world.getBlock(
            Math.floor(arrow.position.x), Math.floor(arrow.position.y), Math.floor(arrow.position.z), false,
          ) === BlockId.Water);
          continue;
        }
        const direction = movement.clone().multiplyScalar(1 / distance);
        const blockHit = this.world.raycast(arrow.position, direction, distance, { geometry: 'collision' });
        const mobHit = this.mobs.raycast(arrow.position, direction, distance);
        const cartHit = this.minecarts?.raycast(arrow.position, direction, distance);
        const playerHit = this.raycastPlayers(arrow, direction, distance, options.players);
        const livingDistance = Math.min(
          mobHit?.distance ?? Infinity,
          playerHit?.distance ?? Infinity,
        );
        const cartCloser = cartHit && livingDistance >= cartHit.distance
          && (!blockHit || cartHit.distance <= blockHit.distance + CART_BLOCK_SLOP);
        if (cartCloser && cartHit) {
          this.onMinecartHit?.(cartHit.cart, arrow.flaming);
          this.remove(index);
          removed = true;
          break;
        }
        const playerCloser = playerHit && (!mobHit || playerHit.distance <= mobHit.distance)
          && (!blockHit || playerHit.distance < blockHit.distance);
        if (playerCloser && playerHit) {
          options.onPlayerHit?.(
            playerHit.id,
            arrowDamageFromVelocity(arrow.velocity, arrow.critical),
            arrow.flaming,
            arrow.position,
          );
          this.remove(index);
          removed = true;
          break;
        }
        if (mobHit && (!blockHit || mobHit.distance < blockHit.distance)) {
          const accepted = this.mobs.damage(mobHit.mob, arrowDamageFromVelocity(arrow.velocity, arrow.critical), {
            source: 'projectile',
            attackerPosition: arrow.position,
            knockback: arrow.critical ? 4.2 : 2.4,
            ...(arrow.flaming ? { igniteTicks: FIRE_ARROW_IGNITE_TICKS } : {}),
          });
          this.onMobHit?.(accepted, arrow.position);
          this.remove(index);
          removed = true;
          break;
        }
        if (blockHit) {
          arrow.embedded = embedArrow(blockHit, arrow.velocity);
          arrow.position.addScaledVector(direction, Math.max(0, blockHit.distance - 0.035));
          arrow.inGround = true;
          arrow.pickupDelay = ARROW_PICKUP_DELAY_SECONDS;
          arrow.age = 0;
          arrow.velocity.set(0, 0, 0);
          arrow.previousPosition.copy(arrow.position);
          this.syncArrowVisual(arrow);
          this.onBlockHit?.(blockHit.x, blockHit.y, blockHit.z, arrow.flaming);
          this.applyArrowLight(arrow);
          break;
        }
        arrow.position.add(movement);
        const cell = this.world.getBlock(
          Math.floor(arrow.position.x), Math.floor(arrow.position.y), Math.floor(arrow.position.z), false,
        );
        if (cell === BlockId.Cobweb) arrow.velocity.multiplyScalar(0.25);
        applyArrowDragAndGravity(arrow.velocity, cell === BlockId.Water);
      }
      if (removed || arrow.inGround) continue;
      this.orientArrow(arrow);
      this.applyArrowLight(arrow);
    }
  }

  private raycastPlayers(
    arrow: PlayerArrow,
    direction: THREE.Vector3,
    maxDistance: number,
    players: readonly ArrowPlayerTarget[] | undefined,
  ): { id: string; distance: number } | undefined {
    if (!players?.length) return undefined;
    let closest: { id: string; distance: number } | undefined;
    for (const player of players) {
      if (player.id === arrow.ownerId) continue;
      const hit = rayAabbDistance(arrow.position, direction, player.aabb);
      if (!hit || hit.distance < 0 || hit.distance > maxDistance) continue;
      if (closest && hit.distance >= closest.distance) continue;
      closest = { id: player.id, distance: hit.distance };
    }
    return closest;
  }

  interpolateVisuals(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    for (const arrow of this.arrows) {
      const visual = interpolateVec3(
        arrow.previousPosition.x,
        arrow.previousPosition.y,
        arrow.previousPosition.z,
        arrow.position.x,
        arrow.position.y,
        arrow.position.z,
        t,
      );
      if (!arrow.visual) continue;
      this.host.setPosition(arrow.visual, visual.x, visual.y, visual.z);
    }
  }

  /**
   * Java 1.8 player arrows (`canBePickedUp = 1`) enter inventory when resting.
   * Creative removes the world entity without inflating stacks.
   * Full Survival inventory leaves the arrow in the world.
   */
  tryCollect(
    player: PlayerAABB,
    options: {
      readonly mode: 'survival' | 'creative';
      readonly addItem: (itemId: string, count: number) => number;
    },
  ): number {
    let collected = 0;
    for (let index = this.arrows.length - 1; index >= 0; index -= 1) {
      const arrow = this.arrows[index]!;
      if (!arrow.inGround || arrow.pickupDelay > 0) continue;
      if (!arrowOverlapsPlayer(arrow.position, player)) continue;
      if (options.mode === 'creative') {
        this.remove(index);
        collected += 1;
        continue;
      }
      if (options.addItem(ItemId.Arrow, 1) !== 0) continue;
      this.remove(index);
      collected += 1;
    }
    return collected;
  }

  dispose(): void {
    while (this.arrows.length) this.remove(this.arrows.length - 1);
    if (this.ownsHost) this.host.dispose();
  }

  private syncArrowVisual(arrow: PlayerArrow): void {
    if (!arrow.visual) return;
    this.host.setPosition(arrow.visual, arrow.position.x, arrow.position.y, arrow.position.z);
    this.orientArrow(arrow);
  }

  private orientArrow(arrow: PlayerArrow): void {
    if (!arrow.visual) return;
    this.host.orientArrow(arrow.visual, arrow.velocity.x, arrow.velocity.y, arrow.velocity.z);
  }

  private applyArrowLight(arrow: PlayerArrow): void {
    if (!arrow.visual || typeof document === 'undefined') return;
    this.host.applyLight(
      arrow.visual,
      this.world,
      arrow.position.x,
      arrow.position.y,
      arrow.position.z,
      0.25,
    );
  }

  private remove(index: number): void {
    const arrow = this.arrows[index];
    if (!arrow) return;
    this.onRemove?.(arrow.id);
    if (arrow.visual) this.host.detach(arrow.visual);
    this.arrows.splice(index, 1);
  }
}

function arrowOverlapsPlayer(position: THREE.Vector3, player: PlayerAABB): boolean {
  const half = ARROW_PICKUP_SIZE * 0.5 + ARROW_PICKUP_PADDING;
  return position.x - half < player.maxX && position.x + half > player.minX
    && position.y - half < player.maxY && position.y + half > player.minY
    && position.z - half < player.maxZ && position.z + half > player.minZ;
}
