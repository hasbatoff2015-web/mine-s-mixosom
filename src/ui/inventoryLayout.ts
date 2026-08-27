/**
 * Creative catalog lives in a static DOM node. Slot interactions must patch
 * player/craft/cursor HTML without remounting that catalog or the scroll window.
 * Live furnace ticks patch slot contents in place so CSS :hover stays stable.
 */

export type InventoryPaintMode = 'mount' | 'patch-dynamic';
export type CreativeInventoryTab = 'catalog' | 'inventory';

export const CREATIVE_DEFAULT_TAB: CreativeInventoryTab = 'catalog';

export function inventoryPaintMode(modalOpen: boolean): InventoryPaintMode {
  return modalOpen ? 'patch-dynamic' : 'mount';
}

export interface InventoryDomRoot {
  querySelector(selector: string): { innerHTML: string; querySelectorAll?: Function } | null;
}

export interface SlotSnapshot {
  readonly key: string;
  readonly signature: string;
  readonly className: string;
  readonly title: string;
  readonly innerHTML: string;
  readonly ghost?: string;
}

export interface MutableSlotTarget {
  key: string;
  signature: string;
  className: string;
  title: string;
  innerHTML: string;
  ghost?: string;
}

export function slotStateSignature(state: {
  itemId?: string;
  count?: number;
  durability?: number;
  ghost?: boolean;
  missing?: boolean;
  selected?: boolean;
}): string {
  if (state.ghost) return `ghost:${state.itemId ?? ''}:${state.missing ? 1 : 0}`;
  if (!state.itemId) return `empty:${state.selected ? 1 : 0}`;
  return `item:${state.itemId}:${state.count ?? 1}:${state.durability ?? ''}:${state.selected ? 1 : 0}`;
}

export function slotKeysMatch(existing: readonly string[], next: readonly string[]): boolean {
  return existing.length === next.length && existing.every((key, index) => key === next[index]);
}

export function applySlotSnapshots(
  existing: MutableSlotTarget[],
  next: readonly SlotSnapshot[],
): { preserved: boolean; identity: boolean; updated: number } {
  if (!slotKeysMatch(existing.map((slot) => slot.key), next.map((slot) => slot.key))) {
    return { preserved: false, identity: false, updated: 0 };
  }
  let updated = 0;
  for (let index = 0; index < existing.length; index += 1) {
    const current = existing[index]!;
    const incoming = next[index]!;
    if (current.signature === incoming.signature) continue;
    current.signature = incoming.signature;
    current.className = incoming.className;
    current.title = incoming.title;
    current.innerHTML = incoming.innerHTML;
    current.ghost = incoming.ghost;
    updated += 1;
  }
  return { preserved: true, identity: true, updated };
}

export function creativeCatalogPlayerSlotKeys(): string[] {
  return Array.from({ length: 9 }, (_value, index) => `inventory-${index}`);
}

export function creativeInventoryTabSlotKeys(): string[] {
  return [
    'armor-head', 'armor-chest', 'armor-legs', 'armor-feet',
    ...Array.from({ length: 27 }, (_value, index) => `inventory-${index + 9}`),
    ...creativeCatalogPlayerSlotKeys(),
  ];
}

export const CREATIVE_ARMOR_SLOT_KEYS = ['armor-head', 'armor-chest', 'armor-legs', 'armor-feet'] as const;

export function armorSlotKind(key: string): 'head' | 'chest' | 'legs' | 'feet' | undefined {
  if (key === 'armor-head' || key === 'armor-chest' || key === 'armor-legs' || key === 'armor-feet') {
    return key.slice('armor-'.length) as 'head' | 'chest' | 'legs' | 'feet';
  }
  return undefined;
}

export function catalogMustHideMainInventory(tab: CreativeInventoryTab): boolean {
  return tab === 'catalog';
}

function canPatchSlots(node: { querySelectorAll?: Function } | null): node is Element {
  return !!node && typeof node.querySelectorAll === 'function' && typeof document !== 'undefined';
}

export function patchSlotHost(host: Element, nextHtml: string): { preserved: boolean } {
  return patchKeyedHost(host, nextHtml, 'data-slot');
}

export function patchRecipeGridHost(host: Element, nextHtml: string): { preserved: boolean } {
  return patchKeyedHost(host, nextHtml, 'data-recipe-id');
}

function patchKeyedHost(host: Element, nextHtml: string, keyAttr: 'data-slot' | 'data-recipe-id'): { preserved: boolean } {
  const template = document.createElement('template');
  template.innerHTML = nextHtml.trim();
  const selector = `[${keyAttr}]`;
  const nextSlots = [...template.content.querySelectorAll<HTMLElement>(selector)];
  const existing = [...host.querySelectorAll<HTMLElement>(selector)];
  const keyOf = (element: HTMLElement): string => element.getAttribute(keyAttr) ?? '';
  const existingKeys = existing.map(keyOf);
  const nextKeys = nextSlots.map(keyOf);
  if (!slotKeysMatch(existingKeys, nextKeys)) {
    host.innerHTML = nextHtml;
    return { preserved: false };
  }
  for (let index = 0; index < existing.length; index += 1) {
    const current = existing[index]!;
    const incoming = nextSlots[index]!;
    if ((current.dataset.sig ?? '') === (incoming.dataset.sig ?? '')) continue;
    current.className = incoming.className;
    current.innerHTML = incoming.innerHTML;
    current.removeAttribute('title');
    current.dataset.sig = incoming.dataset.sig ?? '';
    if (incoming.dataset.itemTooltip) current.dataset.itemTooltip = incoming.dataset.itemTooltip;
    else delete current.dataset.itemTooltip;
    if (incoming.dataset.itemId) current.dataset.itemId = incoming.dataset.itemId;
    else delete current.dataset.itemId;
    const aria = incoming.getAttribute('aria-label');
    if (aria) current.setAttribute('aria-label', aria);
    else current.removeAttribute('aria-label');
    if (incoming.dataset.ghost) current.dataset.ghost = incoming.dataset.ghost;
    else delete current.dataset.ghost;
    if (incoming.dataset.armor) current.dataset.armor = incoming.dataset.armor;
    else delete current.dataset.armor;
  }
  for (const nextProgress of template.content.querySelectorAll<HTMLElement>('[data-progress]')) {
    const current = host.querySelector<HTMLElement>(`[data-progress="${nextProgress.dataset.progress}"]`);
    if (!current) continue;
    if (nextProgress.dataset.progressValue !== undefined) {
      current.style.setProperty('--p', nextProgress.dataset.progressValue);
    }
    if (nextProgress.dataset.progressWidth !== undefined) {
      const span = current.querySelector('span');
      if (span) span.style.width = nextProgress.dataset.progressWidth;
    }
  }
  return { preserved: true };
}

function patchHostHtml(node: { innerHTML: string; querySelectorAll?: Function } | null, html: string): void {
  if (!node) return;
  if (canPatchSlots(node)) {
    patchSlotHost(node, html);
    return;
  }
  node.innerHTML = html;
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
  patchHostHtml(dynamic, dynamicHtml);
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
  patchHostHtml(body, parts.body);
  patchHostHtml(player, parts.player);
  cursor.innerHTML = parts.cursor;
  const grid = root.querySelector('[data-recipe-grid]');
  if (grid && parts.recipeGrid !== undefined) {
    if (canPatchSlots(grid)) patchRecipeGridHost(grid, parts.recipeGrid);
    else if (grid.innerHTML !== parts.recipeGrid) grid.innerHTML = parts.recipeGrid;
  }
  return true;
}

export function patchCreativeDynamic(
  root: InventoryDomRoot,
  parts: { hotbar: string; inventory: string; cursor: string; tab: CreativeInventoryTab },
): boolean {
  const hotbar = root.querySelector('[data-player-hotbar]');
  const inventory = root.querySelector('[data-creative-inventory]');
  const cursor = root.querySelector('#cursor-stack');
  const catalogPanel = root.querySelector('[data-creative-catalog-panel]');
  const inventoryPanel = root.querySelector('[data-creative-inventory-panel]');
  if (!hotbar || !inventory || !cursor || !catalogPanel || !inventoryPanel) return false;
  patchHostHtml(hotbar, parts.hotbar);
  patchHostHtml(inventory, parts.inventory);
  cursor.innerHTML = parts.cursor;
  const catalogHidden = parts.tab !== 'catalog';
  const inventoryHidden = parts.tab !== 'inventory';
  setPanelHidden(catalogPanel, catalogHidden);
  setPanelHidden(inventoryPanel, inventoryHidden);
  return true;
}

function setPanelHidden(panel: { innerHTML: string; hidden?: boolean; classList?: { toggle(token: string, force?: boolean): unknown } }, hidden: boolean): void {
  if ('hidden' in panel) panel.hidden = hidden;
  panel.classList?.toggle('hidden', hidden);
}
