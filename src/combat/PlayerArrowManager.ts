import * as THREE from 'three';
import { BlockId } from '../blocks';
import type { MobManager } from '../entities';
import { ArrowVisualFactory } from '../rendering/ArrowVisualFactory';
import { applySampledEntityLight, worldDaylightUniform } from '../rendering/worldLighting';
import type { VoxelWorld } from '../world/World';
import { interpolateVec3 } from '../core/entityInterpolation';
import { applyArrowDragAndGravity, arrowDamageFromVelocity, inaccurateArrowDirection } from './ArrowPhysics';
import { FIRE_ARROW_IGNITE_TICKS } from './fireArrow';

interface PlayerArrow {
  readonly position: THREE.Vector3;
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly visual: THREE.Object3D;
  age: number;
  critical: boolean;
  inGround: boolean;
  flaming: boolean;
}

const FORWARD = new THREE.Vector3(0, 0, -1);

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
      readonly onBlockHit?: (x: number, y: number, z: number, flaming: boolean) => void;
    } = {},
  ) {
    this.visuals = options.visualFactory ?? new ArrowVisualFactory();
    this.ownsVisuals = options.visualFactory === undefined;
    this.random = options.random ?? Math.random;
    this.onBlockHit = options.onBlockHit;
  }

  private readonly onBlockHit?: (x: number, y: number, z: number, flaming: boolean) => void;

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
    });
  }

  tick(dt: number): void {
    const tickSteps = Math.max(1, Math.round(dt * 20));
    for (let index = this.arrows.length - 1; index >= 0; index -= 1) {
      const arrow = this.arrows[index]!;
      arrow.previousPosition.copy(arrow.position);
      arrow.age += dt;
      if (arrow.age > 8) {
        this.remove(index);
        continue;
      }
      if (arrow.inGround) continue;
      let removed = false;
      for (let step = 0; step < tickSteps; step += 1) {
        const movement = arrow.velocity.clone();
        const distance = movement.length();
        if (distance <= 1e-8) continue;
        const direction = movement.clone().multiplyScalar(1 / distance);
        const blockHit = this.world.raycast(arrow.position, direction, distance);
        const mobHit = this.mobs.raycast(arrow.position, direction, distance);
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
          arrow.position.addScaledVector(direction, Math.max(0, blockHit.distance - 0.035));
          arrow.inGround = true;
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

  dispose(): void {
    while (this.arrows.length) this.remove(this.arrows.length - 1);
    if (this.ownsVisuals) this.visuals.dispose();
  }

  private orient(visual: THREE.Object3D, velocity: Readonly<THREE.Vector3>): void {
    if (velocity.lengthSq() <= 1e-8) return;
    visual.quaternion.setFromUnitVectors(FORWARD, new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize());
  }

  private remove(index: number): void {
    const arrow = this.arrows[index];
    if (!arrow) return;
    arrow.visual.removeFromParent();
    this.arrows.splice(index, 1);
  }
}
