import { createItemStack, type ItemStack } from '../inventory';
import { FUEL_REMAINDERS } from './recipes';

/**
 * Consume one fuel item. A remainder (lava bucket → bucket) replaces a
 * single consumed item in the fuel slot. Stacked fuels only lose one count;
 * remainder fuels are required to be max stack 1.
 */
export function consumeFurnaceFuel(fuel: ItemStack): ItemStack | null {
  const remainderId = FUEL_REMAINDERS[fuel.itemId];
  if (fuel.count <= 1) return remainderId ? createItemStack(remainderId, 1) : null;
  return { ...fuel, count: fuel.count - 1 };
}
