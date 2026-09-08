import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_APPEARANCE,
  appearancesEqual,
  createPlayerAppearance,
  parseNetworkAppearance,
  sanitizeRegisteredAppearance,
} from '../src/player/appearance/PlayerAppearance';
import { PlayerSkinSelectorSession } from '../src/player/appearance/PlayerSkinSelector';
import {
  PRODUCTION_PLAYER_SKINS,
  QA_PLAYER_SKIN_ID,
  BUILTIN_MINECRAFT_SKINS,
} from '../src/player/appearance/builtinSkins';
import {
  PLAYER_APPEARANCE_STORAGE_KEY,
  loadPlayerAppearance,
  savePlayerAppearance,
  type AppearanceStorage,
} from '../src/net/playerAppearance';
import gameSource from '../src/core/Game.ts?raw';
import gameUiSource from '../src/ui/GameUI.ts?raw';

function memoryStorage(initial: Record<string, string> = {}): AppearanceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

describe('player skin selector', () => {
  it('exposes all 45 production skins with Classic/Slim metadata', () => {
    expect(PRODUCTION_PLAYER_SKINS).toHaveLength(45);
    expect(new Set(PRODUCTION_PLAYER_SKINS.map((skin) => skin.id)).size).toBe(45);
    expect(PRODUCTION_PLAYER_SKINS.some((skin) => skin.id === QA_PLAYER_SKIN_ID)).toBe(false);
    expect(PRODUCTION_PLAYER_SKINS.some((skin) => skin.id === DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(true);
    for (const skin of PRODUCTION_PLAYER_SKINS) {
      expect(skin.defaultModel === 'classic' || skin.defaultModel === 'slim').toBe(true);
      expect(skin.texturePath.startsWith('player/skins/')).toBe(true);
    }
    const classic = PRODUCTION_PLAYER_SKINS.filter((skin) => skin.defaultModel === 'classic').length;
    const slim = PRODUCTION_PLAYER_SKINS.filter((skin) => skin.defaultModel === 'slim').length;
    expect(classic + slim).toBe(45);
    expect(classic).toBeGreaterThan(0);
    expect(slim).toBeGreaterThan(0);
    expect(BUILTIN_MINECRAFT_SKINS).toHaveLength(46);
  });

  it('changes only the temporary preview until confirm', () => {
    const session = new PlayerSkinSelectorSession(DEFAULT_PLAYER_APPEARANCE);
    const target = PRODUCTION_PLAYER_SKINS.find((skin) => skin.id !== DEFAULT_PLAYER_APPEARANCE.skinId)!;
    const preview = session.selectSkin(target.id);
    expect(preview.skinId).toBe(target.id);
    expect(preview.model).toBe(target.defaultModel);
    expect(session.committed).toEqual(DEFAULT_PLAYER_APPEARANCE);
    expect(session.dirty).toBe(true);
    expect(JSON.stringify(preview)).not.toMatch(/png|base64|texture/i);
  });

  it('cancel restores the committed appearance', () => {
    const session = new PlayerSkinSelectorSession(DEFAULT_PLAYER_APPEARANCE);
    session.selectSkin('e3eb6f99ea1c3fe1');
    expect(session.preview.skinId).toBe('e3eb6f99ea1c3fe1');
    expect(session.cancel()).toEqual(DEFAULT_PLAYER_APPEARANCE);
    expect(session.preview).toEqual(DEFAULT_PLAYER_APPEARANCE);
  });

  it('confirm returns the preview for Game.setPlayerAppearance', () => {
    const session = new PlayerSkinSelectorSession(DEFAULT_PLAYER_APPEARANCE);
    session.selectSkin('e3eb6f99ea1c3fe1');
    session.setModel('slim');
    const confirmed = session.confirm();
    expect(confirmed.skinId).toBe('e3eb6f99ea1c3fe1');
    expect(confirmed.model).toBe('slim');
    expect(appearancesEqual(confirmed, session.preview)).toBe(true);
  });

  it('rejects unknown ids and texture payloads', () => {
    expect(sanitizeRegisteredAppearance({
      skinId: 'not_a_real_skin',
      model: 'classic',
      layers: DEFAULT_PLAYER_APPEARANCE.layers,
    })).toBeUndefined();
    expect(parseNetworkAppearance({
      skinId: 'frontier_explorer',
      model: 'classic',
      png: 'iVBORw0KGgo=',
    })).toBeUndefined();
    expect(parseNetworkAppearance({
      skinId: 'frontier_explorer',
      model: 'classic',
      base64: 'aaaa',
    })).toBeUndefined();
    expect(createPlayerAppearance({ skinId: QA_PLAYER_SKIN_ID }).skinId).toBe(QA_PLAYER_SKIN_ID);
    expect(sanitizeRegisteredAppearance({ skinId: QA_PLAYER_SKIN_ID, model: 'classic' })).toBeUndefined();
  });

  it('persists appearance metadata in local storage without image bytes', () => {
    const storage = memoryStorage();
    const saved = savePlayerAppearance(createPlayerAppearance({
      skinId: 'e3eb6f99ea1c3fe1',
      model: 'slim',
    }), storage);
    expect(saved.skinId).toBe('e3eb6f99ea1c3fe1');
    const raw = storage.data[PLAYER_APPEARANCE_STORAGE_KEY];
    expect(raw).not.toMatch(/png|base64|data:image/i);
    expect(loadPlayerAppearance(storage).skinId).toBe('e3eb6f99ea1c3fe1');
  });

  it('wires the character panel and selector through Game.setPlayerAppearance', () => {
    expect(gameUiSource).toContain('Персонаж');
    expect(gameUiSource).toContain('Выбрать скин');
    expect(gameUiSource).toContain('data-character-preview');
    expect(gameUiSource).toContain('showSkinSelector(');
    expect(gameUiSource).toContain('skin-card-grid');
    expect(gameSource).toContain('selectSkin: () => this.showSkinSelector()');
    expect(gameSource).toContain('new PlayerSkinSelectorSession');
    expect(gameSource).toContain('this.setPlayerAppearance(next)');
    expect(gameSource).toContain('new PlayerAppearancePreview');
    expect(gameSource).toContain('new PlayerVisual(');
  });
});
