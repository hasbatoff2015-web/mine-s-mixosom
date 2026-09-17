import * as THREE from 'three';
import {
  TOTEM_BURST_COUNT,
  TOTEM_BURST_MAX_EFFECTS,
  createTotemBurst,
  stepTotemBurst,
  type TotemBurstState,
} from '../gameplay/totemBurst';

const PARTICLE_CAP = TOTEM_BURST_COUNT * TOTEM_BURST_MAX_EFFECTS;

/**
 * Compact Totem activation burst. Separate from FireworkVisuals: own Points,
 * palette, and lifecycle. Cosmetic only — no world collision.
 */
export class TotemParticles {
  readonly group = new THREE.Group();
  private readonly bursts: TotemBurstState[] = [];
  private readonly positions = new Float32Array(PARTICLE_CAP * 3);
  private readonly colors = new Float32Array(PARTICLE_CAP * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.08,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
  });

  constructor() {
    this.group.name = 'totem-particles';
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    this.group.add(points);
  }

  get activeBurstCount(): number {
    return this.bursts.length;
  }

  get particleCount(): number {
    let count = 0;
    for (const burst of this.bursts) {
      for (const particle of burst.particles) if (particle.life > 0) count += 1;
    }
    return count;
  }

  burst(
    x: number,
    y: number,
    z: number,
    options?: { readonly firstPerson?: boolean; readonly random?: () => number },
  ): void {
    if (this.bursts.length >= TOTEM_BURST_MAX_EFFECTS) this.bursts.shift();
    this.bursts.push(createTotemBurst(x, y, z, options));
  }

  update(dt: number): void {
    const seconds = Math.max(0, dt);
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      if (!stepTotemBurst(this.bursts[index]!, seconds)) this.bursts.splice(index, 1);
    }
    let write = 0;
    for (const burst of this.bursts) {
      for (const particle of burst.particles) {
        if (particle.life <= 0 || write >= PARTICLE_CAP) continue;
        const fade = Math.min(1, particle.life / Math.min(0.28, particle.maxLife));
        this.positions[write * 3] = particle.x;
        this.positions[write * 3 + 1] = particle.y;
        this.positions[write * 3 + 2] = particle.z;
        this.colors[write * 3] = ((particle.color >> 16) & 255) / 255 * fade;
        this.colors[write * 3 + 1] = ((particle.color >> 8) & 255) / 255 * fade;
        this.colors[write * 3 + 2] = (particle.color & 255) / 255 * fade;
        write += 1;
      }
    }
    this.geometry.setDrawRange(0, write);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.bursts.length = 0;
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
