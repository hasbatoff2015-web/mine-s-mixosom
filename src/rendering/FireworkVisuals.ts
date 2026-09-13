import * as THREE from 'three';
import type { EntitySnapshot } from '../../shared/protocol';

const PARTICLE_CAP = 256;
const ROCKET_CAP = 32;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
}

/** Bounded, decorative firework presentation shared by local and network rockets. */
export class FireworkVisuals {
  readonly group = new THREE.Group();
  private readonly texture = new THREE.TextureLoader().load('/textures/item/firework_rocket.png');
  private readonly rocketMaterial = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
  private readonly rocketSprites = new Map<string, THREE.Sprite>();
  private readonly trailTimers = new Map<string, number>();
  private readonly particles: Particle[] = [];
  private readonly positions = new Float32Array(PARTICLE_CAP * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly particleMaterial = new THREE.PointsMaterial({
    color: 0xfff2b0, size: 0.115, transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });

  constructor() {
    this.group.name = 'firework-visuals';
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
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
        if (this.rocketSprites.has(rocket.id)) this.burst(rocket.x, rocket.y, rocket.z);
        this.removeRocket(rocket.id);
        continue;
      }
      let sprite = this.rocketSprites.get(rocket.id);
      if (!sprite) {
        sprite = new THREE.Sprite(this.rocketMaterial);
        sprite.scale.set(0.22, 0.44, 1);
        this.rocketSprites.set(rocket.id, sprite);
        this.trailTimers.set(rocket.id, 0);
        this.group.add(sprite);
      }
      sprite.position.set(rocket.x, rocket.y, rocket.z);
    }
    for (const id of this.rocketSprites.keys()) if (!seen.has(id)) this.removeRocket(id);
  }

  update(dt: number): void {
    const seconds = Math.min(0.1, Math.max(0, dt));
    for (const [id, sprite] of this.rocketSprites) {
      const timer = (this.trailTimers.get(id) ?? 0) + seconds;
      if (timer >= 0.06) {
        this.addParticle(sprite.position.x, sprite.position.y - 0.16, sprite.position.z,
          (Math.random() - 0.5) * 0.35, -0.15, (Math.random() - 0.5) * 0.35, 0.28);
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
    }
    this.geometry.setDrawRange(0, this.particles.length);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private burst(x: number, y: number, z: number): void {
    for (let i = 0; i < 28; i += 1) {
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const elevation = 1 - 2 * (i + 0.5) / 28;
      const horizontal = Math.sqrt(1 - elevation * elevation);
      this.addParticle(x, y, z, Math.cos(angle) * horizontal * 1.6,
        elevation * 1.6, Math.sin(angle) * horizontal * 1.6, 0.7);
    }
  }

  private addParticle(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    if (this.particles.length >= PARTICLE_CAP) this.particles.shift();
    this.particles.push({ x, y, z, vx, vy, vz, life, maxLife: life });
  }

  private removeRocket(id: string): void {
    this.rocketSprites.get(id)?.removeFromParent();
    this.rocketSprites.delete(id);
    this.trailTimers.delete(id);
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
