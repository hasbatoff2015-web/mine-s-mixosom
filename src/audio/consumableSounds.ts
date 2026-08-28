import type { NamedSoundEventId } from './soundEvents';

/** Potions are food-kind items that return a bottle; they use the drink sample. */
export function consumableSoundEvent(item: {
  readonly id: string;
  readonly food?: { readonly returnsItem?: string };
}): Extract<NamedSoundEventId, 'food.eat' | 'potion.drink'> {
  if (item.id.startsWith('potion_') || item.food?.returnsItem === 'glass_bottle') return 'potion.drink';
  return 'food.eat';
}
