/** Logical Minecraft Java container metrics (not CSS pixels). */
export const MC_SLOT_PITCH = 18;
export const MC_SLOT_ITEM = 16;
export const MC_CONTAINER_WIDTH = 176;
export const MC_FURNACE_HEIGHT = 166;
export const MC_CRAFTING_HEIGHT = 166;
export const MC_CHEST_HEIGHT = 168;
export const MC_INVENTORY_HEIGHT = 166;
export const MC_RECIPE_BOOK_WIDTH = 147;
export const MC_PLAYER_INV_TOP = 84;
export const MC_HOTBAR_GAP = 4;
export const MC_MAX_UI_SCALE = 4;
export const MC_MIN_UI_SCALE = 0.5;

export function containerUiScale(
  viewportWidth: number,
  viewportHeight: number,
  logicalWidth: number,
  logicalHeight: number,
): number {
  const pad = 24;
  const availableW = Math.max(160, viewportWidth - pad);
  const availableH = Math.max(140, viewportHeight - pad);
  const raw = Math.min(availableW / logicalWidth, availableH / logicalHeight, MC_MAX_UI_SCALE);
  const quantized = Math.max(MC_MIN_UI_SCALE, Math.floor(raw * 2) / 2);
  return Math.min(MC_MAX_UI_SCALE, Math.max(MC_MIN_UI_SCALE, quantized));
}

export function containerStageSize(
  kind: 'inventory' | 'crafting-table' | 'chest' | 'furnace',
  recipeBookOpen: boolean,
): { width: number; height: number } {
  const height = kind === 'chest' ? MC_CHEST_HEIGHT
    : kind === 'furnace' || kind === 'crafting-table' ? MC_FURNACE_HEIGHT
      : MC_INVENTORY_HEIGHT;
  const width = MC_CONTAINER_WIDTH + (recipeBookOpen ? MC_RECIPE_BOOK_WIDTH + 4 : 0);
  return { width, height };
}
