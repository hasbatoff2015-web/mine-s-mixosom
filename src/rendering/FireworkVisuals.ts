import * as THREE from 'three';
import type { EntitySnapshot } from '../../shared/protocol';
import { DUEL_BURST_PARTICLE_SIZE } from '../../shared/duels';
import type { EntityInterpolationBuffer } from '../net/entitySnapshotInterpolation';
import { TextureAtlas } from './TextureAtlas';

const PARTICLE_CAP = 512;
/** One fight-start burst is 88 points. The compact layer only holds that rare burst. */
const COMPACT_PARTICLE_CAP = 128;
const ROCKET_CAP = 32;
export const FIREWORK_ORDINARY_PARTICLE_SIZE = 0.2;
export const FIREWORK_COMPACT_PARTICLE_SIZE = DUEL_BURST_PARTICLE_SIZE;
export const FIREWORK_BURST_COLORS = [0xf62935, 0x2167fa, 0x9a32ed, 0x1ac653, 0xf5c400, 0x00bfdf] as const;

export function chooseFireworkBurstColor(random = Math.random): number {
  return FIREWORK_BURST_COLORS[Math.min(FIREWORK_BURST_COLORS.length - 1,
    Math.floor(Math.max(0, random()) * FIREWORK_BURST_COLORS.length))]!;
}

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  r: number; g: number; b: number;
}

interface ParticleLayer {
  readonly cap: number;
  readonly particles: Particle[];
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.PointsMaterial;
}

export interface FireworkBurstOptions {
  readonly velocityScale?: number;
  readonly lifeScale?: number;
  /** Selects a fixed point layer. Omitted uses the ordinary 0.2 layer. */
  readonly size?: number;
}

/** Bounded, decorative firework presentation shared by local and network rockets. */
export class FireworkVisuals {
  readonly group = new THREE.Group();
  private readonly texture = new THREE.TextureLoader().load(TextureAtlas.url('item/firework_rocket'));
  private readonly rocketMaterial = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
  private readonly rocketSprites = new Map<string, THREE.Sprite>();
  private readonly trailTimers = new Map<string, number>();
  private readonly rocketPositions = new Map<string, { previous: THREE.Vector3; current: THREE.Vector3 }>();
  private readonly burstIds = new Set<string>();
  private readonly ordinary: ParticleLayer;
  private readonly compact: ParticleLayer;
  private readonly particleTint = new THREE.Color();

  constructor() {
    this.group.name = 'firework-visuals';
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.ordinary = this.createLayer(FIREWORK_ORDINARY_PARTICLE_SIZE, PARTICLE_CAP);
    this.compact = this.createLayer(FIREWORK_COMPACT_PARTICLE_SIZE, COMPACT_PARTICLE_CAP);
  }

  sync(snapshots: readonly Pick<EntitySnapshot, 'id' | 'x' | 'y' | 'z' | 'state'>[]): void {
    const seen = new Set<string>();
    for (const rocket of snapshots.slice(0, ROCKET_CAP)) {
      seen.add(rocket.id);
      if (rocket.state === 'burst') {
        if (!this.burstIds.has(rocket.id)) this.burst(rocket.x, rocket.y, rocket.z);
        this.burstIds.add(rocket.id);
        this.removeRocket(rocket.id);
        continue;
      }
      let sprite = this.rocketSprites.get(rocket.id);
      if (!sprite) {
        sprite = new THREE.Sprite(this.rocketMaterial);
        sprite.scale.set(0.22, 0.44, 1);
        this.rocketSprites.set(rocket.id, sprite);
        this.trailTimers.set(rocket.id, 0);
        const position = new THREE.Vector3(rocket.x, rocket.y, rocket.z);
        this.rocketPositions.set(rocket.id, { previous: position.clone(), current: position });
        this.group.add(sprite);
      }
      const pose = this.rocketPositions.get(rocket.id)!;
      pose.previous.copy(pose.current);
      pose.current.set(rocket.x, rocket.y, rocket.z);
    }
    for (const id of this.rocketSprites.keys()) if (!seen.has(id)) this.removeRocket(id);
    for (const id of this.burstIds) if (!seen.has(id)) this.burstIds.delete(id);
  }

  update(dt: number, alpha = 1, interpolator?: EntityInterpolationBuffer, now = 0): void {
    const seconds = Math.min(0.1, Math.max(0, dt));
    for (const [id, sprite] of this.rocketSprites) {
      const pose = interpolator?.sample(id, now);
      if (pose) sprite.position.set(pose.x, pose.y, pose.z);
      else {
        const local = this.rocketPositions.get(id)!;
        sprite.position.copy(local.previous).lerp(local.current, Math.max(0, Math.min(1, alpha)));
      }
      const timer = (this.trailTimers.get(id) ?? 0) + seconds;
      if (timer >= 0.06) {
        this.addParticle(this.ordinary, sprite.position.x, sprite.position.y - 0.16, sprite.position.z,
          (Math.random() - 0.5) * 0.35, -0.15, (Math.random() - 0.5) * 0.35, 0.28, 0xffd56b);
      }
      this.trailTimers.set(id, timer % 0.06);
    }
    this.stepLayer(this.ordinary, seconds);
    this.stepLayer(this.compact, seconds);
  }

  /**
   * Particle burst only. Defaults match a finished firework rocket.
   * velocityScale and lifeScale multiply the ordinary speed and lifetime.
   * size selects a point layer. It does not resize the ordinary material.
   */
  spawnBurst(x: number, y: number, z: number, options: FireworkBurstOptions = {}): void {
    const velocityScale = options.velocityScale ?? 1;
    const lifeScale = options.lifeScale ?? 1;
    const layer = this.layerForSize(options.size);
    const accent = chooseFireworkBurstColor();
    for (let i = 0; i < 88; i += 1) {
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const elevation = 1 - 2 * (i + 0.5) / 88;
      const horizontal = Math.sqrt(1 - elevation * elevation);
      const speed = (2.6 + (i % 4) * 0.18) * velocityScale;
      const life = (1.1 + (i % 3) * 0.13) * lifeScale;
      this.addParticle(layer, x, y, z, Math.cos(angle) * horizontal * speed,
        elevation * speed, Math.sin(angle) * horizontal * speed, life,
        i % 5 === 0 ? accent : 0xffffff);
    }
  }

  private burst(x: number, y: number, z: number): void {
    this.spawnBurst(x, y, z);
  }

  private createLayer(size: number, cap: number): ParticleLayer {
    const positions = new Float32Array(cap * 3);
    const colors = new Float32Array(cap * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      vertexColors: true, size, transparent: true, opacity: 0.94,
      depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    return { cap, particles: [], positions, colors, geometry, material };
  }

  private layerForSize(size: number | undefined): ParticleLayer {
    if (size !== undefined && Math.abs(size - this.compact.material.size) < 1e-4) return this.compact;
    return this.ordinary;
  }

  private addParticle(
    layer: ParticleLayer,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number,
    color: number,
  ): void {
    if (layer.particles.length >= layer.cap) layer.particles.shift();
    this.particleTint.set(color);
    layer.particles.push({
      x, y, z, vx, vy, vz, life, maxLife: life,
      r: this.particleTint.r, g: this.particleTint.g, b: this.particleTint.b,
    });
  }

  private stepLayer(layer: ParticleLayer, seconds: number): void {
    const particles = layer.particles;
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index]!;
      particle.life -= seconds;
      if (particle.life <= 0) {
        particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.z += particle.vz * seconds;
      particle.vy -= 0.5 * seconds;
    }
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index]!;
      layer.positions[index * 3] = particle.x;
      layer.positions[index * 3 + 1] = particle.y;
      layer.positions[index * 3 + 2] = particle.z;
      const fade = Math.min(1, particle.life / Math.min(0.3, particle.maxLife));
      layer.colors[index * 3] = particle.r * fade;
      layer.colors[index * 3 + 1] = particle.g * fade;
      layer.colors[index * 3 + 2] = particle.b * fade;
    }
    layer.geometry.setDrawRange(0, particles.length);
    (layer.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (layer.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private removeRocket(id: string): void {
    this.rocketSprites.get(id)?.removeFromParent();
    this.rocketSprites.delete(id);
    this.trailTimers.delete(id);
    this.rocketPositions.delete(id);
  }

  dispose(): void {
    for (const id of this.rocketSprites.keys()) this.removeRocket(id);
    this.group.removeFromParent();
    this.ordinary.geometry.dispose();
    this.ordinary.material.dispose();
    this.compact.geometry.dispose();
    this.compact.material.dispose();
    this.rocketMaterial.dispose();
    this.texture.dispose();
  }
}
