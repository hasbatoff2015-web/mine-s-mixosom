/** Logical Minecraft Java container metrics (not CSS pixels). */
export const MC_SLOT_PITCH = 18;
export const MC_SLOT_ITEM = 16;
export const MC_CONTAINER_WIDTH = 176;
export const MC_FURNACE_HEIGHT = 166;
export const MC_CRAFTING_HEIGHT = 166;
export const MC_CHEST_HEIGHT = 168;
export const MC_INVENTORY_HEIGHT = 166;
export const MC_CREATIVE_WIDTH = 195;
export const MC_CREATIVE_HEIGHT = 222;
export const MC_CREATIVE_SCROLL_GUTTER = 8;
export const MC_RECIPE_BOOK_WIDTH = 147;
export const MC_RECIPE_BOOK_GAP = 4;
/** Book toggle lives inside the craft row, not as extra stage width. */
export const MC_BOOK_BUTTON_IN_CRAFT_ROW = true;
export const MC_PLAYER_INV_TOP = 84;
export const MC_HOTBAR_GAP = 4;
export const MC_MAX_UI_SCALE = 4;
export const MC_MIN_UI_SCALE = 0.5;
/** Logical px reserved so the close control sits outside the panel, not over tabs. */
export const MC_CLOSE_GUTTER = 20;
/** Minimum touch target for the outside close control. */
export const MC_CLOSE_HIT_MIN_PX = 44;

export function containerUiScaleWithClose(
  viewportWidth: number,
  viewportHeight: number,
  logicalWidth: number,
  logicalHeight: number,
): number {
  return containerUiScale(viewportWidth, viewportHeight, logicalWidth + MC_CLOSE_GUTTER, logicalHeight);
}

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
  kind: 'inventory' | 'crafting-table' | 'chest' | 'furnace' | 'creative',
  recipeBookOpen: boolean,
): { width: number; height: number } {
  if (kind === 'creative') return { width: MC_CREATIVE_WIDTH, height: MC_CREATIVE_HEIGHT };
  const height = kind === 'chest' ? MC_CHEST_HEIGHT
    : kind === 'furnace' || kind === 'crafting-table' ? MC_FURNACE_HEIGHT
      : MC_INVENTORY_HEIGHT;
  const bookExtra = recipeBookOpen ? MC_RECIPE_BOOK_WIDTH + MC_RECIPE_BOOK_GAP : 0;
  return { width: MC_CONTAINER_WIDTH + bookExtra, height };
}
