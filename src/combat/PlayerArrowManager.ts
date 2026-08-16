import * as THREE from 'three';
import type { MobManager } from '../entities';
import type { VoxelWorld } from '../world/World';

interface PlayerArrow {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  visual: THREE.Mesh;
  age: number;
  damage: number;
  critical: boolean;
}

export class PlayerArrowManager {
  private readonly arrows: PlayerArrow[] = [];
  private readonly geometry = new THREE.BoxGeometry(0.06, 0.06, 0.55);
  private readonly material = new THREE.MeshLambertMaterial({ color: 0xdac99a });

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world: VoxelWorld,
    private readonly mobs: MobManager,
  ) {}

  get count(): number {
    return this.arrows.length;
  }

  spawn(origin: THREE.Vector3, direction: THREE.Vector3, speedBlocksPerTick: number, damage: number, critical: boolean): void {
    if (this.arrows.length >= 48) this.remove(0);
    const velocity = direction.clone().normalize().multiplyScalar(speedBlocksPerTick * 20);
    const visual = new THREE.Mesh(this.geometry, this.material);
    visual.position.copy(origin);
    visual.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), velocity.clone().normalize());
    this.scene.add(visual);
    this.arrows.push({ position: origin.clone(), velocity, visual, age: 0, damage, critical });
  }

  tick(dt: number): void {
    for (let index = this.arrows.length - 1; index >= 0; index -= 1) {
      const arrow = this.arrows[index]!;
      arrow.age += dt;
      if (arrow.age > 8) {
        this.remove(index);
        continue;
      }
      const substeps = Math.max(1, Math.ceil(dt / 0.0125));
      const step = dt / substeps;
      let removed = false;
      for (let substep = 0; substep < substeps; substep += 1) {
        arrow.velocity.y -= 5.5 * step;
        const movement = arrow.velocity.clone().multiplyScalar(step);
        const distance = movement.length();
        if (distance <= 0) continue;
        const direction = movement.clone().normalize();
        const blockHit = this.world.raycast(arrow.position, direction, distance);
        const mobHit = this.mobs.raycast(arrow.position, direction, distance);
        if (mobHit && (!blockHit || mobHit.distance < blockHit.distance)) {
          this.mobs.damage(mobHit.mob, arrow.damage, {
            source: 'projectile',
            attackerPosition: arrow.position,
            knockback: arrow.critical ? 4.2 : 2.4,
          });
          this.remove(index);
          removed = true;
          break;
        }
        if (blockHit) {
          this.remove(index);
          removed = true;
          break;
        }
        arrow.position.add(movement);
      }
      if (removed) continue;
      arrow.visual.position.copy(arrow.position);
      if (arrow.velocity.lengthSq() > 0) arrow.visual.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), arrow.velocity.clone().normalize());
    }
  }

  dispose(): void {
    while (this.arrows.length) this.remove(this.arrows.length - 1);
    this.geometry.dispose();
    this.material.dispose();
  }

  private remove(index: number): void {
    const arrow = this.arrows[index];
    if (!arrow) return;
    arrow.visual.removeFromParent();
    this.arrows.splice(index, 1);
  }
}
