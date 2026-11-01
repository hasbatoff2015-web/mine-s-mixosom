import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('../admin-ui/tokens.css', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../admin-ui/panel.css', import.meta.url), 'utf8');
const game = readFileSync(new URL('../src/uiTokens.css', import.meta.url), 'utf8');

function value(css: string, name: string): string {
  const flat = css.replace(/\s+/g, ' ');
  const match = flat.match(new RegExp(`${name}:\\s*([^;]+);`));
  expect(match, name).toBeTruthy();
  return match?.[1]?.trim() ?? '';
}

describe('admin panel visual contract', () => {
  it('reuses the game fonts, panel colors, buttons and edges', () => {
    for (const name of [
      '--font-display',
      '--font-ui',
      '--ui-bg',
      '--ui-panel',
      '--ui-accent',
      '--ui-accent-secondary',
      '--ui-danger',
      '--mc-text',
      '--mc-text-secondary',
      '--mc-text-muted',
      '--mc-btn-face',
      '--mc-btn-hover',
      '--mc-btn-pressed',
      '--mc-btn-positive',
      '--mc-btn-danger',
      '--mc-row-face',
      '--mc-panel-drop',
    ]) {
      expect(value(tokens, name)).toBe(value(game, name));
    }
    expect(tokens).toContain('Press Start 2P');
    expect(tokens).toContain('Inter');
    expect(panel).toContain('var(--mc-btn-face)');
    expect(panel).toContain('var(--mc-btn-edge)');
    expect(panel).toContain('var(--mc-panel-drop)');
    expect(panel).toContain('border-radius: 2px');
    expect(panel).toContain('min-height: var(--touch-target)');
    expect(panel).toContain('width: min(960px');
    expect(panel).toContain('overflow: auto');
    expect(panel).toContain('@media (max-width: 720px)');
    expect(panel).not.toContain('glass');
    expect(panel).not.toContain('bootstrap');
  });
});
