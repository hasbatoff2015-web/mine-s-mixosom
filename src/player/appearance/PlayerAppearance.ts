import {
  isProductionSkinId,
  skinDescriptor,
} from './builtinSkins';

export type PlayerModelVariant = 'classic' | 'slim';

export interface PlayerSkinLayers {
  readonly hat: boolean;
  readonly jacket: boolean;
  readonly leftSleeve: boolean;
  readonly rightSleeve: boolean;
  readonly leftPants: boolean;
  readonly rightPants: boolean;
}

export interface PlayerAppearance {
  /** Stable registry key. Network snapshots should carry this id, never raw image bytes. */
  readonly skinId: string;
  readonly model: PlayerModelVariant;
  readonly layers: PlayerSkinLayers;
}

export const ALL_PLAYER_SKIN_LAYERS: PlayerSkinLayers = Object.freeze({
  hat: true,
  jacket: true,
  leftSleeve: true,
  rightSleeve: true,
  leftPants: true,
  rightPants: true,
});

export const DEFAULT_PLAYER_APPEARANCE: PlayerAppearance = Object.freeze({
  skinId: 'frontier_explorer',
  model: 'classic',
  layers: ALL_PLAYER_SKIN_LAYERS,
});

const TEXTURE_PAYLOAD_KEYS = ['texture', 'png', 'base64', 'image', 'dataUrl', 'pixels', 'bytes'] as const;

export function createPlayerAppearance(
  appearance: Partial<Omit<PlayerAppearance, 'layers'>> & {
    readonly layers?: Partial<PlayerSkinLayers>;
  } = {},
): PlayerAppearance {
  return Object.freeze({
    skinId: appearance.skinId?.trim() || DEFAULT_PLAYER_APPEARANCE.skinId,
    model: appearance.model === 'slim' ? 'slim' : 'classic',
    layers: Object.freeze({ ...ALL_PLAYER_SKIN_LAYERS, ...appearance.layers }),
  });
}

export function appearancesEqual(a: PlayerAppearance, b: PlayerAppearance): boolean {
  return a.skinId === b.skinId
    && a.model === b.model
    && a.layers.hat === b.layers.hat
    && a.layers.jacket === b.layers.jacket
    && a.layers.leftSleeve === b.layers.leftSleeve
    && a.layers.rightSleeve === b.layers.rightSleeve
    && a.layers.leftPants === b.layers.leftPants
    && a.layers.rightPants === b.layers.rightPants;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasTexturePayload(raw: Record<string, unknown>): boolean {
  return TEXTURE_PAYLOAD_KEYS.some((key) => raw[key] !== undefined);
}

function parseLayers(raw: unknown): PlayerSkinLayers | undefined {
  if (raw === undefined) return ALL_PLAYER_SKIN_LAYERS;
  if (!isRecord(raw)) return undefined;
  const layers = { ...ALL_PLAYER_SKIN_LAYERS };
  for (const key of Object.keys(ALL_PLAYER_SKIN_LAYERS) as Array<keyof PlayerSkinLayers>) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') return undefined;
    layers[key] = raw[key];
  }
  return Object.freeze(layers);
}

/**
 * Structural network parse. Accepts only `{ skinId, model, layers }` metadata.
 * Texture/PNG/base64 fields are rejected. Unknown skinId is left for the server whitelist.
 */
export function parseNetworkAppearance(raw: unknown): PlayerAppearance | undefined {
  if (!isRecord(raw) || hasTexturePayload(raw)) return undefined;
  if (typeof raw.skinId !== 'string') return undefined;
  const skinId = raw.skinId.trim();
  if (!skinId || skinId.length > 64 || /[^a-zA-Z0-9_-]/.test(skinId)) return undefined;
  if (raw.model !== undefined && raw.model !== 'classic' && raw.model !== 'slim') return undefined;
  const layers = parseLayers(raw.layers);
  if (!layers) return undefined;
  return createPlayerAppearance({
    skinId,
    model: raw.model === 'slim' ? 'slim' : 'classic',
    layers,
  });
}

/** Server/client whitelist: production skins only, never texture bytes. */
export function sanitizeRegisteredAppearance(raw: unknown): PlayerAppearance | undefined {
  const parsed = parseNetworkAppearance(raw);
  if (!parsed || !isProductionSkinId(parsed.skinId)) return undefined;
  return parsed;
}

export function appearanceFromSkinId(
  skinId: string,
  layers: PlayerSkinLayers = ALL_PLAYER_SKIN_LAYERS,
  model?: PlayerModelVariant,
): PlayerAppearance {
  const descriptor = skinDescriptor(skinId);
  return createPlayerAppearance({
    skinId: descriptor?.id ?? DEFAULT_PLAYER_APPEARANCE.skinId,
    model: model ?? descriptor?.defaultModel ?? DEFAULT_PLAYER_APPEARANCE.model,
    layers,
  });
}

export function toNetworkAppearance(appearance: PlayerAppearance): PlayerAppearance {
  return createPlayerAppearance(appearance);
}
