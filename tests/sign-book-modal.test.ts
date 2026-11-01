/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameUI } from '../src/ui/GameUI';
import { createItemStack } from '../src/inventory';
import { ItemId } from '../src/items/types';
import { BlockId } from '../src/blocks/types';
import { VoxelWorld } from '../src/world/World';
import type { BookContent } from '../src/items/book';
import type { SignLines } from '../src/world/sign';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

function mount(): { host: HTMLElement; ui: GameUI } {
  const host = document.createElement('div');
  const root = document.createElement('div');
  host.append(root);
  document.body.append(host);
  return { host, ui: new GameUI(root) };
}

function pressEscape(target: HTMLElement): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

describe('sign editor modal', () => {
  it('SIGN-1 closes without saving', () => {
    const { host, ui } = mount();
    let saves = 0;
    let closes = 0;
    ui.openSign(['a', '', '', ''], () => { saves += 1; }, () => { closes += 1; });
    expect(host.classList.contains('controls-suppressed')).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-sign="close"]')!.click();
    expect(document.querySelector('.sign-backdrop')).toBeNull();
    expect(ui.isBlockingOverlay()).toBe(false);
    expect(closes).toBe(1);
    expect(saves).toBe(0);
    expect(host.classList.contains('controls-suppressed')).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-sign="close"]')?.click();
    expect(closes).toBe(1);
  });

  it('SIGN-2 saves four sanitized lines once', () => {
    const { ui } = mount();
    const saved: SignLines[] = [];
    let closes = 0;
    ui.openSign(undefined, (lines) => saved.push(lines), () => { closes += 1; });
    const inputs = [...document.querySelectorAll<HTMLInputElement>('.sign-lines input')];
    inputs[0]!.value = '  Дуб';
    inputs[1]!.value = 'две';
    inputs[2]!.value = 'три';
    inputs[3]!.value = 'четыре';
    document.querySelector<HTMLButtonElement>('[data-sign="save"]')!.click();
    expect(saved).toEqual([['  Дуб', 'две', 'три', 'четыре']]);
    expect(closes).toBe(1);
    expect(document.querySelector('.sign-backdrop')).toBeNull();
    expect(ui.isBlockingOverlay()).toBe(false);
  });

  it('SIGN-3 escape closes without save or pause', () => {
    const { ui } = mount();
    let saves = 0;
    let closes = 0;
    let pause = 0;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') pause += 1;
    });
    ui.openSign(undefined, () => { saves += 1; }, () => { closes += 1; });
    const input = document.querySelector<HTMLInputElement>('.sign-lines input')!;
    input.focus();
    pressEscape(input);
    expect(document.querySelector('.sign-backdrop')).toBeNull();
    expect(closes).toBe(1);
    expect(saves).toBe(0);
    expect(pause).toBe(0);
    expect(document.querySelector('.pause-overlay')).toBeNull();
  });

  it('SIGN-4 keeps the editor open when a line is rejected', () => {
    const { ui } = mount();
    let saves = 0;
    ui.openSign(undefined, () => { saves += 1; }, () => undefined);
    const input = document.querySelector<HTMLInputElement>('.sign-lines input')!;
    input.maxLength = 80;
    input.value = 'я'.repeat(40);
    document.querySelector<HTMLButtonElement>('[data-sign="save"]')!.click();
    expect(saves).toBe(0);
    expect(document.querySelector('.sign-backdrop')).not.toBeNull();
    expect(document.body.textContent).toContain('Строки таблички слишком длинные');
    expect(ui.isBlockingOverlay()).toBe(true);
  });

  it('SIGN-5 does not accumulate editors across ten open and close cycles', () => {
    const { ui } = mount();
    let saves = 0;
    for (let cycle = 0; cycle < 10; cycle += 1) {
      let closes = 0;
      ui.openSign([`r${cycle}`, '', '', ''], () => { saves += 1; }, () => { closes += 1; });
      expect(document.querySelectorAll('.sign-backdrop')).toHaveLength(1);
      const close = document.querySelector<HTMLButtonElement>('[data-sign="close"]')!;
      close.click();
      close.click();
      expect(closes).toBe(1);
      expect(document.querySelectorAll('.sign-backdrop')).toHaveLength(0);
    }
    expect(saves).toBe(0);
    ui.openSign(undefined, (lines) => { saves += lines.length; }, () => undefined);
    document.querySelector<HTMLButtonElement>('[data-sign="save"]')!.click();
    expect(saves).toBe(4);
    expect(document.querySelectorAll('.sign-backdrop')).toHaveLength(0);
  });

  it('SIGN-6 does not remove a newer modal when the old sign closes', () => {
    const { ui } = mount();
    let signCloses = 0;
    let bookCloses = 0;
    ui.openSign(undefined, () => undefined, () => { signCloses += 1; });
    const sign = document.querySelector<HTMLElement>('.sign-backdrop')!;
    ui.openBook(createItemStack(ItemId.Book), () => undefined, () => { bookCloses += 1; });
    sign.querySelector<HTMLButtonElement>('[data-sign="close"]')!.click();
    expect(document.querySelector('.book-backdrop')).not.toBeNull();
    expect(ui.isBlockingOverlay()).toBe(true);
    expect(signCloses).toBe(0);
    expect(bookCloses).toBe(0);
    document.querySelector<HTMLButtonElement>('[data-book="close"]')!.click();
    expect(bookCloses).toBe(1);
    expect(document.querySelector('.book-backdrop')).toBeNull();
  });
});

describe('book editor modal', () => {
  it('BOOK-1 closes an unsaved draft', () => {
    const { ui } = mount();
    let saves = 0;
    let closes = 0;
    ui.openBook(createItemStack(ItemId.Book), () => { saves += 1; }, () => { closes += 1; });
    document.querySelector<HTMLTextAreaElement>('.book-page')!.value = 'черновик';
    document.querySelector<HTMLButtonElement>('[data-book="close"]')!.click();
    expect(document.querySelector('.book-backdrop')).toBeNull();
    expect(saves).toBe(0);
    expect(closes).toBe(1);
    expect(ui.isBlockingOverlay()).toBe(false);
  });

  it('BOOK-2 saves a draft once and restores controls', () => {
    const { host, ui } = mount();
    const saved: Array<{ content: BookContent; sign: boolean }> = [];
    let closes = 0;
    ui.openBook(createItemStack(ItemId.Book), (content, sign) => saved.push({ content, sign }), () => { closes += 1; });
    document.querySelector<HTMLTextAreaElement>('.book-page')!.value = 'страница';
    document.querySelector<HTMLButtonElement>('[data-book="save"]')!.click();
    expect(saved).toEqual([{ content: { pages: ['страница'] }, sign: false }]);
    expect(closes).toBe(1);
    expect(document.querySelector('.book-backdrop')).toBeNull();
    expect(host.classList.contains('controls-suppressed')).toBe(false);
  });

  it('BOOK-3 signs once with the title and pages', () => {
    const { ui } = mount();
    const saved: Array<{ content: BookContent; sign: boolean }> = [];
    ui.openBook(createItemStack(ItemId.Book), (content, sign) => saved.push({ content, sign }), () => undefined);
    document.querySelector<HTMLTextAreaElement>('.book-page')!.value = 'текст';
    document.querySelector<HTMLButtonElement>('[data-book="sign"]')!.click();
    document.querySelector<HTMLInputElement>('.book-title')!.value = 'Дневник';
    document.querySelector<HTMLButtonElement>('[data-book="confirm-sign"]')!.click();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ content: { pages: ['текст'], title: 'Дневник' }, sign: true });
    expect(document.querySelector('.book-backdrop')).toBeNull();
    expect(ui.isBlockingOverlay()).toBe(false);
  });

  it('BOOK-4 escape leaves no overlay and does not reach a later key handler', () => {
    const { ui } = mount();
    let closes = 0;
    let escapes = 0;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') escapes += 1;
    });
    ui.openBook(createItemStack(ItemId.Book), () => undefined, () => { closes += 1; });
    const text = document.querySelector<HTMLTextAreaElement>('.book-page')!;
    text.focus();
    pressEscape(text);
    expect(document.querySelector('.book-backdrop')).toBeNull();
    expect(closes).toBe(1);
    expect(escapes).toBe(0);
    expect(ui.isBlockingOverlay()).toBe(false);
  });
});

describe('sign save paths', () => {
  it('ONLINE-1 sends one authoritative sign_update', () => {
    const { ui } = mount();
    const sent: unknown[] = [];
    const client = { send: (message: unknown) => sent.push(message) };
    const x = 4;
    const y = 5;
    const z = 6;
    ui.openSign(['', '', '', ''], (edited) => {
      client.send({ type: 'sign_update', x, y, z, lines: edited });
    }, () => undefined);
    const inputs = [...document.querySelectorAll<HTMLInputElement>('.sign-lines input')];
    inputs[0]!.value = 'онлайн';
    document.querySelector<HTMLButtonElement>('[data-sign="save"]')!.click();
    expect(sent).toEqual([{ type: 'sign_update', x, y, z, lines: ['онлайн', '', '', ''] }]);
    expect(document.querySelector('.sign-backdrop')).toBeNull();
  });

  it('OFFLINE-1 writes the sign into the local world', () => {
    const { ui } = mount();
    const world = new VoxelWorld('sign-modal');
    world.setBlock(1, 2, 3, BlockId.OakSign);
    let saved = 0;
    ui.openSign(world.signText(1, 2, 3), (edited) => {
      if (world.setSignText(1, 2, 3, edited)) saved += 1;
    }, () => undefined);
    const inputs = [...document.querySelectorAll<HTMLInputElement>('.sign-lines input')];
    inputs[1]!.value = 'лес';
    document.querySelector<HTMLButtonElement>('[data-sign="save"]')!.click();
    expect(saved).toBe(1);
    expect(world.signText(1, 2, 3)).toEqual(['', 'лес', '', '']);
    expect(document.querySelector('.sign-backdrop')).toBeNull();
  });
});
