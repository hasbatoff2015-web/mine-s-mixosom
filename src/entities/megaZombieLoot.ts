import { createItemStack, type ItemStack } from '../inventory';
import { getItemDefinition, ItemId } from '../items';

/**
 * Fixed boss loot. It started as a copy of the event chest table and was
 * retuned in this module. It does not import the chest roller, so a later
 * chest change does not retune the boss.
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
  { itemId: ItemId.RubyIngot, min: 3, max: 3, chance: 1, required: true },
  { itemId: ItemId.Diamond, min: 7, max: 8, chance: 1, required: true },
  { itemId: ItemId.GoldIngot, min: 9, max: 11, chance: 0.95 },
  { itemId: ItemId.IronIngot, min: 11, max: 13, chance: 0.95 },
  { itemId: ItemId.Coal, min: 18, max: 22, chance: 0.9 },
  { itemId: ItemId.GoldenApple, min: 3, max: 3, chance: 1, required: true },
  { itemId: ItemId.TitaniumHoe, min: 1, max: 1, chance: 1, required: true },
  { itemId: ItemId.PotionInvisibility, min: 1, max: 1, chance: 0.85 },
  { itemId: ItemId.PotionRegeneration, min: 1, max: 1, chance: 0.85 },
  { itemId: ItemId.CookedBeef, min: 10, max: 10, chance: 0.9 },
  { itemId: 'obsidian', min: 10, max: 10, chance: 0.9 },
  { itemId: ItemId.CookedChicken, min: 10, max: 10, chance: 1, required: true },
  { itemId: 'oak_planks', min: 64, max: 64, chance: 1, required: true },
  { itemId: 'stone', min: 64, max: 64, chance: 1, required: true },
  { itemId: ItemId.FireworkRocket, min: 30, max: 30, chance: 1, required: true },
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

/**
 * How many piles a stack becomes.
 * One item stays one pile. Two or more become at least two piles,
 * about one pile per eight items, and never more than eight unless
 * `maxStack` cannot hold the total otherwise.
 */
export function megaZombiePileCount(count: number, maxStack: number): number {
  const total = Math.floor(count);
  const limit = Math.max(1, Math.floor(maxStack));
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (total === 1) return 1;
  const minimum = Math.ceil(total / limit);
  const preferred = Math.min(total, Math.max(2, Math.ceil(total / 8)), 8);
  return Math.max(minimum, preferred);
}

/**
 * Split one rolled count into positive pile sizes.
 * The pieces sum to `count` and each piece is at most `maxStack`.
 */
export function splitMegaZombieCount(count: number, maxStack: number, random: () => number = Math.random): number[] {
  const total = Math.floor(count);
  const limit = Math.max(1, Math.floor(maxStack));
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(limit)) return [];
  if (total === 1) return [1];
  const piles = megaZombiePileCount(total, limit);
  const base = Math.floor(total / piles);
  let extra = total - base * piles;
  const counts = new Array<number>(piles);
  for (let index = 0; index < piles; index += 1) {
    const bonus = extra > 0 ? 1 : 0;
    counts[index] = base + bonus;
    if (extra > 0) extra -= 1;
  }
  const swaps = piles * 2;
  for (let step = 0; step < swaps; step += 1) {
    const from = Math.floor(random() * piles);
    const to = Math.floor(random() * piles);
    if (from === to) continue;
    if ((counts[from] ?? 0) <= 1) continue;
    if ((counts[to] ?? 0) >= limit) continue;
    counts[from] = (counts[from] ?? 0) - 1;
    counts[to] = (counts[to] ?? 0) + 1;
  }
  return counts;
}

/** Server-side pile list. Totals match `stacks`; ids are not assigned here. */
export function splitMegaZombieStacks(stacks: readonly ItemStack[], random: () => number = Math.random): ItemStack[] {
  const piles: ItemStack[] = [];
  for (const stack of stacks) {
    const limit = getItemDefinition(stack.itemId).maxStack;
    for (const count of splitMegaZombieCount(stack.count, limit, random)) {
      piles.push(createItemStack(stack.itemId, count, {
        ...(stack.durability === undefined ? {} : { durability: stack.durability }),
        ...(stack.metadata === undefined ? {} : { metadata: stack.metadata }),
      }));
    }
  }
  return piles;
}
