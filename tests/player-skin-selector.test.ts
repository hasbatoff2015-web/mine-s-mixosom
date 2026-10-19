import { readdirSync } from 'node:fs';
import * as THREE from 'three';
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
  skinDescriptor,
} from '../src/player/appearance/builtinSkins';
import { BUYER_NPC_SKIN_ID } from '../shared/buyers';
import {
  PLAYER_APPEARANCE_STORAGE_KEY,
  loadPlayerAppearance,
  savePlayerAppearance,
  type AppearanceStorage,
} from '../src/net/playerAppearance';
import gameSource from '../src/core/Game.ts?raw';
import gameUiSource from '../src/ui/GameUI.ts?raw';
import previewSource from '../src/rendering/player/PlayerAppearancePreview.ts?raw';
import {
  PREVIEW_AUTO_YAW_PER_SECOND,
  PREVIEW_DRAG_RADIANS_PER_PIXEL,
  PREVIEW_CAMERA_X,
  PREVIEW_CAMERA_Z,
  PREVIEW_INITIAL_YAW,
  PREVIEW_LOOK_AT_Y,
  PREVIEW_NEUTRAL_VIEW_YAW,
  PreviewRotation,
  normalizePreviewYaw,
} from '../src/rendering/player/PlayerAppearancePreview';
import { playerSkinPartSize } from '../src/rendering/player/PlayerSkinGeometry';
import { SkinPreviewDragTracker } from '../src/ui/skinPreviewDrag';
import buyerNpcSource from '../src/net/BuyerNpcView.ts?raw';

/** Turntable yaw of the skin's local −Z front, using the same Three.js Y rotation as the preview. */
function frontFacesCamera(yaw: number): number {
  const turntable = new THREE.Group();
  const marker = new THREE.Object3D();
  marker.position.set(0, 0, -1);
  turntable.add(marker);
  turntable.rotation.y = yaw;
  turntable.updateMatrixWorld(true);
  const front = marker.getWorldPosition(new THREE.Vector3()).normalize();
  const towardCamera = new THREE.Vector3(PREVIEW_CAMERA_X, 0, PREVIEW_CAMERA_Z).normalize();
  return front.dot(towardCamera);
}

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
  it('exposes every production skin PNG with Classic/Slim metadata', () => {
    const playerPngs = readdirSync('public/textures/player/skins')
      .filter((name) => name.endsWith('.png') && name !== 'buyer_merchant.png');
    expect(PRODUCTION_PLAYER_SKINS).toHaveLength(playerPngs.length);
    expect(new Set(PRODUCTION_PLAYER_SKINS.map((skin) => skin.id)).size).toBe(playerPngs.length);
    expect(PRODUCTION_PLAYER_SKINS.some((skin) => skin.id === QA_PLAYER_SKIN_ID)).toBe(false);
    expect(PRODUCTION_PLAYER_SKINS.some((skin) => skin.id === BUYER_NPC_SKIN_ID)).toBe(false);
    expect(PRODUCTION_PLAYER_SKINS.some((skin) => skin.id === DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(true);
    for (const skin of PRODUCTION_PLAYER_SKINS) {
      expect(skin.defaultModel === 'classic' || skin.defaultModel === 'slim').toBe(true);
      expect(skin.texturePath.startsWith('player/skins/')).toBe(true);
    }
    const classic = PRODUCTION_PLAYER_SKINS.filter((skin) => skin.defaultModel === 'classic').length;
    const slim = PRODUCTION_PLAYER_SKINS.filter((skin) => skin.defaultModel === 'slim').length;
    expect(classic + slim).toBe(playerPngs.length);
    expect(classic).toBeGreaterThan(0);
    expect(slim).toBeGreaterThan(0);
    expect(BUILTIN_MINECRAFT_SKINS).toHaveLength(playerPngs.length + 2);
    const discovered = skinDescriptor('14fcedd090af47a4');
    expect(discovered?.defaultModel).toBe('slim');
    expect(playerPngs).toContain('14fcedd090af47a4.png');
  });

  it('selects a discovered skin with its catalog model and restores it on cancel', () => {
    const session = new PlayerSkinSelectorSession(DEFAULT_PLAYER_APPEARANCE);
    const preview = session.selectSkin('14fcedd090af47a4');
    expect(preview.skinId).toBe('14fcedd090af47a4');
    expect(preview.model).toBe('slim');
    expect(session.committed.skinId).toBe(DEFAULT_PLAYER_APPEARANCE.skinId);
    expect(session.cancel().skinId).toBe(DEFAULT_PLAYER_APPEARANCE.skinId);
    session.selectSkin('5a90d9efb3029994');
    expect(session.confirm()).toMatchObject({ skinId: '5a90d9efb3029994', model: 'classic' });
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

  it('keeps the buyer NPC on builtin buyer_merchant outside the player selector', () => {
    expect(BUYER_NPC_SKIN_ID).toBe('buyer_merchant');
    expect(skinDescriptor(BUYER_NPC_SKIN_ID)).toMatchObject({
      id: 'buyer_merchant',
      texturePath: 'player/skins/buyer_merchant',
      defaultModel: 'classic',
    });
    expect(BUILTIN_MINECRAFT_SKINS.some((skin) => skin.id === BUYER_NPC_SKIN_ID)).toBe(true);
    expect(PRODUCTION_PLAYER_SKINS.some((skin) => skin.id === BUYER_NPC_SKIN_ID)).toBe(false);
    expect(buyerNpcSource).toContain('skinId: BUYER_NPC_SKIN_ID');
    expect(gameSource).toContain("skinId: 'buyer_merchant'");
    expect(gameSource).toContain('new BuyerNpcView(');
    expect(gameSource).toContain('createPlayerAppearance({ skinId: \'buyer_merchant\', model: \'classic\' })');
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
    expect(previewSource).toContain('this.visual = new PlayerVisual(');
    expect(previewSource).toContain('this.visual.setAppearance(');
  });

  it('hides Classic/Slim from the selector and still selects the skin default model', () => {
    const selector = gameUiSource.slice(gameUiSource.indexOf('showSkinSelector('), gameUiSource.indexOf('showWorldList('));
    expect(selector).not.toContain('skin-model-toggle');
    expect(selector).not.toContain('skin-card-model');
    expect(selector).not.toContain('>Classic<');
    expect(selector).not.toContain('>Slim<');
    expect(selector).not.toContain('[data-model]');
    expect(selector).not.toContain('data-model="');
    expect(selector).toContain('data-skin-preview');
    expect(selector).toContain('data-skin-thumb');
    expect(selector).toContain('Потяните модель, чтобы повернуть');
    expect(selector.match(/data-skin-id=/g)).toHaveLength(1);
    expect(gameSource).not.toContain('setModel:');
    expect(gameSource).not.toContain('markSkinModel');
    expect(gameSource).toContain('this.skinSelector?.selectSkin(skinId)');
    expect(gameSource).toContain('this.characterPreview?.setAppearance(next)');
    const main = gameUiSource.slice(gameUiSource.indexOf('showMainMenu('), gameUiSource.indexOf('showSkinSelector('));
    expect(main).toContain('data-character-preview');
    expect(main).not.toContain('bindSkinPreviewDrag');
    expect(main).not.toContain('data-skin-preview');
  });

  it('pauses auto yaw only while a drag is active and wraps manual rotation', () => {
    expect(PREVIEW_AUTO_YAW_PER_SECOND).toBe(0.35);
    expect(PREVIEW_DRAG_RADIANS_PER_PIXEL).toBe(0.012);
    const rotation = new PreviewRotation();
    const start = rotation.read();
    rotation.advance(1, true);
    expect(rotation.read()).toBe(start);
    rotation.advance(1, false);
    expect(rotation.read()).toBeCloseTo(Math.atan2(Math.sin(start + 0.35), Math.cos(start + 0.35)), 6);
    const before = rotation.read();
    rotation.rotate(0.012 * 30);
    expect(rotation.read()).not.toBe(before);
    rotation.rotate(Math.PI * 20);
    expect(Math.abs(rotation.read())).toBeLessThanOrEqual(Math.PI);
    expect(previewSource).toContain('private autoRotatePaused = false');
    expect(previewSource).toContain('this.rotation.advance(deltaSeconds, this.autoRotatePaused)');
    expect(previewSource).toContain('if (this.disposed) return');
    expect(gameSource).toContain('deltaPixels * PREVIEW_DRAG_RADIANS_PER_PIXEL');
    expect(gameSource).toContain('setAutoRotatePaused(active)');
    expect(previewSource).toContain('private readonly turntable = new THREE.Group()');
    expect(previewSource).toContain('this.turntable.add(this.visual.root)');
    expect(previewSource).toContain('this.turntable.rotation.y = this.rotation.read()');
    expect(previewSource).not.toContain('viewYaw: this.rotation.read()');
    expect(previewSource).toContain('viewYaw: PREVIEW_NEUTRAL_VIEW_YAW');
    expect(PREVIEW_NEUTRAL_VIEW_YAW).toBe(0);
    expect(PREVIEW_CAMERA_X).toBe(1.35);
    expect(PREVIEW_CAMERA_Z).toBeGreaterThan(3.05);
    expect(PREVIEW_CAMERA_Z).toBe(4.2);
    expect(PREVIEW_LOOK_AT_Y).toBe(0.9);
    expect(previewSource).toContain('this.camera.position.set(PREVIEW_CAMERA_X, 1.15, PREVIEW_CAMERA_Z)');
    expect(previewSource).toContain('this.camera.lookAt(0, PREVIEW_LOOK_AT_Y, 0)');
  });

  it('starts the preview with the model front aimed at the camera', () => {
    const yaw = new PreviewRotation().read();
    expect(yaw).toBeCloseTo(PREVIEW_INITIAL_YAW, 12);
    expect(yaw).toBeCloseTo(Math.atan2(-PREVIEW_CAMERA_X, -PREVIEW_CAMERA_Z), 12);
    expect(frontFacesCamera(yaw)).toBeGreaterThan(0.98);
    expect(frontFacesCamera(0.45)).toBeLessThan(0);
  });

  it('keeps auto spin, pauses it while dragging, and wraps full turns', () => {
    const rotation = new PreviewRotation();
    const start = rotation.read();
    rotation.advance(1, true);
    expect(rotation.read()).toBe(start);
    rotation.rotate(0.4);
    const dragged = rotation.read();
    expect(dragged).not.toBe(start);
    rotation.advance(1, false);
    expect(rotation.read()).toBeCloseTo(normalizePreviewYaw(dragged + PREVIEW_AUTO_YAW_PER_SECOND), 6);

    const wrapped = new PreviewRotation();
    for (let turn = 0; turn < 30; turn += 1) wrapped.rotate(Math.PI * 2);
    expect(wrapped.read()).toBeCloseTo(PREVIEW_INITIAL_YAW, 6);
    for (let turn = 0; turn < 12; turn += 1) wrapped.advance((Math.PI * 2) / PREVIEW_AUTO_YAW_PER_SECOND, false);
    expect(Number.isFinite(wrapped.read())).toBe(true);
    expect(Math.abs(wrapped.read())).toBeLessThanOrEqual(Math.PI);
    expect(wrapped.read()).toBeCloseTo(PREVIEW_INITIAL_YAW, 5);

    const poisoned = new PreviewRotation();
    poisoned.rotate(0.2);
    const safe = poisoned.read();
    poisoned.rotate(Number.NaN);
    poisoned.rotate(Number.POSITIVE_INFINITY);
    poisoned.advance(Number.NaN, false);
    poisoned.advance(Number.POSITIVE_INFINITY, false);
    expect(poisoned.read()).toBeCloseTo(safe, 12);
    expect(normalizePreviewYaw(Number.NaN)).toBe(PREVIEW_INITIAL_YAW);
  });

  it('reopens at the same facing yaw and does not reset that yaw when the skin changes', () => {
    expect(new PreviewRotation().read()).toBeCloseTo(new PreviewRotation().read(), 12);
    const live = new PreviewRotation();
    live.rotate(-0.7);
    const duringSpin = live.read();
    expect(previewSource).toContain('this.visual.setAppearance(createPlayerAppearance(appearance))');
    expect(previewSource).not.toContain('this.rotation = new PreviewRotation');
    expect(gameSource).toContain('this.characterPreview?.setAppearance(next)');
    expect(gameSource).toContain('this.disposeCharacterPreview()');
    expect(live.read()).toBeCloseTo(duringSpin, 12);
    expect(new PreviewRotation().read()).toBeCloseTo(PREVIEW_INITIAL_YAW, 12);
    expect(playerSkinPartSize('rightArm', 'classic')[0]).toBe(4);
    expect(playerSkinPartSize('rightArm', 'slim')[0]).toBe(3);
    expect(skinDescriptor('10126ef69e2cdfdf')?.defaultModel).toBe('classic');
    expect(skinDescriptor('14fcedd090af47a4')?.defaultModel).toBe('slim');
    expect(skinDescriptor('6fdcd3bc5850aeed')?.outerLayerAlpha).toBe('translucent');
  });

  it('tracks one primary pointer for the skin preview drag', () => {
    const drag = new SkinPreviewDragTracker();
    expect(drag.begin({ pointerId: 2, pointerType: 'mouse', button: 2, clientX: 10 })).toBe(false);
    expect(drag.begin({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10 })).toBe(true);
    expect(drag.begin({ pointerId: 4, pointerType: 'touch', button: 0, clientX: 40 })).toBe(false);
    expect(drag.move({ pointerId: 4, clientX: 70 })).toBeUndefined();
    expect(drag.move({ pointerId: 1, clientX: 40 })).toBe(30);
    expect(drag.end(4)).toBe(false);
    expect(drag.end(1)).toBe(true);
    expect(drag.end(1)).toBe(false);
    const touch = new SkinPreviewDragTracker();
    expect(touch.begin({ pointerId: 7, pointerType: 'touch', button: 0, clientX: 0 })).toBe(true);
    expect(touch.move({ pointerId: 7, clientX: 12 })).toBe(12);
    expect(touch.end(7)).toBe(true);
    expect(gameUiSource).toContain('pointercancel');
    expect(gameUiSource).toContain('lostpointercapture');
    expect(gameUiSource).toContain('setPreviewRotationActive(false)');
    expect(gameUiSource).toContain('actions.rotatePreview(delta)');
  });
});
