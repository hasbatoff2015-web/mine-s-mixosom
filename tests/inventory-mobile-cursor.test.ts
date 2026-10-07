/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Inventory, createItemStack } from '../src/inventory';
import { GameUI } from '../src/ui/GameUI';
import type { ItemStack } from '../src/inventory';

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

function pointer(type: string, target: Element, init: PointerEventInit): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', button: 0, ...init }));
}

const sessions: GameUI[] = [];
const keyListeners: Array<(event: KeyboardEvent) => void> = [];

function openSurvival(root: HTMLElement, inventory: Inventory, onDrop: (stack: ItemStack) => void = () => undefined): GameUI {
  const ui = new GameUI(root);
  sessions.push(ui);
  ui.openInventory({
    kind: 'inventory',
    mode: 'survival',
    inventory,
    onClose() { ui.closeInventory(false); },
    onDrop,
    onChanged() {},
  });
  return ui;
}

describe('mobile inventory cursor', () => {
  afterEach(() => {
    for (const ui of sessions) ui.closeInventory(false);
    sessions.length = 0;
    for (const listener of keyListeners) window.removeEventListener('keydown', listener);
    keyListeners.length = 0;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('does not park a carried apple on an empty backdrop tap', () => {
    coarsePointer();
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    const ui = openSurvival(root, inventory, (stack) => drops.push(stack));
    const slot = root.querySelector<HTMLElement>('[data-slot="inventory-0"]');
    const cursor = root.querySelector<HTMLElement>('#cursor-stack');
    expect(slot).toBeTruthy();
    expect(cursor).toBeTruthy();
    pointer('pointerdown', slot!, { clientX: 180, clientY: 220 });
    expect(cursor!.innerHTML.length).toBe(0);
    expect(drops).toEqual([]);
    pointer('pointerup', slot!, { clientX: 180, clientY: 220 });
    expect(cursor!.innerHTML.length).toBeGreaterThan(0);
    expect(cursor!.style.left).toBe('198px');
    expect(cursor!.style.top).toBe('184px');
    expect(inventory.getSlot(0)).toBeNull();
    expect(drops).toEqual([]);

    const backdrop = root.querySelector('.mc-backdrop');
    pointer('pointerdown', backdrop!, { clientX: 420, clientY: 30 });
    pointer('pointerup', backdrop!, { clientX: 420, clientY: 30 });
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: 310, clientY: 140, pointerType: 'mouse', pointerId: 9,
    }));
    expect(cursor!.style.left).toBe('198px');
    expect(cursor!.style.top).toBe('184px');
    expect(drops).toEqual([]);
    expect(ui.isInventoryOpen()).toBe(true);

    const target = root.querySelector<HTMLElement>('[data-slot="inventory-3"]');
    pointer('pointerdown', target!, { clientX: 40, clientY: 80 });
    pointer('pointerup', target!, { clientX: 40, clientY: 80 });
    expect(inventory.getSlot(3)?.count).toBe(8);
    expect(drops).toEqual([]);
  });

  it('follows a finger and moves the stack when the drag is released on a slot', () => {
    coarsePointer();
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    openSurvival(root, inventory, (stack) => drops.push(stack));
    const source = root.querySelector<HTMLElement>('[data-slot="inventory-0"]')!;
    const cursor = root.querySelector<HTMLElement>('#cursor-stack')!;
    pointer('pointerdown', source, { clientX: 100, clientY: 120 });
    pointer('pointermove', source, { clientX: 130, clientY: 150 });
    expect(cursor.innerHTML.length).toBeGreaterThan(0);
    expect(cursor.style.left).toBe('148px');
    expect(cursor.style.top).toBe('114px');
    expect(inventory.getSlot(0)?.count).toBe(8);
    const target = root.querySelector<HTMLElement>('[data-slot="inventory-4"]')!;
    pointer('pointerup', target, { clientX: 140, clientY: 160 });
    expect(inventory.getSlot(0)).toBeNull();
    expect(inventory.getSlot(4)?.count).toBe(8);
    expect(cursor.innerHTML.length).toBe(0);
    expect(drops).toEqual([]);
  });

  it('cancels a drag without moving or dropping', () => {
    coarsePointer();
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    openSurvival(root, inventory, (stack) => drops.push(stack));
    const source = root.querySelector<HTMLElement>('[data-slot="inventory-0"]')!;
    const cursor = root.querySelector<HTMLElement>('#cursor-stack')!;
    pointer('pointerdown', source, { clientX: 100, clientY: 120 });
    pointer('pointermove', source, { clientX: 140, clientY: 120 });
    source.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7 }));
    expect(inventory.getSlot(0)?.count).toBe(8);
    expect(inventory.getSlot(1)).toBeNull();
    expect(cursor.innerHTML.length).toBe(0);
    expect(drops).toEqual([]);
  });

  it('opens the amount dialog and splits or drops the selected count', () => {
    coarsePointer();
    vi.useFakeTimers();
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 7));
    const drops: ItemStack[] = [];
    openSurvival(root, inventory, (stack) => drops.push(stack));
    const slot = root.querySelector<HTMLElement>('[data-slot="inventory-0"]')!;
    pointer('pointerdown', slot, { clientX: 30, clientY: 30 });
    vi.advanceTimersByTime(350);
    const dialog = root.querySelector<HTMLElement>('[data-amount-dialog]');
    const slider = root.querySelector<HTMLInputElement>('[data-amount-slider]');
    expect(dialog?.querySelector('.mc-stack-amount-title')?.textContent).toBe('Количество');
    const stage = root.querySelector<HTMLElement>('.mc-stage');
    expect(dialog?.style.getPropertyValue('--mc-ui-scale').trim()).toBe(stage?.style.getPropertyValue('--mc-ui-scale').trim());
    expect(slider?.value).toBe('4');
    expect(slider?.min).toBe('1');
    expect(slider?.max).toBe('7');
    expect(root.querySelector('[data-amount-value]')?.textContent).toBe('4 / 7');
    expect(root.querySelector<HTMLButtonElement>('[data-amount-split]')?.disabled).toBe(false);
    pointer('pointerup', slot, { clientX: 30, clientY: 30 });
    root.querySelector<HTMLButtonElement>('[data-amount-split]')?.click();
    expect(inventory.getSlot(0)?.count).toBe(3);
    expect(inventory.getSlot(9)?.count).toBe(4);
    expect(drops).toEqual([]);
    expect(root.querySelector('[data-amount-dialog]')).toBeNull();

    inventory.setSlot(0, createItemStack('apple', 64));
    inventory.setSlot(9, null);
    const again = root.querySelector<HTMLElement>('[data-slot="inventory-0"]')!;
    pointer('pointerdown', again, { clientX: 30, clientY: 30 });
    vi.advanceTimersByTime(350);
    pointer('pointerup', again, { clientX: 30, clientY: 30 });
    const next = root.querySelector<HTMLInputElement>('[data-amount-slider]')!;
    next.value = '18';
    next.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('[data-amount-value]')?.textContent).toBe('18 / 64');
    root.querySelector<HTMLButtonElement>('[data-amount-drop]')?.click();
    expect(inventory.getSlot(0)?.count).toBe(46);
    expect(drops).toEqual([expect.objectContaining({ itemId: 'apple', count: 18 })]);
  });

  it('drops a fine-pointer cursor on empty backdrop and follows the mouse', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('apple', 8));
    const drops: ItemStack[] = [];
    openSurvival(root, inventory, (stack) => drops.push(stack));
    expect(root.querySelector('.mc-backdrop')?.classList.contains('is-coarse')).toBe(false);
    const slot = root.querySelector<HTMLElement>('[data-slot="inventory-0"]')!;
    const cursor = root.querySelector<HTMLElement>('#cursor-stack')!;
    pointer('pointerdown', slot, { clientX: 180, clientY: 220, pointerType: 'mouse' });
    pointer('pointerup', slot, { clientX: 180, clientY: 220, pointerType: 'mouse' });
    expect(inventory.getSlot(0)).toBeNull();
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: 310, clientY: 140, pointerType: 'mouse', pointerId: 3,
    }));
    expect(cursor.style.left).toBe('310px');
    expect(cursor.style.top).toBe('140px');
    const backdrop = root.querySelector('.mc-backdrop')!;
    pointer('pointerdown', backdrop, { clientX: 12, clientY: 12, pointerType: 'mouse', button: 2 });
    pointer('pointerup', backdrop, { clientX: 12, clientY: 12, pointerType: 'mouse', button: 2 });
    expect(drops.map((stack) => stack.count)).toEqual([1]);
    expect(inventory.getSlot(0)).toBeNull();
    pointer('pointerdown', backdrop, { clientX: 20, clientY: 20, pointerType: 'mouse' });
    pointer('pointerup', backdrop, { clientX: 20, clientY: 20, pointerType: 'mouse' });
    expect(drops.map((stack) => stack.count)).toEqual([1, 7]);
  });

  it('keeps Q and number keys for gameplay only while the inventory is closed', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let gameplay = 0;
    const listener = (event: KeyboardEvent): void => {
      if (event.code === 'KeyQ' || event.code === 'Digit3') gameplay += 1;
    };
    keyListeners.push(listener);
    window.addEventListener('keydown', listener);
    const inventory = new Inventory();
    inventory.setSlot(10, createItemStack('apple', 5));
    inventory.setSlot(2, createItemStack('stone', 1));
    const drops: ItemStack[] = [];
    const ui = openSurvival(root, inventory, (stack) => drops.push(stack));
    const slot = root.querySelector<HTMLElement>('[data-slot="inventory-10"]')!;
    slot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
    expect(gameplay).toBe(0);
    expect(inventory.getSlot(10)?.count).toBe(4);
    expect(drops[0]?.count).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', bubbles: true }));
    expect(gameplay).toBe(0);
    expect(inventory.getSlot(10)?.itemId).toBe('stone');
    expect(inventory.getSlot(2)?.itemId).toBe('apple');
    ui.closeInventory(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', bubbles: true }));
    expect(gameplay).toBe(2);
  });
});
