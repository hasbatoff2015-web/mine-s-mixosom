/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { PRODUCTION_PLAYER_SKINS } from '../src/player/appearance/builtinSkins';
import { GameUI } from '../src/ui/GameUI';

describe('skin selector menu', () => {
  it('lists every production skin, previews a discovered skin, and cancel leaves the committed id', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const ui = new GameUI(root);
    const previews: string[] = [];
    let confirmed = 0;
    let cancelled = 0;
    ui.showSkinSelector(DEFAULT_PLAYER_APPEARANCE, {
      preview: (skinId) => { previews.push(skinId); },
      confirm: () => { confirmed += 1; },
      cancel: () => { cancelled += 1; },
      rotatePreview: () => {},
      setPreviewRotationActive: () => {},
    });
    const cards = [...root.querySelectorAll<HTMLButtonElement>('[data-skin-id]')];
    expect(cards.map((card) => card.dataset.skinId)).toEqual(PRODUCTION_PLAYER_SKINS.map((skin) => skin.id));
    expect(root.querySelector('[data-skin-id="buyer_merchant"]')).toBeNull();
    expect(root.querySelector('[data-skin-id="player_uv_test"]')).toBeNull();
    const slim = root.querySelector<HTMLButtonElement>('[data-skin-id="14fcedd090af47a4"]');
    const classic = root.querySelector<HTMLButtonElement>('[data-skin-id="5a90d9efb3029994"]');
    expect(slim?.querySelector('[data-skin-model]')?.getAttribute('data-skin-model')).toBe('slim');
    expect(classic?.querySelector('[data-skin-model]')?.getAttribute('data-skin-model')).toBe('classic');
    expect(slim?.querySelector('canvas')?.getAttribute('width')).toBe('64');
    slim?.click();
    expect(previews).toEqual(['14fcedd090af47a4']);
    expect(slim?.classList.contains('selected')).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click();
    expect(cancelled).toBe(1);
    expect(confirmed).toBe(1);
    const grid = root.querySelector('.skin-card-grid');
    expect(grid).toBeTruthy();
    expect(cards.length).toBe(PRODUCTION_PLAYER_SKINS.length);
    expect(cards.length).toBeGreaterThan(45);
  });
});