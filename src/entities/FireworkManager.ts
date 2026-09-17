import { Vec3, type Vec3Like } from '../math/vec3';
import type { VoxelWorld } from '../world/World';

export type FireworkFlight = 1 | 2 | 3;

export interface FireworkEntity {
  readonly id: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly flight: FireworkFlight;
  readonly fuseTicks: number;
  ageTicks: number;
  exploded: boolean;
}

export function fireworkFlight(metadata: unknown): FireworkFlight {
  if (!metadata || typeof metadata !== 'object') return 1;
  const firework = (metadata as { firework?: unknown }).firework;
  if (!firework || typeof firework !== 'object') return 1;
  const flight = (firework as { flight?: unknown }).flight;
  return flight === 2 || flight === 3 ? flight : 1;
}

/** Short-lived decorative rockets. Fixed 20 TPS, capped, never persisted. */
export class FireworkManager {
  private readonly active: FireworkEntity[] = [];
  private nextId = 0;
  readonly cap = 32;

  constructor(private readonly world?: VoxelWorld) {}

  get entities(): readonly FireworkEntity[] { return this.active; }

  spawn(position: Vec3Like, flight: FireworkFlight): FireworkEntity {
    if (this.active.length >= this.cap) this.active.shift();
    const entity: FireworkEntity = {
      id: `firework-${++this.nextId}`,
      position: new Vec3(position.x, position.y, position.z),
      velocity: new Vec3(0, 0.13, 0),
      flight,
      fuseTicks: 16 + flight * 17,
      ageTicks: 0,
      exploded: false,
    };
    this.active.push(entity);
    return entity;
  }

  tick(): void {
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const rocket = this.active[index]!;
      if (rocket.exploded) { this.active.splice(index, 1); continue; }
      rocket.ageTicks += 1;
      const movement = rocket.velocity.clone();
      const distance = movement.length();
      const hit = distance > 1e-8
        ? this.world?.raycast(rocket.position, movement, distance, { geometry: 'collision' })
        : undefined;
      if (hit) {
        rocket.position.copy(hit.point).addScaledVector(hit.normal, 0.035);
        rocket.exploded = true;
        continue;
      }
      rocket.position.add(movement);
      rocket.velocity.y = Math.min(0.33, rocket.velocity.y + 0.004);
      if (rocket.ageTicks >= rocket.fuseTicks) rocket.exploded = true;
    }
  }

  clear(): void { this.active.length = 0; }
}
