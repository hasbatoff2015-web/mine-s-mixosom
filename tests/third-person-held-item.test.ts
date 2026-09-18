import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { FIRST_PERSON_SPRITE_POSE, classifyItemForRendering } from '../src/items';
import { isMoveItemsCalibratorPath } from '../src/dev/moveItemsRoute';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import {
  THIRD_PERSON_HELD_ITEM_DEFAULTS,
  ThirdPersonHeldItemCalibratorState,
  applyThirdPersonHeldItemTransform,
  cloneThirdPersonHeldItemTransform,
  defaultThirdPersonHeldItemTransform,
  defaultThirdPersonHeldItemTransformForItem,
  formatThirdPersonHeldItemCopy,
  formatThirdPersonHeldItemCopyAll,
  thirdPersonHeldTransformsClose,
} from '../src/rendering/player/thirdPersonHeldItem';
import { Group } from 'three';

describe('moveitems calibrator route', () => {
  it('matches /moveitems with or without a trailing slash', () => {
    expect(isMoveItemsCalibratorPath('/moveitems')).toBe(true);
    expect(isMoveItemsCalibratorPath('/moveitems/')).toBe(true);
    expect(isMoveItemsCalibratorPath('/')).toBe(false);
    expect(isMoveItemsCalibratorPath('/play')).toBe(false);
  });
});

describe('third-person held item defaults', () => {
  it('keeps the production category poses used by remote PlayerVisual', () => {
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.block).toEqual({
      position: { x: 0, y: -0.02, z: -0.02 },
      rotation: { x: -0.55, y: 0.45, z: -0.28 },
      scale: { x: 0.24, y: 0.24, z: 0.24 },
    });
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.handheld.scale.x).toBe(0.55);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.generated.scale.x).toBe(0.40);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.bow.rotation.z).toBe(0.85);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.handheld.rotation.z).toBe(-0.72);
  });

  it('maps tools, swords, blocks and bow onto those category defaults', () => {
    expect(classifyItemForRendering('iron_pickaxe')).toBe('handheld');
    expect(classifyItemForRendering('diamond_sword')).toBe('handheld');
    expect(classifyItemForRendering('bow')).toBe('bow');
    expect(classifyItemForRendering('stone')).toBe('block');
    expect(classifyItemForRendering('apple')).toBe('generated');
    expect(defaultThirdPersonHeldItemTransformForItem('iron_pickaxe')).toEqual(
      defaultThirdPersonHeldItemTransform('handheld'),
    );
  });

  it('does not change the first-person production pose', () => {
    expect(FIRST_PERSON_SPRITE_POSE.position).toEqual([0.67, -0.29, -0.70]);
    expect(FIRST_PERSON_SPRITE_POSE.rotationDeg).toEqual([1, -90, 34]);
    expect(FIRST_PERSON_SPRITE_POSE.scale).toBe(0.60);
  });
});

describe('third-person held item calibrator state', () => {
  it('stores per-item live values and RESET restores production defaults', () => {
    const state = new ThirdPersonHeldItemCalibratorState();
    const original = state.get('iron_pickaxe');
    const edited = cloneThirdPersonHeldItemTransform(original);
    edited.position.x = 0.12;
    edited.rotation.y = 0.4;
    edited.scale.z = 0.8;
    state.set('iron_pickaxe', edited);
    state.set('diamond_sword', { ...state.get('diamond_sword'), position: { x: 1, y: 0, z: 0 } });
    expect(state.get('iron_pickaxe').position.x).toBe(0.12);
    expect(state.get('diamond_sword').position.x).toBe(1);
    const reset = state.reset('iron_pickaxe');
    expect(thirdPersonHeldTransformsClose(reset, original)).toBe(true);
    expect(state.get('diamond_sword').position.x).toBe(1);
  });

  it('formats COPY and COPY ALL blocks for later production write', () => {
    const transform = defaultThirdPersonHeldItemTransformForItem('iron_pickaxe');
    const text = formatThirdPersonHeldItemCopy('iron_pickaxe', transform);
    expect(text).toContain('Item: iron_pickaxe');
    expect(text).toContain('position:');
    expect(text).toContain('rotation:');
    expect(text).toContain('scale:');
    expect(text).toContain('y: -0.04');
    const all = formatThirdPersonHeldItemCopyAll([
      { itemId: 'iron_pickaxe', transform },
      { itemId: 'bow', transform: defaultThirdPersonHeldItemTransformForItem('bow') },
    ]);
    expect(all).toContain('Item: iron_pickaxe');
    expect(all).toContain('Item: bow');
  });
});

describe('PlayerVisual third-person held calibration', () => {
  it('applies production defaults then live overlay without mutating those defaults', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    visual.setHeldItem('iron_pickaxe');
    const production = visual.readHeldItemTransform();
    expect(production).toBeDefined();
    expect(thirdPersonHeldTransformsClose(production!, defaultThirdPersonHeldItemTransform('handheld'))).toBe(true);

    const live = cloneThirdPersonHeldItemTransform(production!);
    live.position.x = 0.2;
    live.rotation.z = -0.3;
    live.scale.x = 0.7;
    visual.applyHeldItemCalibration(live);
    expect(visual.readHeldItemTransform()?.position.x).toBeCloseTo(0.2);
    expect(visual.readHeldItemTransform()?.rotation.z).toBeCloseTo(-0.3);
    expect(visual.readHeldItemTransform()?.scale.x).toBeCloseTo(0.7);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.handheld.position.x).toBe(0);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.handheld.scale.x).toBe(0.55);

    visual.setHeldItem('stone');
    expect(thirdPersonHeldTransformsClose(
      visual.readHeldItemTransform()!,
      defaultThirdPersonHeldItemTransform('block'),
    )).toBe(true);

    visual.dispose();
    geometries.dispose();
    items.dispose();
    skins.dispose();
  });

  it('writes position, rotation and scale onto the same item model group', () => {
    const model = new Group();
    const transform = defaultThirdPersonHeldItemTransform('bow');
    applyThirdPersonHeldItemTransform(model, transform);
    expect(model.position.toArray()).toEqual([0, -0.04, -0.06]);
    expect(model.rotation.z).toBeCloseTo(0.85);
    expect(model.scale.toArray()).toEqual([0.46, 0.46, 0.46]);
  });
});
