const PLAINS_TINT = [0.54, 0.9, 0.42] as const;
const FOREST_TINT = [0.42, 0.78, 0.36] as const;
const DESERT_TINT = [0.74, 0.78, 0.4] as const;
const SNOWY_TINT = [0.52, 0.72, 0.5] as const;

/** Uncolored albedo. Chunk faces and inventory cubes share this. */
export const WHITE_TINT = [1, 1, 1] as const;

/** Biome 0 is plains, the default green used when an icon has no column biome. */
export function biomeGrassTint(biome: number): readonly [number, number, number] {
  if (biome === 1) return FOREST_TINT;
  if (biome === 2) return DESERT_TINT;
  if (biome === 3) return SNOWY_TINT;
  return PLAINS_TINT;
}

/**
 * Grass-biome tint, grass-block top, and leaf textures.
 * Every other face stays white so a grass-block side is not recolored.
 */
export function vegetationTextureTint(
  biomeTint: string | undefined,
  texture: string,
  biome = 0,
): readonly [number, number, number] {
  if (biomeTint !== 'grass'
    && !texture.includes('grass_block_top')
    && !texture.includes('leaves')) return WHITE_TINT;
  return biomeGrassTint(biome);
}
