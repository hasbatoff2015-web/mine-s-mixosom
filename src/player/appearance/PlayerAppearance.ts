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
