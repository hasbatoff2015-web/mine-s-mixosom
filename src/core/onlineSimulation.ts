/**
 * Online Anarchy: the server owns world/fluid/mob/combat ticks.
 * The client still renders and sends input; it must not run a second sim.
 */
import type { LifecycleState } from './lifecycleTypes';

export function shouldRunClientWorldSimulation(online: boolean): boolean {
  return !online;
}

export function shouldRunClientFluidSimulation(online: boolean): boolean {
  return shouldRunClientWorldSimulation(online);
}

/**
 * Lighting + remesh for voxels the server already sent.
 *
 * Distinct from `worldSimulationActive` (PLAYING-only kernel/tickOnline).
 * Inventory stays PLAYING. Pause overlay and BACKGROUND still receive
 * WebSocket `block_update` / `block_batch` into VoxelWorld; visuals must
 * drain dirty light/mesh jobs while the client is still rendering.
 *
 * Hidden-tab RAF throttling is the browser's. Do not skip job drain when a
 * frame does run — resume then just paints already-current meshes.
 */
export function shouldProcessOnlineWorldVisuals(lifecycle: LifecycleState): boolean {
  return lifecycle === 'PLAYING' || lifecycle === 'PAUSED' || lifecycle === 'BACKGROUND';
}
