export { CRAFT_UNCRAFTABLE_HINT } from '../crafting/craftCatalog';
export { CRAFT_INVENTORY_FULL_MESSAGE } from '../crafting/craftOnce';

export const CRAFT_BUTTON_LABEL = 'Крафт';
export const CRAFT_MENU_TITLE = 'Создание';

/** Keep the live search draft when the field itself is focused (do not clobber caret/value). */
export function keepCraftSearchDraft(active: EventTarget | null, input: HTMLInputElement | null): boolean {
  return input !== null && active === input;
}
