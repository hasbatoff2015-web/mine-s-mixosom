/**
 * @vitest-environment happy-dom
 *
 * These tests dispatch move/up on the backdrop, the way a browser does after
 * setPointerCapture. The physical target comes from elementFromPoint.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inventory, createItemStack, type ItemStack } from '../src/inventory';
import { itemMergeIdentity } from '../src/inventory/inventoryActions';
import { applyInventoryUiAction, type InventoryUiState } from '../src/inventory/inventoryUiAction';
import { parseClientMessage, type ClientInventoryActionMessage } from '../shared/protocol';
import { GameUI } from '../src/ui/GameUI';
import {
  classifyInventoryPointerElement,
  physicalPointerElement,
  resolveInventoryPointerZone,
} from '../src/ui/inventoryPointerHit';

let physicalTarget: Element | null = null;
const sessions: GameUI[] = [];

function coarsePointer(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)',
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  }));
}

function fire(
  type: string,
  dispatchOn: Element,
  physical: Element | null,
  init: PointerEventInit = {},
): void {
  physicalTarget = physical;
  dispatchOn.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    clientX: 20,
    clientY: 20,
    ...init,
  }));
}

function openUi(root: HTMLElement, inventory: Inventory, options: {
  mode?: 'survival' | 'creative';
  onDrop?: (stack: ItemStack) => void;
  submitAction?: (message: ClientInventoryActionMessage) => void;
} = {}): GameUI {
  const ui = new GameUI(root);
  sessions.push(ui);
  ui.openInventory({
    kind: 'inventory',
    mode: options.mode ?? 'survival',
    inventory,
    onClose() { ui.closeInventory(false); },
    onDrop: options.onDrop ?? (() => undefined),
    onChanged() {},
    submitAction: options.submitAction,
  });
  return ui;
}

function slot(root: ParentNode, key: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-slot="${key}"]`);
  if (!element) throw new Error(`missing slot ${key}`);
  return element;
}

describe('inventory pointer hit classification', () => {
  it('prefers the coordinate target over the captured event target', () => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop mc-backdrop';
    const panel = document.createElement('div');
    panel.className = 'mc-panel';
    const cell = document.createElement('div');
    cell.dataset.slot = 'inventory-4';
    panel.append(cell);
    const hit = resolveInventoryPointerZone({
      x: 40,
      y: 50,
      fallbackTarget: backdrop,
      coordinateHitTest: true,
      amountOpen: false,
      mobileDropContains: () => false,
      elementFromPoint: () => cell,
    });
    expect(hit).toEqual({ zone: 'slot', slotKey: 'inventory-4' });
    expect(classifyInventoryPointerElement(panel, { amountOpen: false })).toEqual({ zone: 'panel', slotKey: null });
    expect(classifyInventoryPointerElement(backdrop, { amountOpen: false })).toEqual({ zone: 'backdrop', slotKey: null });
  });

  it('checks the amount dialog, then the mobile drop, then a blocked control', () => {
    const cell = document.createElement('div');
    cell.dataset.slot = 'inventory-1';
    const button = document.createElement('button');
    expect(resolveInventoryPointerZone({
      x: 1,
      y: 1,
      fallbackTarget: cell,
      coordinateHitTest: true,
      amountOpen: true,
      mobileDropContains: () => true,
      elementFromPoint: () => cell,
    })).toEqual({ zone: 'dialog', slotKey: null });
    expect(resolveInventoryPointerZone({
      x: 1,
      y: 1,
      fallbackTarget: cell,
      coordinateHitTest: true,
      amountOpen: false,
      mobileDropContains: () => true,
      elementFromPoint: () => cell,
    })).toEqual({ zone: 'drop', slotKey: null });
    expect(classifyInventoryPointerElement(button, { amountOpen: false })).toEqual({ zone: 'blocked', slotKey: null });
  });

  it('skips the drag preview and tooltip when choosing the element under the pointer', () => {
    const cursor = document.createElement('div');
    cursor.id = 'cursor-stack';
    const carried = document.createElement('div');
    carried.dataset.slot = 'cursor';
    cursor.append(carried);
    const cell = document.createElement('div');
    cell.dataset.slot = 'inventory-3';
    const tooltip = document.createElement('div');
    tooltip.className = 'mc-item-tooltip';
    expect(physicalPointerElement(() => carried, () => [carried, tooltip, cell], 8, 8)).toBe(cell);
    expect(physicalPointerElement(() => tooltip, () => [tooltip, cell], 8, 8)).toBe(cell);
  });

  it('keeps pointer events off the carried stack and the tooltip', () => {
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toMatch(/#cursor-stack\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.mc-item-tooltip\s*\{[^}]*pointer-events:\s*none/);
    const drop = css.match(/\.mc-mobile-drop-target \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(drop).toContain('position: absolute');
    expect(drop).toContain('top: 50%');
    expect(drop).toContain('width: calc(26px * var(--mc-ui-scale, 3))');
    expect(drop).toContain('height: calc(34px * var(--mc-ui-scale, 3))');
    expect(drop).toContain('display: none');
    expect(drop).not.toContain('inset');
    expect(drop).not.toContain('--mc-slot-well');
    const armed = css.match(/\.mc-mobile-drop-target\.is-armed \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(armed).toContain('--drop-ink');
    expect(armed).not.toContain('inset');
    expect(armed).not.toMatch(/padding\s*:/);
    const shown = css.match(/\.mc-backdrop\.is-coarse \.mc-mobile-drop-target \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(shown).toContain('display: block');
    const rail = css.match(/\.mc-container-side-rail \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(rail).toContain('align-self: stretch');
    expect(css).toMatch(/\.mc-mobile-drop-hit \{[^}]*left:\s*0/);
  });
});

describe('captured inventory pointer', () => {
  beforeEach(() => {
    physicalTarget = null;
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => physicalTarget);
  });

  afterEach(() => {
    for (const ui of sessions) ui.closeInventory(false);
    sessions.length = 0;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('moves a desktop drag onto the slot under the pointer when the event target is the backdrop', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    openUi(root, inventory, { onDrop: (stack) => drops.push(stack) });
    const backdrop = root.querySelector('.mc-backdrop')!;
    const source = slot(root, 'inventory-0');
    const target = slot(root, 'inventory-4');
    fire('pointerdown', source, source, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, target, { clientX: 48, clientY: 10 });
    fire('pointerup', backdrop, target, { clientX: 48, clientY: 12 });
    expect(inventory.getSlot(0)).toBeNull();
    expect(inventory.getSlot(4)?.count).toBe(8);
    expect(drops).toEqual([]);
  });

  it('still drops a desktop drag released on the real backdrop', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    openUi(root, inventory, { onDrop: (stack) => drops.push(stack) });
    const backdrop = root.querySelector<HTMLElement>('.mc-backdrop')!;
    const source = slot(root, 'inventory-0');
    fire('pointerdown', source, source, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, backdrop, { clientX: 10, clientY: 40 });
    fire('pointerup', backdrop, backdrop, { clientX: 12, clientY: 44 });
    expect(inventory.getSlot(0)).toBeNull();
    expect(drops).toEqual([expect.objectContaining({ itemId: 'apple', count: 8 })]);
  });

  it('cancels a desktop drag released on empty panel, the close control, or an armor reject', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    openUi(root, inventory, { onDrop: (stack) => drops.push(stack) });
    const backdrop = root.querySelector('.mc-backdrop')!;
    const panel = root.querySelector('.mc-panel')!;
    const source = slot(root, 'inventory-0');
    const cursor = root.querySelector('#cursor-stack')!;
    fire('pointerdown', source, source, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, panel, { clientX: 40, clientY: 10 });
    fire('pointerup', backdrop, panel, { clientX: 40, clientY: 12 });
    expect(inventory.getSlot(0)?.count).toBe(8);
    expect(cursor.innerHTML.length).toBe(0);
    expect(drops).toEqual([]);

    const close = root.querySelector('[data-ui="close"]')!;
    fire('pointerdown', source, source, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, close, { clientX: 36, clientY: 10 });
    fire('pointerup', backdrop, close, { clientX: 36, clientY: 12 });
    expect(inventory.getSlot(0)?.count).toBe(8);
    expect(drops).toEqual([]);

    inventory.setSlot(0, createItemStack('diamond_sword', 1));
    const armor = slot(root, 'armor-head');
    const sword = slot(root, 'inventory-0');
    fire('pointerdown', sword, sword, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, armor, { clientX: 40, clientY: 20 });
    fire('pointerup', backdrop, armor, { clientX: 40, clientY: 24 });
    expect(inventory.getSlot(0)?.itemId).toBe('diamond_sword');
    expect(inventory.getSlot({ section: 'armor', slot: 'head' })).toBeNull();
    expect(drops).toEqual([]);
  });

  it('merges or swaps when the captured pointer is released on another real slot', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    inventory.setSlot(4, createItemStack('apple', 3));
    openUi(root, inventory);
    const firstBackdrop = root.querySelector('.mc-backdrop')!;
    fire('pointerdown', slot(root, 'inventory-0'), slot(root, 'inventory-0'), { clientX: 8, clientY: 8 });
    fire('pointermove', firstBackdrop, slot(root, 'inventory-4'), { clientX: 30, clientY: 8 });
    fire('pointerup', firstBackdrop, slot(root, 'inventory-4'), { clientX: 30, clientY: 10 });
    expect(inventory.getSlot(0)).toBeNull();
    expect(inventory.getSlot(4)?.count).toBe(11);

    inventory.setSlot(0, createItemStack('apple', 11));
    inventory.setSlot(4, createItemStack('stone', 2));
    const swappedBackdrop = root.querySelector('.mc-backdrop')!;
    fire('pointerdown', slot(root, 'inventory-0'), slot(root, 'inventory-0'), { clientX: 8, clientY: 8 });
    fire('pointermove', swappedBackdrop, slot(root, 'inventory-4'), { clientX: 32, clientY: 8 });
    fire('pointerup', swappedBackdrop, slot(root, 'inventory-4'), { clientX: 32, clientY: 12 });
    expect(inventory.getSlot(0)?.itemId).toBe('stone');
    expect(inventory.getSlot(4)?.itemId).toBe('apple');
  });

  it('equips a helmet dragged onto its armor slot', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('diamond_helmet', 1));
    const drops: ItemStack[] = [];
    openUi(root, inventory, { onDrop: (stack) => drops.push(stack) });
    const backdrop = root.querySelector('.mc-backdrop')!;
    const armor = slot(root, 'armor-head');
    fire('pointerdown', slot(root, 'inventory-0'), slot(root, 'inventory-0'), { clientX: 8, clientY: 8 });
    fire('pointermove', backdrop, armor, { clientX: 28, clientY: 8 });
    fire('pointerup', backdrop, armor, { clientX: 28, clientY: 10 });
    expect(inventory.getSlot(0)).toBeNull();
    expect(inventory.getSlot({ section: 'armor', slot: 'head' })?.itemId).toBe('diamond_helmet');
    expect(drops).toEqual([]);
  });

  it('distributes a carried stack across the slots under the captured pointer', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    openUi(root, inventory);
    const source = slot(root, 'inventory-0');
    fire('pointerdown', source, source, { clientX: 12, clientY: 12 });
    fire('pointerup', source, source, { clientX: 12, clientY: 12 });
    expect(inventory.getSlot(0)).toBeNull();

    const backdrop = root.querySelector('.mc-backdrop')!;
    const first = slot(root, 'inventory-1');
    const second = slot(root, 'inventory-2');
    const third = slot(root, 'inventory-3');
    fire('pointerdown', first, first, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, second, { clientX: 30, clientY: 10 });
    fire('pointermove', backdrop, first, { clientX: 48, clientY: 10 });
    fire('pointermove', backdrop, third, { clientX: 70, clientY: 12 });
    fire('pointerup', backdrop, third, { clientX: 70, clientY: 14 });
    expect(inventory.getSlot(1)?.count).toBe(2);
    expect(inventory.getSlot(2)?.count).toBe(2);
    expect(inventory.getSlot(3)?.count).toBe(2);
    expect(inventory.count('apple')).toBe(6);
    expect(root.querySelector('#cursor-stack .count')?.textContent).toBe('2');
  });

  it('treats a coarse pointerup on the backdrop as a tap when the finger is still on the slot', () => {
    coarsePointer();
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    openUi(root, inventory, { onDrop: (stack) => drops.push(stack) });
    const backdrop = root.querySelector('.mc-backdrop')!;
    const source = slot(root, 'inventory-0');
    fire('pointerdown', source, source, { clientX: 20, clientY: 20, pointerType: 'touch' });
    fire('pointerup', backdrop, source, { clientX: 21, clientY: 20, pointerType: 'touch' });
    expect(inventory.getSlot(0)).toBeNull();
    expect(root.querySelector('#cursor-stack')!.innerHTML.length).toBeGreaterThan(0);
    expect(drops).toEqual([]);
  });

  it('moves a coarse drag to the slot under the finger and does not drop on the backdrop', () => {
    coarsePointer();
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    openUi(root, inventory, { onDrop: (stack) => drops.push(stack) });
    const backdrop = root.querySelector<HTMLElement>('.mc-backdrop')!;
    const source = slot(root, 'inventory-0');
    const target = slot(root, 'inventory-4');
    fire('pointerdown', source, source, { clientX: 100, clientY: 80, pointerType: 'touch' });
    fire('pointermove', backdrop, target, { clientX: 140, clientY: 80, pointerType: 'touch' });
    fire('pointerup', backdrop, target, { clientX: 144, clientY: 84, pointerType: 'touch' });
    expect(inventory.getSlot(0)).toBeNull();
    expect(inventory.getSlot(4)?.count).toBe(8);
    expect(drops).toEqual([]);

    inventory.setSlot(0, createItemStack('apple', 8));
    inventory.setSlot(4, null);
    const againBackdrop = root.querySelector<HTMLElement>('.mc-backdrop')!;
    const again = slot(root, 'inventory-0');
    fire('pointerdown', again, again, { clientX: 100, clientY: 80, pointerType: 'touch' });
    fire('pointermove', againBackdrop, againBackdrop, { clientX: 140, clientY: 80, pointerType: 'touch' });
    fire('pointerup', againBackdrop, againBackdrop, { clientX: 144, clientY: 84, pointerType: 'touch' });
    expect(inventory.getSlot(0)?.count).toBe(8);
    expect(drops).toEqual([]);
  });

  it('does nothing on pointercancel, lost capture, or blur', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    const ui = openUi(root, inventory, { onDrop: (stack) => drops.push(stack) });
    const backdrop = root.querySelector<HTMLElement>('.mc-backdrop')!;
    const source = slot(root, 'inventory-0');
    const target = slot(root, 'inventory-4');
    fire('pointerdown', source, source, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, target, { clientX: 40, clientY: 10 });
    source.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7 }));
    expect(inventory.getSlot(0)?.count).toBe(8);
    expect(inventory.getSlot(4)).toBeNull();
    expect(drops).toEqual([]);

    fire('pointerdown', source, source, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, target, { clientX: 40, clientY: 12 });
    backdrop.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }));
    expect(inventory.getSlot(0)?.count).toBe(8);
    expect(drops).toEqual([]);

    fire('pointerdown', source, source, { clientX: 10, clientY: 10 });
    fire('pointermove', backdrop, target, { clientX: 36, clientY: 10 });
    window.dispatchEvent(new Event('blur'));
    expect(inventory.getSlot(0)?.count).toBe(8);
    expect(ui.isInventoryOpen()).toBe(true);
    expect(drops).toEqual([]);
  });
});

describe('online double click without a snapshot', () => {
  beforeEach(() => {
    physicalTarget = null;
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => physicalTarget);
  });

  afterEach(() => {
    for (const ui of sessions) ui.closeInventory(false);
    sessions.length = 0;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function click(root: ParentNode, key: string, init: PointerEventInit = {}): void {
    const element = slot(root, key);
    fire('pointerdown', element, element, init);
    fire('pointerup', element, element, init);
  }

  it('sends click then collect_matching while the local cursor is still empty', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 10));
    inventory.setSlot(3, createItemStack('apple', 4));
    const messages: ClientInventoryActionMessage[] = [];
    openUi(root, inventory, { submitAction: (message) => messages.push(message) });
    click(root, 'inventory-0', { clientX: 16, clientY: 16 });
    expect(messages.map((message) => message.action)).toEqual(['click']);
    expect(inventory.getSlot(0)?.count).toBe(10);
    expect(root.querySelector('#cursor-stack')!.innerHTML.length).toBe(0);
    click(root, 'inventory-0', { clientX: 16, clientY: 16 });
    expect(messages.map((message) => message.action)).toEqual(['click', 'collect_matching']);
    expect(messages[1]).not.toMatchObject({ action: 'click' });
    expect(inventory.getSlot(0)?.count).toBe(10);
    expect(inventory.getSlot(3)?.count).toBe(4);
  });

  it('still collects locally when the first click has already filled the cursor', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 10));
    inventory.setSlot(3, createItemStack('apple', 6));
    openUi(root, inventory);
    click(root, 'inventory-0');
    click(root, 'inventory-0');
    expect(inventory.getSlot(0)).toBeNull();
    expect(inventory.getSlot(3)).toBeNull();
    expect(inventory.count('apple')).toBe(0);
    expect(root.querySelector('#cursor-stack .count')?.textContent).toBe('16');
  });

  it('does not collect when the first click is an empty slot', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const messages: ClientInventoryActionMessage[] = [];
    openUi(root, new Inventory(), { submitAction: (message) => messages.push(message) });
    click(root, 'inventory-8');
    click(root, 'inventory-8');
    expect(messages.map((message) => message.action)).toEqual(['click', 'click']);
  });

  it('does not collect when the cursor was already occupied before the first click', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 10));
    inventory.setSlot(1, createItemStack('apple', 4));
    const messages: ClientInventoryActionMessage[] = [];
    const context = {
      kind: 'inventory' as const,
      mode: 'survival' as const,
      inventory,
      onClose() {},
      onDrop() {},
      onChanged() {},
      submitAction: undefined as undefined | ((message: ClientInventoryActionMessage) => void),
    };
    const ui = new GameUI(root);
    sessions.push(ui);
    ui.openInventory(context);
    click(root, 'inventory-0');
    expect(inventory.getSlot(0)).toBeNull();
    context.submitAction = (message) => messages.push(message);
    click(root, 'inventory-1');
    click(root, 'inventory-1');
    expect(messages.map((message) => message.action)).toEqual(['click', 'click']);
  });

  it('does not collect on a right click or a shift double click', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(1, createItemStack('apple', 8));
    inventory.setSlot(9, createItemStack('dirt', 10));
    inventory.setSlot(10, createItemStack('dirt', 4));
    const messages: ClientInventoryActionMessage[] = [];
    openUi(root, inventory, { submitAction: (message) => messages.push(message) });
    click(root, 'inventory-1', { button: 2 });
    click(root, 'inventory-1', { button: 2 });
    expect(messages.map((message) => message.action)).toEqual(['click', 'click']);
    expect(messages.every((message) => message.button === 'right')).toBe(true);

    messages.length = 0;
    click(root, 'inventory-9', { shiftKey: true });
    click(root, 'inventory-9', { shiftKey: true });
    expect(messages.map((message) => message.action)).toEqual(['click', 'quick_move_matching']);
    expect(messages[1]).toMatchObject({
      action: 'quick_move_matching',
      key: 'inventory-9',
      signature: itemMergeIdentity(createItemStack('dirt', 10)),
    });
  });

  it('renders the mobile drop zone as a receiver beside the close button', () => {
    const root = document.createElement('div');
    document.body.append(root);
    openUi(root, new Inventory());
    const zone = root.querySelector('.mc-mobile-drop-target');
    const rail = root.querySelector('.mc-container-side-rail');
    expect(zone?.tagName).toBe('DIV');
    expect(zone?.getAttribute('role')).toBe('img');
    expect(zone?.querySelector('button')).toBeNull();
    expect(zone?.querySelector('.mc-mobile-drop-arrow')).toBeTruthy();
    expect(zone?.querySelector('.mc-mobile-drop-receiver')).toBeTruthy();
    expect(rail?.querySelector(':scope > .mc-close')).toBe(rail?.firstElementChild);
    expect(root.querySelector('.mc-mobile-drop-icon')).toBeNull();
  });

  it('applies shift click then hinted bulk while the client inventory stays stale', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const client = new Inventory();
    client.setSlot(9, createItemStack('dirt', 10));
    client.setSlot(10, createItemStack('dirt', 4));
    const messages: ClientInventoryActionMessage[] = [];
    openUi(root, client, { submitAction: (message) => messages.push(message) });
    click(root, 'inventory-9', { shiftKey: true });
    click(root, 'inventory-9', { shiftKey: true });
    expect(client.getSlot(9)?.count).toBe(10);
    expect(client.getSlot(10)?.count).toBe(4);
    expect(messages.map((message) => message.action)).toEqual(['click', 'quick_move_matching']);

    const server: InventoryUiState = {
      inventory: new Inventory(),
      cursor: null,
      craftSlots: [null, null, null, null],
      window: { kind: 'inventory' },
      gamemode: 'survival',
    };
    server.inventory.setSlot(9, createItemStack('dirt', 10));
    server.inventory.setSlot(10, createItemStack('dirt', 4));
    for (const message of messages) {
      const parsed = parseClientMessage(message);
      if (!parsed || !('type' in parsed) || parsed.type !== 'inventory_action') {
        throw new Error('inventory action did not survive the parser');
      }
      applyInventoryUiAction(server, parsed);
    }
    expect(server.inventory.getSlot(9)).toBeNull();
    expect(server.inventory.getSlot(10)).toBeNull();
    expect(server.inventory.count('dirt')).toBe(14);
    expect(server.cursor).toBeNull();
  });

  it('bulk-shifts the rest of main locally when the first click already moved the origin', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(9, createItemStack('dirt', 10));
    inventory.setSlot(10, createItemStack('dirt', 4));
    openUi(root, inventory);
    click(root, 'inventory-9', { shiftKey: true });
    expect(inventory.getSlot(9)).toBeNull();
    expect(inventory.getSlot(10)?.count).toBe(4);
    click(root, 'inventory-9', { shiftKey: true });
    expect(inventory.getSlot(9)).toBeNull();
    expect(inventory.getSlot(10)).toBeNull();
    expect(inventory.count('dirt')).toBe(14);
  });

  it('sends a normal shift click once the double-click window has passed', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(9, createItemStack('dirt', 10));
    inventory.setSlot(10, createItemStack('dirt', 4));
    const messages: ClientInventoryActionMessage[] = [];
    openUi(root, inventory, { submitAction: (message) => messages.push(message) });
    let now = 5_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    click(root, 'inventory-9', { shiftKey: true });
    now += 251;
    click(root, 'inventory-9', { shiftKey: true });
    clock.mockRestore();
    expect(messages.map((message) => message.action)).toEqual(['click', 'click']);
    expect(messages.every((message) => message.action !== 'quick_move_matching')).toBe(true);
  });

  it('does not bulk-shift an empty slot, a craft result, or a creative grant', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    const messages: ClientInventoryActionMessage[] = [];
    openUi(root, inventory, { submitAction: (message) => messages.push(message) });
    click(root, 'inventory-4', { shiftKey: true });
    click(root, 'inventory-4', { shiftKey: true });
    expect(messages.map((message) => message.action)).toEqual(['click', 'click']);

    messages.length = 0;
    const crafting = document.createElement('div');
    document.body.append(crafting);
    const table = new Inventory();
    table.setSlot(0, createItemStack('oak_log', 1));
    const craftingContext = {
      kind: 'crafting-table' as const,
      mode: 'survival' as const,
      inventory: table,
      onClose() {},
      onDrop() {},
      onChanged() {},
      submitAction: undefined as undefined | ((message: ClientInventoryActionMessage) => void),
    };
    const ui = new GameUI(crafting);
    sessions.push(ui);
    ui.openInventory(craftingContext);
    click(crafting, 'inventory-0');
    click(crafting, 'craft-0');
    expect(crafting.querySelector('[data-slot="result"] img')).toBeTruthy();
    craftingContext.submitAction = (message) => messages.push(message);
    click(crafting, 'result', { shiftKey: true });
    click(crafting, 'result', { shiftKey: true });
    expect(messages.map((message) => message.action)).toEqual(['click', 'click']);

    messages.length = 0;
    const creativeRoot = document.createElement('div');
    document.body.append(creativeRoot);
    openUi(creativeRoot, new Inventory(), {
      mode: 'creative',
      submitAction: (message) => messages.push(message),
    });
    click(creativeRoot, 'creative-0', { shiftKey: true });
    click(creativeRoot, 'creative-0', { shiftKey: true });
    expect(messages.map((message) => message.action)).toEqual(['click', 'click']);
  });

  it('does not collect a virtual craft result or a creative catalog grant', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('oak_log', 1));
    const messages: ClientInventoryActionMessage[] = [];
    const context = {
      kind: 'crafting-table' as const,
      mode: 'survival' as const,
      inventory,
      onClose() {},
      onDrop() {},
      onChanged() {},
      submitAction: undefined as undefined | ((message: ClientInventoryActionMessage) => void),
    };
    const ui = new GameUI(root);
    sessions.push(ui);
    ui.openInventory(context);
    click(root, 'inventory-0');
    click(root, 'craft-0');
    expect(root.querySelector('[data-slot="result"] img')).toBeTruthy();
    expect(inventory.getSlot(0)).toBeNull();
    context.submitAction = (message) => messages.push(message);
    click(root, 'result');
    click(root, 'result');
    expect(messages.map((message) => message.action)).toEqual(['click', 'click']);

    ui.closeInventory(false);
    const creativeRoot = document.createElement('div');
    document.body.append(creativeRoot);
    const creativeMessages: ClientInventoryActionMessage[] = [];
    openUi(creativeRoot, new Inventory(), {
      mode: 'creative',
      submitAction: (message) => creativeMessages.push(message),
    });
    click(creativeRoot, 'creative-0');
    click(creativeRoot, 'creative-0');
    expect(creativeMessages.map((message) => message.action)).toEqual(['click', 'click']);
  });
});
