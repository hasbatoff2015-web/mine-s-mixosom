import * as THREE from 'three';
import { TextureAtlas } from '../TextureAtlas';
import type { PlayerModelVariant } from '../../player/appearance/PlayerAppearance';

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

export interface MinecraftSkinDescriptor {
  readonly id: string;
  readonly texturePath: string;
  readonly defaultModel: PlayerModelVariant;
}

export const BUILTIN_MINECRAFT_SKINS: readonly MinecraftSkinDescriptor[] = Object.freeze([
  { id: '00f6338deb336a6e', texturePath: 'player/skins/00f6338deb336a6e', defaultModel: 'slim' },
  { id: '0edde60fa266fac7', texturePath: 'player/skins/0edde60fa266fac7', defaultModel: 'slim' },
  { id: '0f15ad5e5c148f40', texturePath: 'player/skins/0f15ad5e5c148f40', defaultModel: 'slim' },
  { id: '134f7844391b9382', texturePath: 'player/skins/134f7844391b9382', defaultModel: 'slim' },
  { id: '1ea0cee32dd870ba', texturePath: 'player/skins/1ea0cee32dd870ba', defaultModel: 'slim' },
  { id: '24f3321d8a6ec3cf', texturePath: 'player/skins/24f3321d8a6ec3cf', defaultModel: 'slim' },
  { id: '2cd5c775d21141bd', texturePath: 'player/skins/2cd5c775d21141bd', defaultModel: 'classic' },
  { id: '2e8c98dab33b766f', texturePath: 'player/skins/2e8c98dab33b766f', defaultModel: 'slim' },
  { id: '3095ca131afb5705', texturePath: 'player/skins/3095ca131afb5705', defaultModel: 'slim' },
  { id: '333971ad9949346f', texturePath: 'player/skins/333971ad9949346f', defaultModel: 'classic' },
  { id: 'frontier_explorer', texturePath: 'player/skins/frontier_explorer', defaultModel: 'classic' },
  { id: '37e10d3fc9798c98', texturePath: 'player/skins/37e10d3fc9798c98', defaultModel: 'classic' },
  { id: '48458b73d1075c60', texturePath: 'player/skins/48458b73d1075c60', defaultModel: 'classic' },
  { id: '4c7afbcaeb250f76', texturePath: 'player/skins/4c7afbcaeb250f76', defaultModel: 'slim' },
  { id: '55264c2ebdb9ed9d', texturePath: 'player/skins/55264c2ebdb9ed9d', defaultModel: 'slim' },
  { id: '554ec16161f085c0', texturePath: 'player/skins/554ec16161f085c0', defaultModel: 'slim' },
  { id: '5620ef1df645276e', texturePath: 'player/skins/5620ef1df645276e', defaultModel: 'classic' },
  { id: '5bc8ad7edfb7ee86', texturePath: 'player/skins/5bc8ad7edfb7ee86', defaultModel: 'slim' },
  { id: '6119ea42953f535e', texturePath: 'player/skins/6119ea42953f535e', defaultModel: 'slim' },
  { id: '7c6103b44dc95a65', texturePath: 'player/skins/7c6103b44dc95a65', defaultModel: 'classic' },
  { id: '7d729ce6664b4fdc', texturePath: 'player/skins/7d729ce6664b4fdc', defaultModel: 'slim' },
  { id: '803d711fa90035a7', texturePath: 'player/skins/803d711fa90035a7', defaultModel: 'slim' },
  { id: '8bb9550c824ce10e', texturePath: 'player/skins/8bb9550c824ce10e', defaultModel: 'slim' },
  { id: '8bc8f731d8e5ca7c', texturePath: 'player/skins/8bc8f731d8e5ca7c', defaultModel: 'classic' },
  { id: '8cd9d4ce5d4d8abf', texturePath: 'player/skins/8cd9d4ce5d4d8abf', defaultModel: 'classic' },
  { id: '960e4805666e1591', texturePath: 'player/skins/960e4805666e1591', defaultModel: 'classic' },
  { id: '96680c9dd86bcabc', texturePath: 'player/skins/96680c9dd86bcabc', defaultModel: 'slim' },
  { id: '985483b761dcaceb', texturePath: 'player/skins/985483b761dcaceb', defaultModel: 'classic' },
  { id: 'ae1fddb72664eaf2', texturePath: 'player/skins/ae1fddb72664eaf2', defaultModel: 'classic' },
  { id: 'b1ebc7b52d0c7f61', texturePath: 'player/skins/b1ebc7b52d0c7f61', defaultModel: 'slim' },
  { id: 'b5db0069a126bbf3', texturePath: 'player/skins/b5db0069a126bbf3', defaultModel: 'slim' },
  { id: 'bc3e8672b6d7c821', texturePath: 'player/skins/bc3e8672b6d7c821', defaultModel: 'slim' },
  { id: 'bc7db647674d1f01', texturePath: 'player/skins/bc7db647674d1f01', defaultModel: 'slim' },
  { id: 'c026b7f8552098de', texturePath: 'player/skins/c026b7f8552098de', defaultModel: 'slim' },
  { id: 'c6ffa466e0aa2e48', texturePath: 'player/skins/c6ffa466e0aa2e48', defaultModel: 'classic' },
  { id: 'c7e629b4f28c56a5', texturePath: 'player/skins/c7e629b4f28c56a5', defaultModel: 'slim' },
  { id: 'd5f7c69c89edd405', texturePath: 'player/skins/d5f7c69c89edd405', defaultModel: 'classic' },
  { id: 'dce095dc5bddc925', texturePath: 'player/skins/dce095dc5bddc925', defaultModel: 'classic' },
  { id: 'dcf537aec75f761d', texturePath: 'player/skins/dcf537aec75f761d', defaultModel: 'slim' },
  { id: 'dee6149d4583a54b', texturePath: 'player/skins/dee6149d4583a54b', defaultModel: 'classic' },
  { id: 'e126128225dccc51', texturePath: 'player/skins/e126128225dccc51', defaultModel: 'classic' },
  { id: 'e203f6b2fd4c30dc', texturePath: 'player/skins/e203f6b2fd4c30dc', defaultModel: 'classic' },
  { id: 'e3eb6f99ea1c3fe1', texturePath: 'player/skins/e3eb6f99ea1c3fe1', defaultModel: 'slim' },
  { id: 'e936712cae837a84', texturePath: 'player/skins/e936712cae837a84', defaultModel: 'classic' },
  { id: 'f47ebc2553e02251', texturePath: 'player/skins/f47ebc2553e02251', defaultModel: 'slim' },
  { id: 'player_uv_test', texturePath: 'entity/player_uv_test', defaultModel: 'classic' },
]);

export interface SkinTextureHandle {
  readonly skinId: string;
  readonly texture: THREE.Texture;
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
