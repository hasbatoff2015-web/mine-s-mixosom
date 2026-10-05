import { BlockId } from '../blocks';
import { CHUNK_SIZE, blockKey, floorDiv, parseBlockKey } from '../core/constants';
import type { BlockRenderState } from '../blocks';
import type { VoxelWorld } from './World';
import { grownTreeHeight, treeCells, treeFits, type TreeKind } from './trees';

/** Real time from planting until a sapling may become a tree. */
export const SAPLING_GROW_MS = 2 * 60 * 1000;

/** How many due saplings may become trees in one world tick. */
const SAPLING_GROW_PER_TICK = 4;

export const SAPLING_GROUND_BLOCKS: ReadonlySet<BlockId> = new Set([
  BlockId.Dirt,
  BlockId.GrassBlock,
  BlockId.Farmland,
  BlockId.SnowBlock,
]);

const SAPLING_KIND: Partial<Record<BlockId, TreeKind>> = {
  [BlockId.OakSapling]: 'oak',
  [BlockId.BirchSapling]: 'birch',
  [BlockId.SpruceSapling]: 'spruce',
};

export function saplingKind(block: BlockId): TreeKind | undefined {
  return SAPLING_KIND[block];
}

export function isSaplingBlock(block: BlockId): boolean {
  return saplingKind(block) !== undefined;
}

export function syncSaplingClock(
  index: Map<string, number>,
  key: string,
  state: Pick<BlockRenderState, 'plantedAtMs'> | undefined,
): void {
  const planted = state?.plantedAtMs;
  if (typeof planted === 'number' && Number.isFinite(planted)) index.set(key, planted);
  else index.delete(key);
}

/**
 * Grow saplings whose planted timestamp is at least two real minutes old.
 * Unloaded chunks are left alone so a restart keeps the remaining time.
 * A canopy blocked by a building stays a sapling and is tried again later.
 */
export function tickSaplings(world: VoxelWorld, nowMs = Date.now()): number {
  if (world.saplingPlantedAt.size === 0) return 0;
  const due: Array<{ key: string; x: number; y: number; z: number; block: BlockId; kind: TreeKind }> = [];
  for (const [key, plantedAtMs] of world.saplingPlantedAt) {
    if (nowMs < plantedAtMs + SAPLING_GROW_MS) continue;
    const { x, y, z } = parseBlockKey(key);
    const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), false);
    if (!chunk) continue;
    const block = world.getBlock(x, y, z, false);
    const kind = saplingKind(block);
    if (!kind) {
      world.saplingPlantedAt.delete(key);
      continue;
    }
    due.push({ key, x, y, z, block, kind });
  }
  let grown = 0;
  for (const sapling of due) {
    if (grown >= SAPLING_GROW_PER_TICK) break;
    if (tryGrowSapling(world, sapling.x, sapling.y, sapling.z, sapling.block, sapling.kind)) grown += 1;
  }
  return grown;
}

export function tryGrowSapling(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  block: BlockId,
  kind: TreeKind,
): boolean {
  if (world.getBlock(x, y, z, false) !== block) return false;
  if (!SAPLING_GROUND_BLOCKS.has(world.getBlock(x, y - 1, z, false))) return false;
  const height = grownTreeHeight(kind, x, z);
  const cells = treeCells(kind, x, y, z, height);
  if (!treeFits((cx, cy, cz) => world.getBlock(cx, cy, cz, false), cells, { x, y, z, block })) return false;
  const applied = world.applyBlockBatch(
    cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, block: cell.block })),
    { scheduleNeighbors: false },
  );
  if (applied.applied <= 0) return false;
  world.saplingPlantedAt.delete(blockKey(x, y, z));
  return true;
}
