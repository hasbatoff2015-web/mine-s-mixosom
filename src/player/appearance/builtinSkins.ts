import type { PlayerModelVariant } from './PlayerAppearance';

export const QA_PLAYER_SKIN_ID = 'player_uv_test';

export type PlayerSkinOuterAlpha = 'binary' | 'translucent';

export interface MinecraftSkinDescriptor {
  readonly id: string;
  readonly texturePath: string;
  readonly defaultModel: PlayerModelVariant;
  /** Omitted for the normal opaque-cutout outer layer. */
  readonly outerLayerAlpha?: PlayerSkinOuterAlpha;
}

/** Built-in 64×64 skins including the DEV UV QA sheet. Data-only; no textures or Three.js. */
export const BUILTIN_MINECRAFT_SKINS: readonly MinecraftSkinDescriptor[] = Object.freeze([
  { id: '00f6338deb336a6e', texturePath: 'player/skins/00f6338deb336a6e', defaultModel: 'slim', outerLayerAlpha: 'translucent' },
  { id: '0edde60fa266fac7', texturePath: 'player/skins/0edde60fa266fac7', defaultModel: 'slim' },
  { id: '0f15ad5e5c148f40', texturePath: 'player/skins/0f15ad5e5c148f40', defaultModel: 'slim', outerLayerAlpha: 'translucent' },
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
  { id: '55264c2ebdb9ed9d', texturePath: 'player/skins/55264c2ebdb9ed9d', defaultModel: 'slim', outerLayerAlpha: 'translucent' },
  { id: '554ec16161f085c0', texturePath: 'player/skins/554ec16161f085c0', defaultModel: 'slim' },
  { id: '5620ef1df645276e', texturePath: 'player/skins/5620ef1df645276e', defaultModel: 'classic' },
  { id: '5bc8ad7edfb7ee86', texturePath: 'player/skins/5bc8ad7edfb7ee86', defaultModel: 'slim', outerLayerAlpha: 'translucent' },
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
  { id: QA_PLAYER_SKIN_ID, texturePath: 'entity/player_uv_test', defaultModel: 'classic' },
  { id: 'buyer_merchant', texturePath: 'player/skins/buyer_merchant', defaultModel: 'classic' },
]);

/** Production selector catalog: player skins only (no DEV UV sheet, no NPC merchant). */
export const PRODUCTION_PLAYER_SKINS: readonly MinecraftSkinDescriptor[] = Object.freeze(
  BUILTIN_MINECRAFT_SKINS.filter((skin) => skin.id !== QA_PLAYER_SKIN_ID && skin.id !== 'buyer_merchant'),
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
