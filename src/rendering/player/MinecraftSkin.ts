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
  url: string;
  references: number;
}

function isBrowserDev(): boolean {
  return import.meta.env.DEV === true
    && typeof document !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:/.test(location.protocol);
}

function hexSha256(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function logSkinAcquire(info: {
  requestedSkinId: string;
  skinId: string;
  texturePath: string;
  url: string;
  cache: 'HIT' | 'MISS' | 'RELOAD';
  fallback: boolean;
}): void {
  if (!isBrowserDev()) return;
  const lines = [
    `[player-skin] ${info.requestedSkinId}`,
    `  resolved: ${info.skinId}`,
    `  path: ${info.texturePath}`,
    `  URL: ${info.url}`,
    `  cache: ${info.cache}`,
  ];
  if (info.fallback) lines.push(`  FALLBACK: descriptor missing, using ${info.skinId}`);
  console.info(lines.join('\n'));
}

function logSkinImage(descriptor: MinecraftSkinDescriptor, url: string, loaded: THREE.Texture): void {
  if (!isBrowserDev()) return;
  const image = loaded.image as { src?: string; width?: number; height?: number } | undefined;
  console.info(`[player-skin] ${descriptor.id} loaded: ${image?.width ?? 0}x${image?.height ?? 0} image.src=${image?.src ?? ''}`);
  if (typeof fetch !== 'function' || typeof crypto === 'undefined' || !crypto.subtle) return;
  void fetch(url, { cache: 'no-store' }).then(async (response) => {
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    console.info(`[player-skin] ${descriptor.id} sha256=${hexSha256(digest)}`);
  }).catch((error: unknown) => {
    console.warn(`[player-skin] ${descriptor.id} byte probe failed`, error);
  });
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
    const exact = this.descriptors.get(requestedSkinId);
    const descriptor = exact ?? this.descriptors.get('frontier_explorer');
    if (!descriptor) throw new Error(`Unknown skin '${requestedSkinId}' and no default skin is registered.`);
    const url = TextureAtlas.url(descriptor.texturePath);
    let entry = this.cache.get(descriptor.id);
    let cache: 'HIT' | 'MISS' | 'RELOAD' = 'HIT';
    if (!entry) {
      entry = { texture: this.createTexture(descriptor, url), url, references: 0 };
      this.cache.set(descriptor.id, entry);
      cache = 'MISS';
    } else if (entry.url !== url) {
      this.loadTexture(entry.texture, descriptor, url);
      entry.url = url;
      cache = 'RELOAD';
    }
    logSkinAcquire({
      requestedSkinId,
      skinId: descriptor.id,
      texturePath: descriptor.texturePath,
      url,
      cache,
      fallback: !exact,
    });
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

  private createTexture(descriptor: MinecraftSkinDescriptor, url: string): THREE.Texture {
    const texture = typeof document === 'undefined'
      ? new THREE.Texture()
      : this.loadTexture(new THREE.Texture(), descriptor, url);
    texture.name = `player-skin:${descriptor.id}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  private loadTexture(
    texture: THREE.Texture,
    descriptor: MinecraftSkinDescriptor,
    url: string,
  ): THREE.Texture {
    new THREE.TextureLoader().load(url, (loaded) => {
      texture.image = loaded.image;
      texture.needsUpdate = true;
      const image = loaded.image as { width?: number; height?: number } | undefined;
      const validation = validateMinecraftSkinDimensions(image?.width ?? 0, image?.height ?? 0);
      if (!validation.ok) console.error(`[player-skin] ${descriptor.id}: ${validation.reason}`);
      logSkinImage(descriptor, url, loaded);
    });
    return texture;
  }
}
