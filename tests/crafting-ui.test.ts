import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keepCraftSearchDraft, CRAFT_BUTTON_LABEL } from '../src/ui/craftGui';
import { CONTAINER_STRINGS } from '../src/ui/containerStrings';
import { hasRecipeBook } from '../src/ui/containerInteractions';

const gameUi = readFileSync(new URL('../src/ui/GameUI.ts', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

function sourceSection(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('survival inventory CRAFT button', () => {
  it('replaces the 2×2 grid and recipe book with a crafting-table CRAFT control', () => {
    const inventoryCraft = sourceSection(
      gameUi,
      "if (context.kind === 'inventory') {",
      'const size = 3;',
    );
    expect(inventoryCraft).toContain('data-craft-menu');
    expect(inventoryCraft).toContain("itemIcon('crafting_table')");
    expect(CONTAINER_STRINGS.craft).toBe('Крафт');
    expect(CRAFT_BUTTON_LABEL).toBe('Крафт');
    expect(inventoryCraft).toContain('CONTAINER_STRINGS.craft');
    expect(inventoryCraft).not.toContain('mc-grid-2');
    expect(inventoryCraft).not.toContain('data-recipe-toggle');
    expect(inventoryCraft).not.toContain('data-slot="result"');
    expect(hasRecipeBook('inventory')).toBe(false);
    expect(hasRecipeBook('crafting-table')).toBe(true);
  });
});

describe('craft menu chrome', () => {
  it('uses inventory-style panel chrome, search, and one-craft intent', () => {
    expect(gameUi).toContain('data-craft-screen');
    expect(gameUi).toContain('data-craft-search');
    expect(gameUi).toContain('data-craft-list');
    expect(gameUi).toContain('data-craft-once');
    expect(gameUi).toContain("action: 'craft_recipe'");
    expect(gameUi).toContain('recipeId: recipe.id');
    expect(gameUi).not.toMatch(/action: 'craft_recipe'[\s\S]{0,120}count:/);
    expect(gameUi).toContain('mc-backdrop');
    expect(gameUi).toContain('mc-craft-panel');
    expect(gameUi).toContain('keepCraftSearchDraft');
    expect(gameUi).toContain('CRAFT_UNCRAFTABLE_HINT');
    expect(gameUi).toContain('CRAFT_INVENTORY_FULL_MESSAGE');
    expect(css).toContain('.mc-craft-available');
    expect(css).toContain('.mc-craft-need.missing');
    expect(css).toContain('scrollbar-width: none');
    expect(css).toContain('touch-action: pan-y');
    expect(css).toContain('.mc-craft-list::-webkit-scrollbar');
    expect(gameUi).toContain("addEventListener('wheel'");
    expect(css).toMatch(/\.mc-craft-left input \{[^}]*background: #8b8b8b;/);
    expect(css).toMatch(/\.mc-craft-left input::placeholder \{[^}]*color: #4a4a4a;/);
  });

  it('keeps the live search draft when the input still has focus', () => {
    const input = { value: 'дуб' } as HTMLInputElement;
    expect(keepCraftSearchDraft(input, input)).toBe(true);
    expect(keepCraftSearchDraft(null, input)).toBe(false);
    expect(keepCraftSearchDraft(input, null)).toBe(false);
  });

  it('closes the craft menu with X or E and returns to inventory', () => {
    expect(gameUi).toContain('if (this.craftMenuOpen) this.closeCraftMenu()');
    expect(gameSource).toContain('if (this.ui.isCraftMenuOpen())');
    expect(gameSource).toContain('this.ui.closeCraftMenu()');
    expect(gameUi).toContain('closeCraftMenu(): void');
  });
});

describe('close button E caption', () => {
  it('renders a square red X with an E hotkey under it', () => {
    expect(gameUi).toContain('class="mc-close-wrap"');
    expect(gameUi).toContain('class="mc-close-x"');
    expect(gameUi).toContain('class="mc-close-hotkey"');
    expect(gameUi).toContain('CONTAINER_STRINGS.closeHotkey');
    expect(CONTAINER_STRINGS.closeHotkey).toBe('E');
    expect(css).toContain('.mc-close-wrap');
    expect(css).toContain('.mc-close-hotkey');
    expect(css).toContain('.mc-close-x');
    expect(css).toContain('aspect-ratio: 1');
    expect(css).not.toContain('height: max(var(--touch-target), calc(20px * var(--mc-ui-scale)))');
    expect(css).toContain('.mc-panel.mc-craft-panel');
    expect(css).toMatch(/\.mc-craft-open \{[\s\S]*?width: calc\(32px \* var\(--mc-ui-scale\)\)/);
  });

  it('does not put an E caption on the clan back arrow', () => {
    expect(gameUi).toContain('class="mc-close mc-back"');
    const back = sourceSection(gameUi, 'showsClanBack(state.screen)', 'this.closeButtonHtml()');
    expect(back).toContain('data-clan-action="back"');
    expect(back).not.toContain('mc-close-hotkey');
    expect(back).not.toContain('CONTAINER_STRINGS.closeHotkey');
  });

  it('does not treat the chat close glyph as an inventory X', () => {
    expect(gameUi).toContain('id="chat-close"');
    expect(gameUi).toContain('chat-close-x');
    const chatClose = sourceSection(gameUi, 'id="chat-close"', '</button>');
    expect(chatClose).not.toContain('mc-close-hotkey');
  });
});
