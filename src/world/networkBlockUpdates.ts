import { BlockId, type BlockRenderState } from '../blocks';
import type { VoxelWorld } from './World';

/** One networked voxel write: block id plus optional render/fluid state. */
export interface NetworkBlockChange {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
  readonly state?: BlockRenderState;
}

/**
 * Apply a server `block_update` / `block_batch` the same way initial chunk
 * restore does: voxel id first, then full `BlockRenderState`.
 *
 * Live packets used to send only `blockId`. `writeBlockRaw` deletes state, so
 * water/lava defaulted to source height 8 (square tops) and chests/doors lost
 * facing. Loaded worlds looked correct because `welcome.blockStates` had levels.
 *
 * Neighbor fluid corners are dirtied by `setBlock` / `setBlockState` (including
 * chunk borders). Callers should pass the whole batch at once so one frame's
 * `processWorldJobs` remeshes each chunk once.
 */
export function applyNetworkBlockChanges(
  world: VoxelWorld,
  changes: readonly NetworkBlockChange[],
): { applied: number; chunksDirtied: number } {
  const unique = new Map<string, NetworkBlockChange>();
  for (const change of changes) {
    unique.set(`${change.x},${change.y},${change.z}`, change);
  }
  const mutations: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
  const states: NetworkBlockChange[] = [];
  for (const change of unique.values()) {
    mutations.push({ x: change.x, y: change.y, z: change.z, block: change.blockId as BlockId });
    if (change.blockId !== BlockId.Air && change.state) states.push(change);
  }
  const stats = mutations.length === 0
    ? { applied: 0, chunksDirtied: 0 }
    : world.applyBlockBatch(mutations, {
      deferLighting: true,
      scheduleNeighbors: false,
      skipSupport: true,
    });
  let stateWrites = 0;
  for (const change of states) {
    if (world.setBlockState(change.x, change.y, change.z, change.state!)) stateWrites += 1;
  }
  return {
    applied: stats.applied + stateWrites,
    chunksDirtied: world.dirtyChunkCount,
  };
}
