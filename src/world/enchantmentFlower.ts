import { BlockId, type BlockRenderState } from '../blocks';
import { ItemId } from '../items';
import { blockKey, floorDiv, parseBlockKey, CHUNK_SIZE } from '../core/constants';
import type { RandomFn } from '../gameplay/random';
import type { VoxelWorld } from './World';

/** Twelve real minutes. Wall clock, not loaded-chunk ticks. */
export const ENCHANTMENT_FLOWER_GROW_MS = 12 * 60 * 1000;

export function syncEnchantmentClock(
  index: Map<string, number>,
  key: string,
  state: Pick<BlockRenderState, 'plantedAtMs' | 'age'> | undefined,
): void {
  const planted = state?.plantedAtMs;
  if (typeof planted === 'number' && Number.isFinite(planted) && (state?.age ?? 0) < 1) {
    index.set(key, planted);
  } else index.delete(key);
}

/**
 * Natural flowers have no age and are already mature.
 * A planted root stores `age: 0` plus `plantedAtMs`.
 */
export function enchantmentFlowerMature(state: BlockRenderState | undefined): boolean {
  if (!state || state.age === undefined) return true;
  return state.age >= 1;
}

export function enchantmentFlowerDrops(
  block: BlockId,
  state: BlockRenderState | undefined,
  random: RandomFn,
): { item: string; count: number }[] | undefined {
  if (block !== BlockId.EnchantmentFlower) return undefined;
  if (!enchantmentFlowerMature(state)) return [];
  return [{ item: ItemId.EnchantmentFlower, count: random() < 0.5 ? 1 : 2 }];
}

export function tickEnchantmentFlowers(world: VoxelWorld, nowMs = Date.now()): number {
  if (world.enchantmentPlantedAt.size === 0) return 0;
  let grown = 0;
  for (const [key, plantedAtMs] of [...world.enchantmentPlantedAt]) {
    if (nowMs < plantedAtMs + ENCHANTMENT_FLOWER_GROW_MS) continue;
    const { x, y, z } = parseBlockKey(key);
    const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), false);
    if (!chunk) continue;
    if (world.getBlock(x, y, z, false) !== BlockId.EnchantmentFlower) {
      world.enchantmentPlantedAt.delete(key);
      continue;
    }
    world.setBlockState(x, y, z, { age: 1 });
    world.enchantmentPlantedAt.delete(blockKey(x, y, z));
    grown += 1;
  }
  return grown;
}
