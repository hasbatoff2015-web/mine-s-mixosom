import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerEquipmentState } from '../shared/protocol';
import { FirstPersonRenderer } from '../src/rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import {
  ARMOR_TEXTURE_URLS,
  ARMOR_VISUAL_MATERIALS,
  DEFAULT_LEATHER_ARMOR_COLOR,
  LEATHER_ARMOR_OVERLAY_URLS,
  PLAYER_ARMOR_INNER_INFLATE,
  PLAYER_ARMOR_OUTER_INFLATE,
  PlayerArmorGeometryCache,
  PlayerArmorMaterialCache,
  armorVisualItemId,
  playerArmorPartDefinition,
  resolveArmorVisual,
} from '../src/rendering/player/PlayerArmorVisual';
import { PLAYER_MODEL_PIXEL, PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';

const ARMOR_ASSETS = import.meta.glob('../assets/minecraft/textures/models/armor/*.png');
const EMPTY: PlayerEquipmentState = { head: null, chest: null, legs: null, feet: null };

function createVisual() {
  const skins = new MinecraftSkinRegistry();
  const skinGeometries = new PlayerSkinGeometryCache();
  const items = new ItemVisualFactory();
  const materials = new PlayerArmorMaterialCache();
  const geometries = new PlayerArmorGeometryCache();
  const armorResources = { materials, geometries };
  const visual = new PlayerVisual(
    skins,
    skinGeometries,
    items,
    DEFAULT_PLAYER_APPEARANCE,
    { armorResources },
  );
  return {
    visual,
    skins,
    skinGeometries,
    items,
    materials,
    geometries,
    dispose: () => {
      visual.dispose();
      skins.dispose();
      skinGeometries.dispose();
      items.dispose();
      materials.dispose();
      geometries.dispose();
    },
  };
}

function visibleBaseCount(visual: PlayerVisual, slot: keyof PlayerEquipmentState): number {
  return visual.armor.meshes(slot).filter((pair) => pair.base.visible).length;
}

function materialName(mesh: THREE.Mesh): string {
  return (mesh.material as THREE.Material).name;
}

function updateVisibility(visual: PlayerVisual, invisible: boolean): void {
  visual.update(0, {
    viewYaw: 0, viewPitch: 0, movementSpeed: 0, onGround: true, sneaking: false,
    sprinting: false, verticalVelocity: 0, mining: false, bowCharge: 0,
    swordBlocking: false, foodUseProgress: 0, invisible, hurtFlash: 0,
  });
}

function skinMeshes(visual: PlayerVisual, layer: 'base' | 'outer'): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  visual.root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.match(new RegExp(`^player:[^:]+:${layer}$`))) {
      meshes.push(object);
    }
  });
  return meshes;
}

describe('vanilla armor item presentation mapping', () => {
  it('maps every material slot to layer 1 except leggings on layer 2', () => {
    for (const material of ARMOR_VISUAL_MATERIALS) {
      expect(resolveArmorVisual(armorVisualItemId(material, 'head'))).toMatchObject({ material, slot: 'head', textureLayer: 1 });
      expect(resolveArmorVisual(armorVisualItemId(material, 'chest'))).toMatchObject({ material, slot: 'chest', textureLayer: 1 });
      expect(resolveArmorVisual(armorVisualItemId(material, 'legs'))).toMatchObject({ material, slot: 'legs', textureLayer: 2 });
      expect(resolveArmorVisual(armorVisualItemId(material, 'feet'))).toMatchObject({ material, slot: 'feet', textureLayer: 1 });
    }
  });

  it('does not present blocks, weapons, food, unknown ids, or a piece in the wrong slot', () => {
    for (const itemId of ['stone', 'bow', 'apple', 'missing_helmet']) {
      expect(resolveArmorVisual(itemId)).toBeUndefined();
    }
    const fixture = createVisual();
    fixture.visual.setArmor({ ...EMPTY, head: 'iron_boots' });
    expect(visibleBaseCount(fixture.visual, 'head')).toBe(0);
    fixture.dispose();
  });
});

describe('vanilla armor geometry and resources', () => {
  it('uses the 64x32 entity atlas and exact half/one-pixel shell deformation', () => {
    expect(playerArmorPartDefinition('head', 'outer')).toMatchObject({
      size: [8, 8, 8], textureOffset: [0, 0], logicalTextureSize: [64, 32],
    });
    expect(playerArmorPartDefinition('body', 'inner')).toMatchObject({
      size: [8, 12, 4], textureOffset: [16, 16], logicalTextureSize: [64, 32],
    });
    expect(playerArmorPartDefinition('rightArm', 'outer')).toMatchObject({
      size: [4, 12, 4], textureOffset: [40, 16], logicalTextureSize: [64, 32],
    });
    expect(playerArmorPartDefinition('rightLeg', 'inner')).toMatchObject({
      size: [4, 12, 4], textureOffset: [0, 16], logicalTextureSize: [64, 32],
    });
    expect(playerArmorPartDefinition('body', 'inner').inflate).toBeCloseTo(PLAYER_ARMOR_INNER_INFLATE);
    expect(playerArmorPartDefinition('body', 'outer').inflate).toBeCloseTo(PLAYER_ARMOR_OUTER_INFLATE);
    expect(PLAYER_ARMOR_INNER_INFLATE).toBeCloseTo(0.5 * PLAYER_MODEL_PIXEL);
    expect(PLAYER_ARMOR_OUTER_INFLATE).toBeCloseTo(PLAYER_MODEL_PIXEL);
  });

  it('ships every supplied atlas without an iron fallback', () => {
    const expected = [
      ...ARMOR_VISUAL_MATERIALS.flatMap((material) => [
        `${material}_layer_1.png`,
        `${material}_layer_2.png`,
      ]),
      'leather_layer_1_overlay.png',
      'leather_layer_2_overlay.png',
    ];
    const paths = Object.keys(ARMOR_ASSETS);
    expect(paths).toHaveLength(12);
    for (const filename of expected) expect(paths.some((path) => path.endsWith(filename)), filename).toBe(true);
    expect(new Set(ARMOR_VISUAL_MATERIALS.flatMap((material) => [
      ARMOR_TEXTURE_URLS[material][1], ARMOR_TEXTURE_URLS[material][2],
    ])).size).toBe(10);
    expect(LEATHER_ARMOR_OVERLAY_URLS[1]).not.toBe(ARMOR_TEXTURE_URLS.iron[1]);
  });

  it('shares cached nearest-neighbor cutout textures and templates', () => {
    const cache = new PlayerArmorMaterialCache();
    const iron = cache.template('iron', 1);
    expect(cache.template('iron', 1)).toBe(iron);
    expect(iron.map?.magFilter).toBe(THREE.NearestFilter);
    expect(iron.map?.minFilter).toBe(THREE.NearestFilter);
    expect(iron.map?.generateMipmaps).toBe(false);
    expect(iron.alphaTest).toBeGreaterThan(0);
    expect(iron.transparent).toBe(true);
    expect(iron.depthWrite).toBe(true);
    const chain = cache.template('chainmail', 1);
    expect(chain.map).not.toBe(iron.map);
    expect(chain.alphaTest).toBeGreaterThan(0);
    cache.dispose();
  });
});

describe('PlayerArmorVisual slot visibility', () => {
  it('shows only the shell group selected by each independent slot', () => {
    const fixture = createVisual();
    const visual = fixture.visual;
    visual.setArmor({ ...EMPTY, head: 'iron_helmet' });
    expect(visibleBaseCount(visual, 'head')).toBe(1);
    expect(visibleBaseCount(visual, 'chest')).toBe(0);
    expect(visibleBaseCount(visual, 'legs')).toBe(0);
    expect(visibleBaseCount(visual, 'feet')).toBe(0);

    visual.setArmor({ ...EMPTY, chest: 'iron_chestplate' });
    expect(visibleBaseCount(visual, 'head')).toBe(0);
    expect(visibleBaseCount(visual, 'chest')).toBe(3);

    visual.setArmor({ ...EMPTY, legs: 'iron_leggings' });
    expect(visibleBaseCount(visual, 'legs')).toBe(3);

    visual.setArmor({ ...EMPTY, feet: 'iron_boots' });
    expect(visibleBaseCount(visual, 'feet')).toBe(2);
    fixture.dispose();
  });

  it('keeps meshes stable while equip, unequip, full, and mixed sets change materials', () => {
    const fixture = createVisual();
    const visual = fixture.visual;
    const helmet = visual.armor.meshes('head')[0]!.base;
    const mixed: PlayerEquipmentState = {
      head: 'iron_helmet',
      chest: 'diamond_chestplate',
      legs: 'gold_leggings',
      feet: 'leather_boots',
    };
    visual.setArmor(mixed);
    expect(visual.armor.meshes('head')[0]!.base).toBe(helmet);
    expect(materialName(helmet)).toContain(':iron:1:base');
    expect(materialName(visual.armor.meshes('chest')[0]!.base)).toContain(':diamond:1:base');
    expect(materialName(visual.armor.meshes('legs')[0]!.base)).toContain(':gold:2:base');
    expect(materialName(visual.armor.meshes('feet')[0]!.base)).toContain(':leather:1:base');
    expect(visibleBaseCount(visual, 'head')).toBe(1);
    expect(visibleBaseCount(visual, 'chest')).toBe(3);
    expect(visibleBaseCount(visual, 'legs')).toBe(3);
    expect(visibleBaseCount(visual, 'feet')).toBe(2);

    visual.setArmor({ ...mixed, chest: null });
    expect(visual.armor.meshes('head')[0]!.base).toBe(helmet);
    expect(visibleBaseCount(visual, 'chest')).toBe(0);
    expect(visibleBaseCount(visual, 'head')).toBe(1);
    expect(visibleBaseCount(visual, 'legs')).toBe(3);
    expect(visibleBaseCount(visual, 'feet')).toBe(2);
    fixture.dispose();
  });

  it('renders leather base tint plus untinted overlay', () => {
    const fixture = createVisual();
    const visual = fixture.visual;
    visual.setArmor({ ...EMPTY, chest: 'leather_chestplate' });
    for (const pair of visual.armor.meshes('chest')) {
      expect(pair.base.visible).toBe(true);
      expect(pair.overlay.visible).toBe(true);
      expect((pair.base.material as THREE.MeshBasicMaterial).color.getHex()).toBe(DEFAULT_LEATHER_ARMOR_COLOR);
      expect((pair.overlay.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);
    }
    fixture.dispose();
  });

  it('keeps iron and diamond armor plus the held item visible while only skin is invisible', () => {
    const fixture = createVisual();
    const visual = fixture.visual;
    visual.setArmor({ ...EMPTY, head: 'iron_helmet', chest: 'diamond_chestplate' });
    visual.setHeldItem('diamond_sword');

    updateVisibility(visual, false);
    expect(skinMeshes(visual, 'base').every((mesh) => mesh.visible)).toBe(true);
    expect(skinMeshes(visual, 'outer').every((mesh) => mesh.visible)).toBe(true);
    expect(visibleBaseCount(visual, 'head')).toBe(1);
    expect(visibleBaseCount(visual, 'chest')).toBe(3);
    expect(visual.rig.heldItem.visible).toBe(true);

    updateVisibility(visual, true);
    expect(skinMeshes(visual, 'base').every((mesh) => !mesh.visible)).toBe(true);
    expect(skinMeshes(visual, 'outer').every((mesh) => !mesh.visible)).toBe(true);
    expect(visibleBaseCount(visual, 'head')).toBe(1);
    expect(visibleBaseCount(visual, 'chest')).toBe(3);
    expect(visual.rig.heldItem.visible).toBe(true);

    updateVisibility(visual, false);
    expect(skinMeshes(visual, 'base').every((mesh) => mesh.visible)).toBe(true);
    expect(skinMeshes(visual, 'outer').every((mesh) => mesh.visible)).toBe(true);
    expect(visibleBaseCount(visual, 'head')).toBe(1);
    expect(visibleBaseCount(visual, 'chest')).toBe(3);
    fixture.dispose();
  });

  it('inherits animation from the canonical pivots without copying armor rotations', () => {
    const fixture = createVisual();
    const visual = fixture.visual;
    visual.setArmor({ ...EMPTY, chest: 'iron_chestplate' });
    const armArmor = visual.armor.meshes('chest').find((pair) => pair.part === 'rightArm')!.base;
    expect(armArmor.parent).toBe(visual.rig.rightArm);
    visual.update(0.05, {
      viewYaw: 0.7, viewPitch: 0.25, movementSpeed: 4, onGround: true, sneaking: false,
      sprinting: true, verticalVelocity: 0, mining: true, bowCharge: 0,
      swordBlocking: false, foodUseProgress: 0, invisible: false, hurtFlash: 0,
    });
    expect(visual.rig.rightArm.rotation.x).not.toBe(0);
    expect(armArmor.rotation.x).toBe(0);
    fixture.dispose();
  });
});

describe('first-person armor presentation', () => {
  it('keeps a full armor set out of the first-person player arm scene', () => {
    const fixture = createVisual();
    const renderer = new FirstPersonRenderer(fixture.items);
    fixture.visual.setArmor({
      head: 'iron_helmet', chest: 'diamond_chestplate', legs: 'gold_leggings', feet: 'leather_boots',
    });
    expect(visibleBaseCount(fixture.visual, 'head')).toBe(1);
    expect(visibleBaseCount(fixture.visual, 'chest')).toBe(3);
    expect(visibleBaseCount(fixture.visual, 'legs')).toBe(3);
    expect(visibleBaseCount(fixture.visual, 'feet')).toBe(2);
    const names: string[] = [];
    renderer.root.traverse((object) => names.push(object.name));
    expect(names.some((name) => name.includes('armor'))).toBe(false);
    expect('setArmor' in renderer).toBe(false);
    renderer.dispose();
    fixture.dispose();
  });
});
