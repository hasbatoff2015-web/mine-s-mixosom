import * as THREE from 'three';
import type { EntitySnapshot } from '../../shared/protocol';
import type { EntityInterpolationBuffer } from '../net/entitySnapshotInterpolation';
import { TextureAtlas } from './TextureAtlas';

const PARTICLE_CAP = 512;
const ROCKET_CAP = 32;
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

/** Bounded, decorative firework presentation shared by local and network rockets. */
export class FireworkVisuals {
  readonly group = new THREE.Group();
  private readonly texture = new THREE.TextureLoader().load(TextureAtlas.url('item/firework_rocket'));
  private readonly rocketMaterial = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
  private readonly rocketSprites = new Map<string, THREE.Sprite>();
  private readonly trailTimers = new Map<string, number>();
  private readonly rocketPositions = new Map<string, { previous: THREE.Vector3; current: THREE.Vector3 }>();
  private readonly burstIds = new Set<string>();
  private readonly particles: Particle[] = [];
  private readonly positions = new Float32Array(PARTICLE_CAP * 3);
  private readonly colors = new Float32Array(PARTICLE_CAP * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly particleMaterial = new THREE.PointsMaterial({
    vertexColors: true, size: 0.2, transparent: true, opacity: 0.94,
    depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true,
  });

  constructor() {
    this.group.name = 'firework-visuals';
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    const points = new THREE.Points(this.geometry, this.particleMaterial);
    points.frustumCulled = false;
    this.group.add(points);
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
        this.addParticle(sprite.position.x, sprite.position.y - 0.16, sprite.position.z,
          (Math.random() - 0.5) * 0.35, -0.15, (Math.random() - 0.5) * 0.35, 0.28, 0xffd56b);
      }
      this.trailTimers.set(id, timer % 0.06);
    }
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const p = this.particles[index]!;
      p.life -= seconds;
      if (p.life <= 0) { this.particles.splice(index, 1); continue; }
      p.x += p.vx * seconds;
      p.y += p.vy * seconds;
      p.z += p.vz * seconds;
      p.vy -= 0.5 * seconds;
    }
    for (let index = 0; index < this.particles.length; index += 1) {
      const p = this.particles[index]!;
      this.positions[index * 3] = p.x;
      this.positions[index * 3 + 1] = p.y;
      this.positions[index * 3 + 2] = p.z;
      const fade = Math.min(1, p.life / Math.min(0.3, p.maxLife));
      this.colors[index * 3] = p.r * fade;
      this.colors[index * 3 + 1] = p.g * fade;
      this.colors[index * 3 + 2] = p.b * fade;
    }
    this.geometry.setDrawRange(0, this.particles.length);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private burst(x: number, y: number, z: number): void {
    const accent = chooseFireworkBurstColor();
    for (let i = 0; i < 88; i += 1) {
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const elevation = 1 - 2 * (i + 0.5) / 88;
      const horizontal = Math.sqrt(1 - elevation * elevation);
      const speed = 2.6 + (i % 4) * 0.18;
      this.addParticle(x, y, z, Math.cos(angle) * horizontal * speed,
        elevation * speed, Math.sin(angle) * horizontal * speed, 1.1 + (i % 3) * 0.13,
        i % 5 === 0 ? accent : 0xffffff);
    }
  }

  private addParticle(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: number): void {
    if (this.particles.length >= PARTICLE_CAP) this.particles.shift();
    const tint = new THREE.Color(color);
    this.particles.push({ x, y, z, vx, vy, vz, life, maxLife: life,
      r: tint.r, g: tint.g, b: tint.b });
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
    this.geometry.dispose();
    this.particleMaterial.dispose();
    this.rocketMaterial.dispose();
    this.texture.dispose();
  }
}
