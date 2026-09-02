/**
 * Simulation lighting queries (spawn, fire, sunlight, entity sample).
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
