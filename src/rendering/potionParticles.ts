import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';

/** 256×256 particle atlas, 16px tiles. Swirls occupy row 8, columns 0–7. */
export const POTION_SWIRL_ATLAS = 256;
export const POTION_SWIRL_TILE = 16;
export const POTION_SWIRL_COLUMNS = 16;
export const POTION_SWIRL_ROW = 8;
export const POTION_SWIRL_FRAMES = 8;
export const POTION_PARTICLE_COUNT = 7;
/** Far below fire overlay opacity (0.76); particles stay a hint, not a veil. */
export const POTION_PARTICLE_MAX_OPACITY = 0.32;
export const POTION_PARTICLE_MAX_SIZE = 0.078;

export type PotionParticleKind = 'invisibility' | 'regeneration' | 'both';

export const POTION_PARTICLE_TINT: Readonly<Record<PotionParticleKind, number>> = {
  invisibility: 0xd2c4ff,
  regeneration: 0xffc2d6,
  both: 0xead8ff,
};

export interface PotionSwirlUv {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly repeat: number;
}

/**
 * Three.js default `flipY`: image row 8 is y=128–144 from the top,
 * so the tile’s bottom sits at `(256 - 144) / 256`.
 */
export function potionSwirlUv(frame: number): PotionSwirlUv {
  const column = ((Math.floor(frame) % POTION_SWIRL_FRAMES) + POTION_SWIRL_FRAMES) % POTION_SWIRL_FRAMES;
  const tileBottom = (POTION_SWIRL_ROW + 1) * POTION_SWIRL_TILE;
  return {
    offsetX: column / POTION_SWIRL_COLUMNS,
    offsetY: (POTION_SWIRL_ATLAS - tileBottom) / POTION_SWIRL_ATLAS,
    repeat: POTION_SWIRL_TILE / POTION_SWIRL_ATLAS,
  };
}

export function applyPotionSwirlUv(texture: THREE.Texture, frame: number): void {
  const uv = potionSwirlUv(frame);
  texture.repeat.set(uv.repeat, uv.repeat);
  texture.offset.set(uv.offsetX, uv.offsetY);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
}

export function firstPersonPotionParticleLayout(): {
  readonly count: number;
  readonly minY: number;
  readonly maxY: number;
  readonly maxSize: number;
  readonly maxOpacity: number;
  readonly avoidCenterX: number;
} {
  return {
    count: POTION_PARTICLE_COUNT,
    minY: -0.50,
    maxY: -0.13,
    maxSize: POTION_PARTICLE_MAX_SIZE,
    maxOpacity: POTION_PARTICLE_MAX_OPACITY,
    avoidCenterX: 0.16,
  };
}

interface PotionSprite {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly map: THREE.Texture;
  life: number;
  duration: number;
  startY: number;
  endY: number;
  frame: number;
}

interface PotionOverlay {
  readonly group: THREE.Group;
  readonly sprites: PotionSprite[];
}

let shared: SharedPotionParticles | undefined;

export class SharedPotionParticles {
  readonly texture: THREE.Texture;
  private readonly overlays = new Set<PotionOverlay>();
  private readonly maps: THREE.Texture[] = [];

  private constructor() {
    this.texture = new THREE.Texture();
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    applyPotionSwirlUv(this.texture, 0);
    this.load();
  }

  static instance(): SharedPotionParticles {
    shared ??= new SharedPotionParticles();
    return shared;
  }

  createFirstPersonOverlay(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'first-person:potion-overlay';
    const sprites: PotionSprite[] = [];
    const layout = firstPersonPotionParticleLayout();
    for (let index = 0; index < layout.count; index += 1) {
      const map = this.attachMap();
      applyPotionSwirlUv(map, index);
      const material = new THREE.MeshBasicMaterial({
        map,
        color: POTION_PARTICLE_TINT.invisibility,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.name = `first-person:potion-particle-${index}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      group.add(mesh);
      const sprite: PotionSprite = {
        mesh,
        material,
        map,
        life: 0,
        duration: 1,
        startY: layout.minY,
        endY: layout.maxY,
        frame: index % POTION_SWIRL_FRAMES,
      };
      this.recycle(sprite, index / layout.count);
      sprites.push(sprite);
    }
    this.overlays.add({ group, sprites });
    return group;
  }

  release(group: THREE.Group): void {
    for (const overlay of this.overlays) {
      if (overlay.group !== group) continue;
      this.overlays.delete(overlay);
      for (const sprite of overlay.sprites) {
        sprite.mesh.removeFromParent();
        sprite.mesh.geometry.dispose();
        sprite.material.dispose();
        const mapIndex = this.maps.indexOf(sprite.map);
        if (mapIndex >= 0) this.maps.splice(mapIndex, 1);
        if (sprite.map !== this.texture) sprite.map.dispose();
      }
    }
  }

  update(deltaSeconds: number, kind: PotionParticleKind = 'invisibility'): void {
    const dt = Math.max(0, Math.min(0.1, deltaSeconds));
    if (dt <= 0) return;
    const tint = POTION_PARTICLE_TINT[kind];
    for (const overlay of this.overlays) {
      if (!overlay.group.visible) continue;
      for (const sprite of overlay.sprites) this.step(sprite, dt, tint);
    }
  }

  private step(sprite: PotionSprite, dt: number, tint: number): void {
    sprite.life += dt / sprite.duration;
    if (sprite.life >= 1) this.recycle(sprite, 0);
    const life = sprite.life;
    const fadeIn = Math.min(1, life / 0.18);
    const fadeOut = life > 0.72 ? 1 - (life - 0.72) / 0.28 : 1;
    const opacity = POTION_PARTICLE_MAX_OPACITY * fadeIn * Math.max(0, fadeOut);
    sprite.material.opacity = opacity;
    sprite.material.color.setHex(tint);
    sprite.mesh.visible = opacity > 0.01;
    const y = sprite.startY + (sprite.endY - sprite.startY) * life;
    sprite.mesh.position.y = y;
    const frame = Math.min(POTION_SWIRL_FRAMES - 1, Math.floor(life * POTION_SWIRL_FRAMES));
    if (frame !== sprite.frame) {
      sprite.frame = frame;
      applyPotionSwirlUv(sprite.map, frame);
    }
  }

  private recycle(sprite: PotionSprite, initialLife: number): void {
    const layout = firstPersonPotionParticleLayout();
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (layout.avoidCenterX + Math.random() * 0.40);
    const size = 0.048 + Math.random() * (layout.maxSize - 0.048);
    sprite.duration = 2.6 + Math.random() * 2.1;
    sprite.life = Math.min(0.72, Math.max(0, initialLife));
    sprite.startY = layout.minY + Math.random() * 0.05;
    sprite.endY = layout.maxY - Math.random() * 0.04 - size * 0.5;
    sprite.mesh.position.set(x, sprite.startY, -0.40);
    sprite.mesh.scale.set(size, size, 1);
    sprite.mesh.rotation.set(-0.08, side * 0.12, (Math.random() - 0.5) * 0.35);
    sprite.frame = Math.min(POTION_SWIRL_FRAMES - 1, Math.floor(sprite.life * POTION_SWIRL_FRAMES));
    applyPotionSwirlUv(sprite.map, sprite.frame);
    sprite.material.opacity = 0;
  }

  private attachMap(): THREE.Texture {
    const map = this.texture.clone();
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    if (this.texture.image) {
      map.image = this.texture.image;
      map.needsUpdate = true;
    }
    this.maps.push(map);
    applyPotionSwirlUv(map, 0);
    return map;
  }

  private load(): void {
    if (typeof document === 'undefined') return;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      this.texture.image = image;
      this.texture.needsUpdate = true;
      for (const map of this.maps) {
        map.image = image;
        map.needsUpdate = true;
      }
    };
    image.src = TextureAtlas.url('particle/particles');
  }
}

export function updateSharedPotionParticles(deltaSeconds: number, kind: PotionParticleKind = 'invisibility'): void {
  SharedPotionParticles.instance().update(deltaSeconds, kind);
}
