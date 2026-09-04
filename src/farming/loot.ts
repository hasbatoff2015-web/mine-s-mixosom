import { BlockId, type BlockRenderState } from '../blocks';
import { ItemId } from '../items';
import { nextIntInclusive, systemRandomFn, type RandomFn } from '../gameplay/random';
import { cropAge, MAX_CROP_AGE } from './definitions';

export interface FarmingDrop {
  readonly item: string;
  readonly count: number;
}

/** Undefined delegates to the ordinary block drop; an empty array is an intentional no-drop. */
export function farmingDropsForBlock(
  block: BlockId,
  state: BlockRenderState | undefined,
  random: RandomFn = systemRandomFn,
): FarmingDrop[] | undefined {
  const mature = cropAge(state) >= MAX_CROP_AGE;
  switch (block) {
    case BlockId.WheatCrop:
      return mature
        ? [{ item: ItemId.Wheat, count: 1 }, { item: ItemId.WheatSeeds, count: nextIntInclusive(random, 1, 4) }]
        : [{ item: ItemId.WheatSeeds, count: 1 }];
    case BlockId.CarrotCrop:
      return [{ item: ItemId.Carrot, count: mature ? nextIntInclusive(random, 2, 5) : 1 }];
    case BlockId.PotatoCrop:
      return [{ item: ItemId.Potato, count: mature ? nextIntInclusive(random, 2, 5) : 1 }];
    case BlockId.MelonStem:
      return [{ item: ItemId.MelonSeeds, count: 1 }];
    case BlockId.PumpkinStem:
      return [{ item: ItemId.PumpkinSeeds, count: 1 }];
    case BlockId.Melon:
      return [{ item: ItemId.MelonSlice, count: nextIntInclusive(random, 3, 7) }];
    case BlockId.Pumpkin:
      return [{ item: 'pumpkin', count: 1 }];
    case BlockId.TallGrass:
    case BlockId.Fern: {
      const drops: FarmingDrop[] = [];
      if (random() < 0.125) drops.push({ item: ItemId.WheatSeeds, count: 1 });
      // Save-safe initial source: no worldgen decorator, so existing chunks never gain patches.
      if (random() < 0.005) drops.push({ item: ItemId.PumpkinSeeds, count: 1 });
      if (random() < 0.005) drops.push({ item: ItemId.MelonSeeds, count: 1 });
      return drops;
    }
    default:
      return undefined;
  }
}
