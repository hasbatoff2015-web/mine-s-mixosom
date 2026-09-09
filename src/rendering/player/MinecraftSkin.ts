import * as THREE from 'three';
import { TextureAtlas } from '../TextureAtlas';
import {
  BUILTIN_MINECRAFT_SKINS,
  type MinecraftSkinDescriptor,
  type PlayerSkinOuterAlpha,
} from '../../player/appearance/builtinSkins';

export {
  BUILTIN_MINECRAFT_SKINS,
  PRODUCTION_PLAYER_SKINS,
  QA_PLAYER_SKIN_ID,
  skinHasTranslucentOuterLayer,
  type MinecraftSkinDescriptor,
  type PlayerSkinOuterAlpha,
} from '../../player/appearance/builtinSkins';

export const MINECRAFT_SKIN_WIDTH = 64;
export const MINECRAFT_SKIN_HEIGHT = 64;

export interface SkinDimensionValidation {
  readonly ok: boolean;
  readonly reason?: string;
}

export function validateMinecraftSkinDimensions(width: number, height: number): SkinDimensionValidation {
  if (width === 64 && height === 32) {
    return { ok: false, reason: 'Legacy 64x32 skins are intentionally unsupported; use a modern 64x64 Java skin.' };
  }
  if (width !== MINECRAFT_SKIN_WIDTH || height !== MINECRAFT_SKIN_HEIGHT) {
    return { ok: false, reason: `Expected a 64x64 PNG, received ${width}x${height}.` };
  }
  return { ok: true };
}

export interface SkinTextureHandle {
  readonly skinId: string;
  readonly texture: THREE.Texture;
  readonly outerLayerAlpha: PlayerSkinOuterAlpha;
  release(): void;
}

interface SkinCacheEntry {
  readonly texture: THREE.Texture;
  references: number;
}

/** One decoded texture per skin id, shared by local/remote visuals and the first-person arm. */
export class MinecraftSkinRegistry {
  private readonly descriptors = new Map<string, MinecraftSkinDescriptor>();
  private readonly cache = new Map<string, SkinCacheEntry>();
  private disposed = false;

  constructor(descriptors: readonly MinecraftSkinDescriptor[] = BUILTIN_MINECRAFT_SKINS) {
    for (const descriptor of descriptors) this.register(descriptor);
  }

  register(descriptor: MinecraftSkinDescriptor): void {
    if (!descriptor.id.trim()) throw new Error('Skin id must not be empty.');
    this.descriptors.set(descriptor.id, descriptor);
  }

  /** Registration boundary for future file/network import after its PNG dimensions were decoded. */
  registerValidated(descriptor: MinecraftSkinDescriptor, width: number, height: number): void {
    const validation = validateMinecraftSkinDimensions(width, height);
    if (!validation.ok) throw new Error(validation.reason);
    this.register(descriptor);
  }

  acquire(requestedSkinId: string): SkinTextureHandle {
    if (this.disposed) throw new Error('MinecraftSkinRegistry is disposed.');
    const descriptor = this.descriptors.get(requestedSkinId)
      ?? this.descriptors.get('frontier_explorer');
    if (!descriptor) throw new Error(`Unknown skin '${requestedSkinId}' and no default skin is registered.`);
    let entry = this.cache.get(descriptor.id);
    if (!entry) {
      entry = { texture: this.createTexture(descriptor), references: 0 };
      this.cache.set(descriptor.id, entry);
    }
    entry.references += 1;
    let released = false;
    return {
      skinId: descriptor.id,
      texture: entry.texture,
      outerLayerAlpha: descriptor.outerLayerAlpha ?? 'binary',
      release: () => {
        if (released) return;
        released = true;
        this.release(descriptor.id, entry!);
      },
    };
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  referenceCount(skinId: string): number {
    return this.cache.get(skinId)?.references ?? 0;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const entry of this.cache.values()) entry.texture.dispose();
    this.cache.clear();
    this.disposed = true;
  }

  private release(skinId: string, expected: SkinCacheEntry): void {
    const current = this.cache.get(skinId);
    if (current !== expected) return;
    current.references = Math.max(0, current.references - 1);
    if (current.references > 0) return;
    current.texture.dispose();
    this.cache.delete(skinId);
  }

  private createTexture(descriptor: MinecraftSkinDescriptor): THREE.Texture {
    const texture = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url(descriptor.texturePath), (loaded) => {
        const image = loaded.image as { width?: number; height?: number } | undefined;
        const validation = validateMinecraftSkinDimensions(image?.width ?? 0, image?.height ?? 0);
        if (!validation.ok) console.error(`[player-skin] ${descriptor.id}: ${validation.reason}`);
      });
    texture.name = `player-skin:${descriptor.id}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }
}
