import { ItemId } from '../../src/items';
import { createItemStack, type ItemStack } from '../../src/inventory';

export interface LootRange {
  readonly itemId: string;
  readonly min: number;
  readonly max: number;
  readonly chance: number;
  readonly required?: boolean;
}

/**
 * Generous daily chest pool. Required entries always drop; others may skip
 * so two events are not identical, but most of the list still appears.
 */
export const EVENT_CHEST_LOOT_TABLE: readonly LootRange[] = Object.freeze([
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

function rollCount(entry: LootRange, random: () => number): number {
  if (entry.min === entry.max) return entry.min;
  const span = entry.max - entry.min;
  return entry.min + Math.floor(random() * (span + 1));
}

export function generateEventChestLoot(random: () => number = Math.random): ItemStack[] {
  const stacks: ItemStack[] = [];
  for (const entry of EVENT_CHEST_LOOT_TABLE) {
    if (!entry.required && random() > entry.chance) continue;
    stacks.push(createItemStack(entry.itemId, rollCount(entry, random)));
  }
  const requiredCount = EVENT_CHEST_LOOT_TABLE.filter((entry) => entry.required).length;
  if (stacks.length < requiredCount + 5) {
    for (const entry of EVENT_CHEST_LOOT_TABLE) {
      if (stacks.some((stack) => stack.itemId === entry.itemId)) continue;
      stacks.push(createItemStack(entry.itemId, rollCount(entry, random)));
    }
  }
  return stacks;
}

export function fillChestSlots(loot: readonly ItemStack[], random: () => number = Math.random): Array<ItemStack | null> {
  const slots: Array<ItemStack | null> = Array.from({ length: 27 }, () => null);
  const order = loot.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i]!;
    order[i] = order[j]!;
    order[j] = swap;
  }
  const used = new Set<number>();
  for (let i = 0; i < order.length && i < 27; i += 1) {
    let slot = Math.floor(random() * 27);
    let guard = 0;
    while (used.has(slot) && guard < 32) {
      slot = (slot + 1) % 27;
      guard += 1;
    }
    used.add(slot);
    slots[slot] = loot[order[i]!]!;
  }
  return slots;
}
