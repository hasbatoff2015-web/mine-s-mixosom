/**
 * Simulation lighting queries (spawn, fire, sunlight) read the working arrays.
 * Entity samples use the mesh committed view while a flood is uncommitted.
 * Shader compose lives in `rendering/worldLighting.ts`.
 * Flood/budget work lives in `LightEngine` and is driven by `LightingAdapter`.
 */
export {
  combinedLight,
  getDirectSkyLight,
  sampleVoxelLightLevels,
} from './LightEngine';
export {
  lightingModeOf,
  processDeferredLighting,
  type LightingMode,
  type LightingWorkCounters,
} from './LightingAdapter';
