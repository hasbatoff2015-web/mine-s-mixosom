/**
 * Creative catalog lives in a static DOM node. Slot interactions must patch
 * player/craft/cursor HTML without remounting that catalog or the scroll window.
 */

export type InventoryPaintMode = 'mount' | 'patch-dynamic';

export function inventoryPaintMode(modalOpen: boolean): InventoryPaintMode {
  return modalOpen ? 'patch-dynamic' : 'mount';
}

export interface InventoryDomRoot {
  querySelector(selector: string): { innerHTML: string } | null;
}

/**
 * Updates only the changing panels. Returns false when the shell is missing
 * (caller should mount from scratch). Does not touch catalog or scrollTop.
 */
export function patchInventoryDynamic(
  root: InventoryDomRoot,
  dynamicHtml: string,
  cursorHtml: string,
): boolean {
  const dynamic = root.querySelector('[data-inventory-dynamic]');
  const cursor = root.querySelector('#cursor-stack');
  if (!dynamic || !cursor) return false;
  dynamic.innerHTML = dynamicHtml;
  cursor.innerHTML = cursorHtml;
  return true;
}

export function patchContainerDynamic(
  root: InventoryDomRoot,
  parts: { body: string; player: string; recipeGrid?: string; cursor: string },
): boolean {
  const body = root.querySelector('[data-container-body]');
  const player = root.querySelector('[data-player-inventory]');
  const cursor = root.querySelector('#cursor-stack');
  if (!body || !player || !cursor) return false;
  body.innerHTML = parts.body;
  player.innerHTML = parts.player;
  cursor.innerHTML = parts.cursor;
  const grid = root.querySelector('[data-recipe-grid]');
  if (grid && parts.recipeGrid !== undefined) grid.innerHTML = parts.recipeGrid;
  return true;
}
