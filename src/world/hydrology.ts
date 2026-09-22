import { MAX_GENERATED_SURFACE, SEA_LEVEL } from '../core/constants';
import { fbm2D, smoothstep } from './noise';

export type WaterBiome = 'none' | 'lake' | 'ocean';
/** Mask-classified hydrology basin. May be set on a still-dry coast column. */
export type HydrologyRegion = 'none' | 'lake' | 'ocean';

/** Normal land never drops below this. Hydrology basins may. */
export const LAND_MIN_SURFACE = 58;
/** Deepest generated hydrology floor. Typical ocean bottoms stay above this. */
export const WATER_FLOOR_MIN = 52;

export const OCEAN_SCALE = 620;
export const OCEAN_WARP = 100;
export const OCEAN_ENTER = 0.24;
export const OCEAN_CORE = 0.38;
export const OCEAN_CLASSIFY = 0.28;

export const LAKE_SCALE = 130;
export const LAKE_WARP = 30;
export const LAKE_ENTER = 0.38;
export const LAKE_CORE = 0.52;
export const LAKE_CLASSIFY = 0.41;

const OCEAN_FIELD_SALT = 4001;
const OCEAN_WARP_X_SALT = 4011;
const OCEAN_WARP_Z_SALT = 4013;
const LAKE_FIELD_SALT = 5001;
const LAKE_WARP_X_SALT = 5011;
const LAKE_WARP_Z_SALT = 5013;
const DEPTH_SALT = 6001;

export interface HydrologySample {
  readonly hydrologyRegion: HydrologyRegion;
  readonly waterMask: number;
  readonly oceanMask: number;
  readonly lakeMask: number;
  readonly targetDepth: number;
  readonly waterDepression: number;
}

/** Actual water biome: wet columns only. Dry coasts stay `none`. */
export function waterBiomeAt(height: number, region: HydrologyRegion): WaterBiome {
  if (height >= SEA_LEVEL) return 'none';
  if (region === 'ocean' || region === 'lake') return region;
  return 'none';
}

function classifyHydrologyRegion(oceanMask: number, lakeMask: number): HydrologyRegion {
  if (oceanMask >= OCEAN_CLASSIFY) return 'ocean';
  if (lakeMask >= LAKE_CLASSIFY) return 'lake';
  return 'none';
}

function fieldMask(value: number, enter: number, core: number): number {
  if (value <= enter) return 0;
  return smoothstep(enter, core, value);
}

export function hydrologyAt(numericSeed: number, x: number, z: number): HydrologySample {
  const oceanWarpX = fbm2D(numericSeed + OCEAN_WARP_X_SALT, x / 240, z / 240, 3) * OCEAN_WARP;
  const oceanWarpZ = fbm2D(numericSeed + OCEAN_WARP_Z_SALT, x / 240, z / 240, 3) * OCEAN_WARP;
  const oceanField = fbm2D(
    numericSeed + OCEAN_FIELD_SALT,
    (x + oceanWarpX) / OCEAN_SCALE,
    (z + oceanWarpZ) / OCEAN_SCALE,
    4,
  );
  const oceanMask = fieldMask(oceanField, OCEAN_ENTER, OCEAN_CORE);

  const lakeWarpX = fbm2D(numericSeed + LAKE_WARP_X_SALT, x / 72, z / 72, 2) * LAKE_WARP;
  const lakeWarpZ = fbm2D(numericSeed + LAKE_WARP_Z_SALT, x / 72, z / 72, 2) * LAKE_WARP;
  const lakeField = fbm2D(
    numericSeed + LAKE_FIELD_SALT,
    (x + lakeWarpX) / LAKE_SCALE,
    (z + lakeWarpZ) / LAKE_SCALE,
    3,
  );
  const lakeRaw = fieldMask(lakeField, LAKE_ENTER, LAKE_CORE);
  const lakeMask = lakeRaw * (1 - oceanMask);

  if (oceanMask <= 0 && lakeMask <= 0) {
    return {
      hydrologyRegion: 'none',
      waterMask: 0,
      oceanMask: 0,
      lakeMask: 0,
      targetDepth: 0,
      waterDepression: 0,
    };
  }

  const depthNoise = (fbm2D(numericSeed + DEPTH_SALT, x / 42, z / 42, 2) + 1) * 0.5;
  const oceanDepth = 3.6 + 5.4 * oceanMask + 2.1 * depthNoise * oceanMask;
  const lakeDepth = 2.1 + 4.1 * lakeMask + 1.7 * depthNoise * lakeMask;
  const waterMask = Math.max(oceanMask, lakeMask);
  const targetDepth = oceanMask >= lakeMask ? oceanDepth : lakeDepth;

  return {
    hydrologyRegion: classifyHydrologyRegion(oceanMask, lakeMask),
    waterMask,
    oceanMask,
    lakeMask,
    targetDepth,
    waterDepression: waterMask * targetDepth,
  };
}

export function applyHydrologyHeight(legacyHeight: number, hydro: HydrologySample): number {
  if (hydro.waterMask <= 0) return legacyHeight;
  const basinFloor = Math.max(WATER_FLOOR_MIN, SEA_LEVEL - hydro.targetDepth);
  const mixed = legacyHeight + (basinFloor - legacyHeight) * hydro.waterMask;
  return Math.max(WATER_FLOOR_MIN, Math.min(MAX_GENERATED_SURFACE, Math.floor(mixed)));
}
