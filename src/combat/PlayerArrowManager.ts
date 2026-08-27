import * as THREE from 'three';
import { BlockId } from '../blocks';
import { ItemId } from '../items';
import type { PlayerAABB } from '../player';
import type { MobManager } from '../entities';
import type { MinecartEntity, MinecartManager } from '../entities/MinecartManager';
import { ARROW_FORWARD, ArrowVisualFactory } from '../rendering/ArrowVisualFactory';
import { applySampledEntityLight, worldDaylightUniform } from '../rendering/worldLighting';
import type { VoxelWorld } from '../world/World';
import { interpolateVec3 } from '../core/entityInterpolation';
import { applyArrowDragAndGravity, arrowDamageFromVelocity, inaccurateArrowDirection } from './ArrowPhysics';
import { FIRE_ARROW_IGNITE_TICKS } from './fireArrow';
import { embedArrow, arrowSupportIntact, releaseEmbeddedArrow, type EmbeddedArrowState } from './ArrowPhysics';

interface PlayerArrow {
  readonly position: THREE.Vector3;
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly visual: THREE.Object3D;
  age: number;
  critical: boolean;
  inGround: boolean;
  embedded?: EmbeddedArrowState;
  flaming: boolean;
  pickupDelay: number;
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
  private readonly visuals: ArrowVisualFactory;
  private readonly ownsVisuals: boolean;
  private readonly random: () => number;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world: VoxelWorld,
    private readonly mobs: MobManager,
    options: {
      readonly visualFactory?: ArrowVisualFactory;
      readonly random?: () => number;
      readonly minecarts?: MinecartManager;
      readonly onBlockHit?: (x: number, y: number, z: number, flaming: boolean) => void;
      readonly onMinecartHit?: (cart: MinecartEntity, flaming: boolean) => void;
    } = {},
  ) {
    this.visuals = options.visualFactory ?? new ArrowVisualFactory();
    this.ownsVisuals = options.visualFactory === undefined;
    this.random = options.random ?? Math.random;
    this.minecarts = options.minecarts;
    this.onBlockHit = options.onBlockHit;
    this.onMinecartHit = options.onMinecartHit;
  }

  private readonly minecarts?: MinecartManager;
  private readonly onBlockHit?: (x: number, y: number, z: number, flaming: boolean) => void;
  private readonly onMinecartHit?: (cart: MinecartEntity, flaming: boolean) => void;

  get count(): number {
    return this.arrows.length;
  }

  spawn(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speedBlocksPerTick: number,
    _damage: number,
    critical: boolean,
    flaming = false,
  ): void {
    if (this.arrows.length >= 48) this.remove(0);
    const velocity = inaccurateArrowDirection(direction, this.random).multiplyScalar(speedBlocksPerTick);
    const visual = this.visuals.create(flaming);
    visual.position.copy(origin);
    this.orient(visual, velocity);
    this.scene.add(visual);
    this.arrows.push({
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
  }

  tick(dt: number): void {
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
        const cartCloser = cartHit && (!mobHit || cartHit.distance <= mobHit.distance)
          && (!blockHit || cartHit.distance <= blockHit.distance + CART_BLOCK_SLOP);
        if (cartCloser && cartHit) {
          this.onMinecartHit?.(cartHit.cart, arrow.flaming);
          this.remove(index);
          removed = true;
          break;
        }
        if (mobHit && (!blockHit || mobHit.distance < blockHit.distance)) {
          this.mobs.damage(mobHit.mob, arrowDamageFromVelocity(arrow.velocity, arrow.critical), {
            source: 'projectile',
            attackerPosition: arrow.position,
            knockback: arrow.critical ? 4.2 : 2.4,
            ...(arrow.flaming ? { igniteTicks: FIRE_ARROW_IGNITE_TICKS } : {}),
          });
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
          arrow.visual.position.copy(arrow.position);
          this.onBlockHit?.(blockHit.x, blockHit.y, blockHit.z, arrow.flaming);
          applySampledEntityLight(
            arrow.visual, this.world, arrow.position.x, arrow.position.y, arrow.position.z, 0.25,
            worldDaylightUniform.value,
          );
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
      this.orient(arrow.visual, arrow.velocity);
      applySampledEntityLight(
        arrow.visual, this.world, arrow.position.x, arrow.position.y, arrow.position.z, 0.25,
        worldDaylightUniform.value,
      );
    }
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
      arrow.visual.position.set(visual.x, visual.y, visual.z);
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
    if (this.ownsVisuals) this.visuals.dispose();
  }

  private orient(visual: THREE.Object3D, velocity: Readonly<THREE.Vector3>): void {
    if (velocity.lengthSq() <= 1e-8) return;
    visual.quaternion.setFromUnitVectors(ARROW_FORWARD, new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize());
  }

  private remove(index: number): void {
    const arrow = this.arrows[index];
    if (!arrow) return;
    arrow.visual.removeFromParent();
    this.arrows.splice(index, 1);
  }
}

function arrowOverlapsPlayer(position: THREE.Vector3, player: PlayerAABB): boolean {
  const half = ARROW_PICKUP_SIZE * 0.5 + ARROW_PICKUP_PADDING;
  return position.x - half < player.maxX && position.x + half > player.minX
    && position.y - half < player.maxY && position.y + half > player.minY
    && position.z - half < player.maxZ && position.z + half > player.minZ;
}
