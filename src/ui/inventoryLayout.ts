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
