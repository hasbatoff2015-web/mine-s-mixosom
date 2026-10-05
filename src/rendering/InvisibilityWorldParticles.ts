import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';
import {
  POTION_SWIRL_FRAMES,
  applyPotionSwirlUv,
} from './potionParticles';

/** Pooled world sprites per player. Steady state stays around 2–5. */
export const WORLD_INVIS_PARTICLE_POOL = 7;
/** Neutral white. First-person overlay keeps its own tint. */
export const WORLD_INVIS_PARTICLE_TINT = 0xf6f6f6;
export const WORLD_INVIS_PARTICLE_MAX_OPACITY = 0.52;
export const WORLD_INVIS_MIN_SIZE = 0.1;
export const WORLD_INVIS_MAX_SIZE = 0.16;
export const WORLD_INVIS_MIN_LIFE = 1.3;
export const WORLD_INVIS_MAX_LIFE = 2;
/** Uniform disk around the feet-origin rig. */
export const WORLD_INVIS_SPAWN_RADIUS = 0.34;
export const WORLD_INVIS_MIN_Y = 0.15;
export const WORLD_INVIS_MAX_Y = 1.75;
export const WORLD_INVIS_MIN_RISE = 0.18;
export const WORLD_INVIS_MAX_RISE = 0.35;
export const WORLD_INVIS_MIN_DRIFT = 0.04;
export const WORLD_INVIS_MAX_DRIFT = 0.08;
export const WORLD_INVIS_MIN_INTERVAL = 0.28;
export const WORLD_INVIS_MAX_INTERVAL = 0.45;
export const INVISIBILITY_WORLD_PARTICLE_GROUP = 'player:invisibility-particles';

/**
 * 0–15% fade in, 15–75% hold, 75–100% fade out.
 * Life is 0 at spawn and 1 at recycle.
 */
export function invisibilityWorldParticleOpacity(life: number): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(life) ? life : 0));
  let factor = 1;
  if (t < 0.15) factor = t / 0.15;
  else if (t > 0.75) factor = (1 - t) / 0.25;
  return WORLD_INVIS_PARTICLE_MAX_OPACITY * factor;
}

function configureSwirlTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
}

/**
 * Eight atlas slices shared by every invisible player.
 * PlayerVisual dispose releases sprites, not these maps.
 */
class SharedInvisibilitySwirlFrames {
  readonly base: THREE.Texture;
  readonly frames: THREE.Texture[];

  constructor() {
    this.base = new THREE.Texture();
    configureSwirlTexture(this.base);
    this.frames = [];
    for (let frame = 0; frame < POTION_SWIRL_FRAMES; frame += 1) {
      const map = this.base.clone();
      configureSwirlTexture(map);
      applyPotionSwirlUv(map, frame);
      this.frames.push(map);
    }
    this.load();
  }

  private load(): void {
    if (typeof document === 'undefined') return;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      this.base.image = image;
      this.base.needsUpdate = true;
      for (const frame of this.frames) {
        frame.image = image;
        frame.needsUpdate = true;
      }
    };
    image.src = TextureAtlas.url('particle/particles');
  }
}

let sharedFrames: SharedInvisibilitySwirlFrames | undefined;
let sharedFramesLive = false;

function swirlFrames(): SharedInvisibilitySwirlFrames {
  if (!sharedFrames) {
    sharedFrames = new SharedInvisibilitySwirlFrames();
    sharedFramesLive = true;
  }
  return sharedFrames;
}

export function invisibilitySwirlFrames(): readonly THREE.Texture[] {
  return swirlFrames().frames;
}

/** False only if the shared owner itself is released. Per-player dispose does not clear it. */
export function invisibilitySwirlFramesLive(): boolean {
  return sharedFramesLive;
}

interface WorldParticleSlot {
  readonly sprite: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
  active: boolean;
  life: number;
  duration: number;
  originX: number;
  originY: number;
  originZ: number;
  driftX: number;
  driftZ: number;
  rise: number;
  size: number;
  frame: number;
}

/**
 * Client-only status particles for an invisible player.
 * Parent is PlayerVisual.root (feet). depthTest stays on so walls hide them.
 */
export class InvisibilityWorldParticles {
  readonly group = new THREE.Group();
  private readonly slots: WorldParticleSlot[] = [];
  private enabled = false;
  private disposed = false;
  private spawnWait = 0;
  private spawnInterval = WORLD_INVIS_MIN_INTERVAL;
  private spawned = 0;

  constructor() {
    this.group.name = INVISIBILITY_WORLD_PARTICLE_GROUP;
    this.group.visible = false;
    const frames = swirlFrames().frames;
    const first = frames[0];
    if (!first) throw new Error('Invisibility swirl frames were not created.');
    for (let index = 0; index < WORLD_INVIS_PARTICLE_POOL; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: first,
        color: WORLD_INVIS_PARTICLE_TINT,
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
        fog: true,
        toneMapped: false,
        blending: THREE.NormalBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = `player:invisibility-particle-${index}`;
      sprite.visible = false;
      sprite.userData.life = 0;
      sprite.userData.frame = 0;
      this.group.add(sprite);
      this.slots.push({
        sprite,
        material,
        active: false,
        life: 0,
        duration: WORLD_INVIS_MIN_LIFE,
        originX: 0,
        originY: WORLD_INVIS_MIN_Y,
        originZ: 0,
        driftX: 0,
        driftZ: 0,
        rise: WORLD_INVIS_MIN_RISE,
        size: WORLD_INVIS_MIN_SIZE,
        frame: 0,
      });
    }
  }

  get active(): boolean {
    return this.enabled;
  }

  get poolSize(): number {
    return this.slots.length;
  }

  get activeCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.active) count += 1;
    return count;
  }

  get spawnCount(): number {
    return this.spawned;
  }

  setActive(active: boolean): void {
    if (this.disposed || this.enabled === active) return;
    this.enabled = active;
    if (!active) {
      this.group.visible = false;
      this.spawnWait = 0;
      for (const slot of this.slots) this.deactivate(slot);
      return;
    }
    this.group.visible = true;
    this.spawnWait = 0;
    this.spawnInterval = this.randomRange(WORLD_INVIS_MIN_INTERVAL, WORLD_INVIS_MAX_INTERVAL);
    this.activateSlot(0.18);
    this.activateSlot(0.42);
  }

  update(deltaSeconds: number): void {
    if (this.disposed || !this.enabled) return;
    const dt = Math.max(0, Math.min(0.1, deltaSeconds));
    if (dt <= 0) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.life += dt / slot.duration;
      if (slot.life >= 1) {
        this.deactivate(slot);
        continue;
      }
      this.present(slot);
    }
    this.spawnWait += dt;
    if (this.spawnWait < this.spawnInterval) return;
    this.spawnWait = 0;
    this.spawnInterval = this.randomRange(WORLD_INVIS_MIN_INTERVAL, WORLD_INVIS_MAX_INTERVAL);
    this.activateSlot(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.enabled = false;
    this.group.visible = false;
    for (const slot of this.slots) {
      slot.sprite.removeFromParent();
      slot.material.dispose();
      slot.active = false;
    }
    this.slots.length = 0;
    this.group.removeFromParent();
    this.disposed = true;
  }

  private activateSlot(initialLife: number): void {
    const slot = this.slots.find((entry) => !entry.active);
    if (!slot) return;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * WORLD_INVIS_SPAWN_RADIUS;
    const driftAngle = Math.random() * Math.PI * 2;
    const drift = this.randomRange(WORLD_INVIS_MIN_DRIFT, WORLD_INVIS_MAX_DRIFT);
    slot.active = true;
    slot.life = Math.min(0.7, Math.max(0, initialLife));
    slot.duration = this.randomRange(WORLD_INVIS_MIN_LIFE, WORLD_INVIS_MAX_LIFE);
    slot.originX = Math.cos(angle) * radius;
    slot.originZ = Math.sin(angle) * radius;
    slot.originY = this.randomRange(WORLD_INVIS_MIN_Y, WORLD_INVIS_MAX_Y);
    slot.driftX = Math.cos(driftAngle) * drift;
    slot.driftZ = Math.sin(driftAngle) * drift;
    slot.rise = this.randomRange(WORLD_INVIS_MIN_RISE, WORLD_INVIS_MAX_RISE);
    slot.size = this.randomRange(WORLD_INVIS_MIN_SIZE, WORLD_INVIS_MAX_SIZE);
    slot.frame = -1;
    slot.material.rotation = (Math.random() - 0.5) * Math.PI;
    slot.material.color.setHex(WORLD_INVIS_PARTICLE_TINT);
    this.spawned += 1;
    this.present(slot);
  }

  private present(slot: WorldParticleSlot): void {
    const life = slot.life;
    const opacity = invisibilityWorldParticleOpacity(life);
    slot.material.opacity = opacity;
    slot.sprite.visible = opacity > 0.01;
    slot.sprite.position.set(
      slot.originX + slot.driftX * life,
      slot.originY + slot.rise * life,
      slot.originZ + slot.driftZ * life,
    );
    const scale = slot.size * (1 - 0.08 * life);
    slot.sprite.scale.set(scale, scale, 1);
    const frame = Math.min(POTION_SWIRL_FRAMES - 1, Math.floor(life * POTION_SWIRL_FRAMES));
    if (frame !== slot.frame) {
      slot.frame = frame;
      const map = swirlFrames().frames[frame] ?? swirlFrames().frames[0];
      if (map) {
        slot.material.map = map;
        slot.material.needsUpdate = true;
      }
    }
    slot.sprite.userData.life = life;
    slot.sprite.userData.frame = frame;
  }

  private deactivate(slot: WorldParticleSlot): void {
    slot.active = false;
    slot.life = 0;
    slot.sprite.visible = false;
    slot.material.opacity = 0;
    slot.sprite.userData.life = 0;
  }

  private randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
