import { createItemStack, type ItemStack } from '../inventory';
import { ItemId } from '../items';

/**
 * Fixed boss loot. Copied from the event chest table as it stood when the
 * Mega Zombie was added. This module does not import the chest roller, so a
 * later chest change does not retune the boss.
 */
export interface MegaZombieLootEntry {
  readonly itemId: string;
  readonly min: number;
  readonly max: number;
  readonly chance: number;
  readonly required?: boolean;
}

export const MEGA_ZOMBIE_LOOT: readonly MegaZombieLootEntry[] = Object.freeze([
  { itemId: 'tnt_powerful', min: 1, max: 1, chance: 1, required: true },
  { itemId: 'tnt', min: 2, max: 2, chance: 1, required: true },
  { itemId: ItemId.TitaniumIngot, min: 1, max: 2, chance: 1, required: true },
  { itemId: ItemId.RubyIngot, min: 3, max: 5, chance: 1, required: true },
  { itemId: ItemId.Diamond, min: 7, max: 8, chance: 1, required: true },
  { itemId: ItemId.GoldIngot, min: 9, max: 11, chance: 0.95 },
  { itemId: ItemId.IronIngot, min: 11, max: 13, chance: 0.95 },
  { itemId: ItemId.Coal, min: 18, max: 22, chance: 0.9 },
  { itemId: ItemId.GoldenApple, min: 3, max: 3, chance: 1, required: true },
  { itemId: ItemId.TitaniumHoe, min: 1, max: 1, chance: 1, required: true },
  { itemId: ItemId.PotionInvisibility, min: 1, max: 1, chance: 0.85 },
  { itemId: ItemId.PotionRegeneration, min: 1, max: 1, chance: 0.85 },
  { itemId: ItemId.PotionRepair, min: 1, max: 1, chance: 0.85 },
  { itemId: ItemId.CookedBeef, min: 10, max: 10, chance: 0.9 },
  { itemId: 'obsidian', min: 10, max: 10, chance: 0.9 },
]);

function rollCount(entry: MegaZombieLootEntry, random: () => number): number {
  if (entry.min === entry.max) return entry.min;
  const span = entry.max - entry.min;
  return entry.min + Math.floor(random() * (span + 1));
}

/** Same roll shape the chest used: required entries, chance skips, then backfill. */
export function rollMegaZombieLoot(random: () => number = Math.random): ItemStack[] {
  const stacks: ItemStack[] = [];
  for (const entry of MEGA_ZOMBIE_LOOT) {
    if (!entry.required && random() > entry.chance) continue;
    stacks.push(createItemStack(entry.itemId, rollCount(entry, random)));
  }
  const requiredCount = MEGA_ZOMBIE_LOOT.filter((entry) => entry.required).length;
  if (stacks.length < requiredCount + 5) {
    for (const entry of MEGA_ZOMBIE_LOOT) {
      if (stacks.some((stack) => stack.itemId === entry.itemId)) continue;
      stacks.push(createItemStack(entry.itemId, rollCount(entry, random)));
    }
  }
  return stacks;
}
