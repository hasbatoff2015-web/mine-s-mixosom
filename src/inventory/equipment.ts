import type { PlayerEquipmentState } from '../../shared/protocol';
import type { Inventory } from './inventory';

export const EMPTY_PLAYER_EQUIPMENT: PlayerEquipmentState = Object.freeze({
  head: null,
  chest: null,
  legs: null,
  feet: null,
});

/** Small identity-only projection; durability and metadata stay in authoritative inventory packets. */
export function playerEquipmentFromInventory(
  inventory: Pick<Inventory, 'armor'>,
): PlayerEquipmentState {
  const armor = inventory.armor;
  return {
    head: armor.head?.itemId ?? null,
    chest: armor.chest?.itemId ?? null,
    legs: armor.legs?.itemId ?? null,
    feet: armor.feet?.itemId ?? null,
  };
}
