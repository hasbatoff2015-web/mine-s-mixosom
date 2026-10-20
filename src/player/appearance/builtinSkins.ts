import type { PlayerModelVariant } from './PlayerAppearance';
import { GENERATED_MINECRAFT_SKINS } from './generatedPlayerSkins';

export const QA_PLAYER_SKIN_ID = 'player_uv_test';
export const NPC_PLAYER_SKIN_ID = 'buyer_merchant';

export type PlayerSkinOuterAlpha = 'binary' | 'translucent';

export interface MinecraftSkinDescriptor {
  readonly id: string;
  readonly texturePath: string;
  readonly defaultModel: PlayerModelVariant;
  /** Omitted for the normal opaque-cutout outer layer. */
  readonly outerLayerAlpha?: PlayerSkinOuterAlpha;
}

/**
 * Built-in 64×64 skins plus the DEV UV QA sheet.
 * Player and NPC rows come from `generatedPlayerSkins.ts` (one PNG, one descriptor).
 * Data-only; no textures or Three.js.
 */
export const BUILTIN_MINECRAFT_SKINS: readonly MinecraftSkinDescriptor[] = Object.freeze([
  ...GENERATED_MINECRAFT_SKINS,
  { id: QA_PLAYER_SKIN_ID, texturePath: 'entity/player_uv_test', defaultModel: 'classic' },
]);

/** Production selector catalog: player skins only (no DEV UV sheet, no NPC merchant). */
export const PRODUCTION_PLAYER_SKINS: readonly MinecraftSkinDescriptor[] = Object.freeze(
  BUILTIN_MINECRAFT_SKINS.filter((skin) => skin.id !== QA_PLAYER_SKIN_ID && skin.id !== NPC_PLAYER_SKIN_ID),
);

const REGISTERED_SKIN_IDS = new Set(BUILTIN_MINECRAFT_SKINS.map((skin) => skin.id));
const PRODUCTION_SKIN_IDS = new Set(PRODUCTION_PLAYER_SKINS.map((skin) => skin.id));
const SKINS_BY_ID = new Map(BUILTIN_MINECRAFT_SKINS.map((skin) => [skin.id, skin]));

export function isRegisteredSkinId(skinId: string): boolean {
  return REGISTERED_SKIN_IDS.has(skinId);
}

export function isProductionSkinId(skinId: string): boolean {
  return PRODUCTION_SKIN_IDS.has(skinId);
}

export function skinDescriptor(skinId: string): MinecraftSkinDescriptor | undefined {
  return SKINS_BY_ID.get(skinId);
}

export function skinHasTranslucentOuterLayer(skinId: string): boolean {
  return SKINS_BY_ID.get(skinId)?.outerLayerAlpha === 'translucent';
}
