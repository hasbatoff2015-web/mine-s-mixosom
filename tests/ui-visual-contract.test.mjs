import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync('src/uiTokens.css', 'utf8');
const style = readFileSync('src/style.css', 'utf8');
const gameUi = readFileSync('src/ui/GameUI.ts', 'utf8');
const qaHarness = readFileSync('src/dev/UiQaHarness.ts', 'utf8');

describe('production typography and assets', () => {
  it('self-hosts canonical Cyrillic/Latin font faces with swap and OFL records', () => {
    expect(tokens).toContain('--font-display: "Press Start 2P"');
    expect(tokens).toContain('--font-ui: "Inter"');
    expect(tokens.match(/font-display: swap/g)).toHaveLength(4);
    for (const path of [
      'public/fonts/inter/inter-cyrillic-400-700.woff2',
      'public/fonts/inter/inter-latin-400-700.woff2',
      'public/fonts/press-start-2p/press-start-2p-cyrillic-400.woff2',
      'public/fonts/press-start-2p/press-start-2p-latin-400.woff2',
      'docs/licenses/fonts/Inter-OFL-1.1.txt',
      'docs/licenses/fonts/Press-Start-2P-OFL-1.1.txt',
    ]) expect(existsSync(path), path).toBe(true);
  });

  it('removes accidental production Cascadia/Courier language and retains Russian labels', () => {
    expect(style).not.toMatch(/Cascadia|Courier|Segoe UI Mono/);
    expect(gameUi).toContain('Одиночная игра');
    expect(gameUi).toContain('Создать новый мир');
    expect(qaHarness).toContain('Расчёт освещения');
    expect(gameUi).toContain('Творческий');
    expect(gameUi).toContain('Выживание');
    expect(gameUi).toContain('Подключиться');
  });
});

describe('loading, HUD and Creative DOM contracts', () => {
  it('renders a real loading phase, determinate percent, detail and progress semantics', () => {
    expect(gameUi).toContain('class="loading-kicker">Загрузка мира');
    expect(gameUi).toContain('data-loading-percent');
    expect(gameUi).toContain('data-loading-detail');
    expect(gameUi).toContain('aria-valuenow');
    expect(gameUi).toContain('Math.round(progress)');
  });

  it('uses responsive HUD tokens and authored hunger assets instead of a system glyph', () => {
    expect(style).toContain('--hud-scale: clamp(');
    expect(style).toContain('--hud-hotbar-width:');
    expect(style).toContain('width: min(var(--hud-hotbar-width)');
    expect(gameUi).toContain('hungerHudIcons(state.hunger)');
    expect(gameUi).not.toContain("this.pips('◆'");
    for (const state of ['full', 'half', 'empty']) {
      expect(existsSync(`public/textures/gui/hunger_${state}.svg`)).toBe(true);
    }
  });

  it('keeps the canonical close callback, scroll host and compact catalog composition', () => {
    expect(gameUi).toContain("querySelector('[data-ui=\"close\"]')?.addEventListener('click', () => context.onClose())");
    expect(gameUi).toContain('data-creative-catalog');
    expect(style).toContain('overflow-y: auto');
    expect(style).toContain('max-height: calc(108px * var(--mc-ui-scale))');
    expect(style).not.toContain('min-height: calc(222px * var(--mc-ui-scale))');
    expect(style).not.toMatch(/mc-creative\[data-creative-current="catalog"\][\s\S]{0,120}margin-top:\s*auto/);
  });
});

describe('World Select interaction and hierarchy contracts', () => {
  it('keeps selection, double-click load and no-world disabled Play', () => {
    expect(gameUi).toContain('aria-pressed="${index === 0}"');
    expect(gameUi).toContain("button.addEventListener('dblclick', () => actions.load(button.dataset.worldId!))");
    expect(gameUi).toContain("data-action=\"play-world\" ${worlds.length ? '' : 'disabled'}");
    expect(gameUi).toContain('world-mode-badge');
    expect(gameUi).toContain('world-tertiary');
  });

  it('uses an in-game delete dialog while preserving the existing delete callback', () => {
    expect(gameUi).not.toContain('window.confirm');
    expect(gameUi).toContain('role="dialog" aria-modal="true"');
    expect(gameUi).toContain('aria-describedby="world-confirm-description"');
    expect(gameUi).toContain('Удалить мир?');
    expect(gameUi).toContain('actions.delete(selectedId!)');
    expect(gameUi).toContain("event.key !== 'Tab'");
    expect(gameUi).toContain('const direction = event.shiftKey ? -1 : 1');
    expect(gameUi).toContain('(activeIndex + direction + buttons.length) % buttons.length');
    expect(gameUi).toContain('if (trigger?.isConnected) trigger.focus()');
  });
});
