import type { VoxelWorld } from './World';

/**
 * Lighting *mode* is a host concern. The flood implementation stays in LightEngine.
 *
 * - `deferred` — client: queue dirty regions, drain with `WORLD_LIGHT_BUDGET_MS`.
 * - `immediate` — server/tests: `setBlock` relights before returning.
 */
export type LightingMode = 'immediate' | 'deferred';

export interface LightingWorkCounters {
  attempted: number;
  completed: number;
  yielded: number;
  blocked: number;
}

export function lightingModeOf(world: Pick<VoxelWorld, 'deferredLighting'>): LightingMode {
  return world.deferredLighting ? 'deferred' : 'immediate';
}

/**
 * Client streaming/frame lighting. Immediate worlds return 0 so a server tick
 * cannot accidentally run the budgeted client scheduler.
 */
export function processDeferredLighting(
  world: VoxelWorld,
  budgetMs: number,
  originX: number,
  originZ: number,
  counters?: LightingWorkCounters,
): number {
  if (lightingModeOf(world) !== 'deferred') return 0;
  return world.processLighting(budgetMs, originX, originZ, counters);
}
