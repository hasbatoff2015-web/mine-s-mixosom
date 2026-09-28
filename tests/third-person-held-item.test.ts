import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import {
  FIRST_PERSON_SPRITE_POSE,
  ITEMS,
  classifyItemForRendering,
  itemRenderProfile,
} from '../src/items';
import { isMoveItemsCalibratorPath } from '../src/dev/moveItemsRoute';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import {
  AXE_HANDLE_FLIP_RADIANS,
  AXE_HANDLE_LOCAL_AXIS,
  THIRD_PERSON_HELD_ITEM_DEFAULTS,
  ThirdPersonHeldItemCalibratorState,
  applyThirdPersonHeldItemTransform,
  classifyThirdPersonHeldItem,
  cloneThirdPersonHeldItemTransform,
  defaultThirdPersonHeldItemTransform,
  defaultThirdPersonHeldItemTransformForItem,
  flipAroundLocalAxis,
  formatThirdPersonHeldItemCopy,
  formatThirdPersonHeldItemCopyAll,
  isThirdPersonAxeItem,
  isThirdPersonSwordItem,
  isThirdPersonToolItem,
  thirdPersonHeldTransformsClose,
} from '../src/rendering/player/thirdPersonHeldItem';
import { Euler, Group, Quaternion, Vector3 } from 'three';

const SWORD_IDS = ITEMS.filter((item) => isThirdPersonSwordItem(item)).map((item) => item.id);
const AXE_IDS = ITEMS.filter((item) => isThirdPersonAxeItem(item)).map((item) => item.id);
const OTHER_TOOL_IDS = ITEMS
  .filter((item) => isThirdPersonToolItem(item) && !isThirdPersonAxeItem(item))
  .map((item) => item.id);

describe('moveitems calibrator route', () => {
  it('matches /moveitems with or without a trailing slash', () => {
    expect(isMoveItemsCalibratorPath('/moveitems')).toBe(true);
    expect(isMoveItemsCalibratorPath('/moveitems/')).toBe(true);
    expect(isMoveItemsCalibratorPath('/')).toBe(false);
    expect(isMoveItemsCalibratorPath('/play')).toBe(false);
  });
});

describe('third-person held item defaults', () => {
  it('keeps block, generated, handheld and bow poses unchanged', () => {
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.block).toEqual({
      position: { x: 0, y: -0.02, z: -0.02 },
      rotation: { x: -0.55, y: 0.45, z: -0.28 },
      scale: { x: 0.24, y: 0.24, z: 0.24 },
    });
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.generated).toEqual({
      position: { x: 0, y: -0.04, z: -0.06 },
      rotation: { x: -0.16, y: 0, z: -0.72 },
      scale: { x: 0.40, y: 0.40, z: 0.40 },
    });
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.handheld).toEqual({
      position: { x: 0, y: -0.04, z: -0.06 },
      rotation: { x: -0.16, y: 0, z: -0.72 },
      scale: { x: 0.55, y: 0.55, z: 0.55 },
    });
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.bow.rotation.z).toBe(0.85);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.bow.scale.x).toBe(0.46);
  });

  it('uses one sword pose for every sword and one tool pose for every non-axe tool', () => {
    expect(SWORD_IDS).toEqual([
      'wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword', 'ruby_sword', 'titanium_sword',
    ]);
    expect(OTHER_TOOL_IDS).toContain('wooden_pickaxe');
    expect(OTHER_TOOL_IDS).toContain('iron_pickaxe');
    expect(OTHER_TOOL_IDS).toContain('diamond_pickaxe');
    expect(OTHER_TOOL_IDS).toContain('iron_shovel');
    expect(OTHER_TOOL_IDS).toContain('diamond_shovel');
    expect(OTHER_TOOL_IDS).toContain('golden_hoe');
    expect(OTHER_TOOL_IDS).not.toContain('iron_axe');
    expect(SWORD_IDS).not.toContain('gold_sword');
    expect(OTHER_TOOL_IDS).not.toContain('gold_pickaxe');

    for (const id of ['wooden_sword', 'iron_sword', 'diamond_sword'] as const) {
      expect(classifyThirdPersonHeldItem(id)).toBe('sword');
      expect(classifyItemForRendering(id)).toBe('handheld');
      expect(defaultThirdPersonHeldItemTransformForItem(id)).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.sword);
    }
    for (const id of ['wooden_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'iron_shovel'] as const) {
      expect(classifyThirdPersonHeldItem(id)).toBe('tool');
      expect(classifyItemForRendering(id)).toBe('handheld');
      expect(defaultThirdPersonHeldItemTransformForItem(id)).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool);
    }
    for (const id of SWORD_IDS) {
      expect(defaultThirdPersonHeldItemTransformForItem(id)).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.sword);
    }
    for (const id of OTHER_TOOL_IDS) {
      expect(defaultThirdPersonHeldItemTransformForItem(id)).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool);
    }
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.sword).toEqual({
      position: { x: 0, y: 0.225, z: -0.245 },
      rotation: { x: -0.1232, y: 1.4668, z: -0.1232 },
      scale: { x: 0.55, y: 0.55, z: 0.55 },
    });
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool).toEqual({
      position: { x: 0, y: 0.215, z: -0.155 },
      rotation: { x: -0.1232, y: 1.4668, z: -0.1232 },
      scale: { x: 0.55, y: 0.55, z: 0.55 },
    });
  });

  it('flips every axe 180° around the local handle axis on top of the shared tool pose', () => {
    expect(AXE_IDS).toEqual([
      'wooden_axe', 'stone_axe', 'iron_axe', 'golden_axe', 'diamond_axe', 'ruby_axe', 'titanium_axe',
    ]);
    expect(AXE_HANDLE_LOCAL_AXIS).toEqual({ x: 1, y: 1, z: 0 });
    expect(AXE_HANDLE_FLIP_RADIANS).toBe(Math.PI);

    const expected = flipAroundLocalAxis(
      THIRD_PERSON_HELD_ITEM_DEFAULTS.tool,
      AXE_HANDLE_LOCAL_AXIS,
      AXE_HANDLE_FLIP_RADIANS,
    );
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe.position).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool.position);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe.scale).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool.scale);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe.rotation).not.toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool.rotation);
    expect(thirdPersonHeldTransformsClose(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe, expected)).toBe(true);

    const identity = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const spun = flipAroundLocalAxis(identity, { x: 0, y: 0, z: 1 }, Math.PI);
    expect(spun.rotation.x).toBeCloseTo(0, 6);
    expect(spun.rotation.y).toBeCloseTo(0, 6);
    expect(spun.rotation.z).toBeCloseTo(Math.PI, 6);

    const poseQ = new Quaternion().setFromEuler(new Euler(-0.1232, 1.4668, -0.1232, 'XYZ'));
    const composed = poseQ.clone().multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 1, 0).normalize(), Math.PI),
    );
    const euler = new Euler().setFromQuaternion(composed, 'XYZ');
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe.rotation.x).toBeCloseTo(euler.x, 6);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe.rotation.y).toBeCloseTo(euler.y, 6);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe.rotation.z).toBeCloseTo(euler.z, 6);

    for (const id of ['wooden_axe', 'iron_axe', 'diamond_axe'] as const) {
      expect(classifyThirdPersonHeldItem(id)).toBe('axe');
      expect(classifyItemForRendering(id)).toBe('handheld');
      expect(defaultThirdPersonHeldItemTransformForItem(id)).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe);
    }
    for (const id of AXE_IDS) {
      expect(isThirdPersonAxeItem(id)).toBe(true);
      expect(isThirdPersonToolItem(id)).toBe(true);
      expect(classifyThirdPersonHeldItem(id)).toBe('axe');
      expect(defaultThirdPersonHeldItemTransformForItem(id)).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.axe);
    }
  });

  it('leaves stick, flint, blocks, generated items and bow on the historical third-person poses', () => {
    expect(classifyThirdPersonHeldItem('stick')).toBe('handheld');
    expect(classifyThirdPersonHeldItem('flint_and_steel')).toBe('handheld');
    expect(defaultThirdPersonHeldItemTransformForItem('stick')).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.handheld);
    expect(classifyThirdPersonHeldItem('stone')).toBe('block');
    expect(classifyThirdPersonHeldItem('apple')).toBe('generated');
    expect(classifyThirdPersonHeldItem('bow')).toBe('bow');
    expect(defaultThirdPersonHeldItemTransformForItem('stone')).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.block);
    expect(defaultThirdPersonHeldItemTransformForItem('apple')).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.generated);
    expect(defaultThirdPersonHeldItemTransformForItem('bow')).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.bow);
  });

  it('does not change the first-person production pose or handheld first-person profile', () => {
    expect(FIRST_PERSON_SPRITE_POSE.position).toEqual([0.67, -0.29, -0.70]);
    expect(FIRST_PERSON_SPRITE_POSE.rotationDeg).toEqual([1, -90, 34]);
    expect(FIRST_PERSON_SPRITE_POSE.scale).toBe(0.60);
    const handheldFp = itemRenderProfile('iron_pickaxe').transforms.firstPersonRightHand;
    const swordFp = itemRenderProfile('diamond_sword').transforms.firstPersonRightHand;
    expect(handheldFp.position).toEqual(FIRST_PERSON_SPRITE_POSE.position);
    expect(swordFp.position).toEqual(FIRST_PERSON_SPRITE_POSE.position);
    expect(handheldFp.scale).toEqual([0.60, 0.60, 0.60]);
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
    expect(reset.position.y).toBe(0.215);
    expect(state.get('diamond_sword').position.x).toBe(1);
  });

  it('formats COPY and COPY ALL blocks for later production write', () => {
    const transform = defaultThirdPersonHeldItemTransformForItem('iron_pickaxe');
    const text = formatThirdPersonHeldItemCopy('iron_pickaxe', transform);
    expect(text).toContain('Item: iron_pickaxe');
    expect(text).toContain('position:');
    expect(text).toContain('rotation:');
    expect(text).toContain('scale:');
    expect(text).toContain('y: 0.215');
    const all = formatThirdPersonHeldItemCopyAll([
      { itemId: 'iron_pickaxe', transform },
      { itemId: 'bow', transform: defaultThirdPersonHeldItemTransformForItem('bow') },
    ]);
    expect(all).toContain('Item: iron_pickaxe');
    expect(all).toContain('Item: bow');
  });
});

describe('PlayerVisual third-person held calibration', () => {
  it('applies sword, tool and axe production poses then live overlay without mutating defaults', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    visual.setHeldItem('iron_pickaxe');
    expect(thirdPersonHeldTransformsClose(
      visual.readHeldItemTransform()!,
      defaultThirdPersonHeldItemTransform('tool'),
    )).toBe(true);

    visual.setHeldItem('wooden_axe');
    expect(thirdPersonHeldTransformsClose(
      visual.readHeldItemTransform()!,
      defaultThirdPersonHeldItemTransform('axe'),
    )).toBe(true);
    expect(visual.readHeldItemTransform()?.position).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool.position);
    expect(visual.readHeldItemTransform()?.scale).toEqual(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool.scale);

    visual.setHeldItem('diamond_sword');
    expect(thirdPersonHeldTransformsClose(
      visual.readHeldItemTransform()!,
      defaultThirdPersonHeldItemTransform('sword'),
    )).toBe(true);

    const live = cloneThirdPersonHeldItemTransform(visual.readHeldItemTransform()!);
    live.position.x = 0.2;
    live.rotation.z = -0.3;
    live.scale.x = 0.7;
    visual.applyHeldItemCalibration(live);
    expect(visual.readHeldItemTransform()?.position.x).toBeCloseTo(0.2);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.sword.position.y).toBe(0.225);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.tool.position.y).toBe(0.215);

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
