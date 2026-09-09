import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerEquipmentState } from '../shared/protocol';
import { FirstPersonRenderer } from '../src/rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { DEFAULT_PLAYER_APPEARANCE, createPlayerAppearance } from '../src/player/appearance/PlayerAppearance';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import {
  ARMOR_BASE_RENDER_ORDER,
  ARMOR_OVERLAY_RENDER_ORDER,
  ARMOR_PART_RENDER_PRIORITY,
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
import {
  PlayerVisual,
  SKIN_BASE_RENDER_ORDER,
  SKIN_OUTER_RENDER_ORDER,
  SKIN_PART_RENDER_PRIORITY,
} from '../src/rendering/player/PlayerVisual';

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
    expect(paths).toHaveLength(18);
    for (const filename of expected) expect(paths.some((path) => path.endsWith(filename)), filename).toBe(true);
    expect(new Set(ARMOR_VISUAL_MATERIALS.flatMap((material) => [
      ARMOR_TEXTURE_URLS[material][1], ARMOR_TEXTURE_URLS[material][2],
    ])).size).toBe(14);
    expect(LEATHER_ARMOR_OVERLAY_URLS[1]).not.toBe(ARMOR_TEXTURE_URLS.iron[1]);
    expect(ARMOR_TEXTURE_URLS.ruby[1]).not.toBe(ARMOR_TEXTURE_URLS.diamond[1]);
    expect(ARMOR_TEXTURE_URLS.titanium[2]).not.toBe(ARMOR_TEXTURE_URLS.ruby[2]);
  });

  it('shares cached nearest-neighbor cutout textures and templates', () => {
    const cache = new PlayerArmorMaterialCache();
    for (const material of ARMOR_VISUAL_MATERIALS) {
      for (const layer of [1, 2] as const) {
        const base = cache.template(material, layer);
        expect(cache.template(material, layer)).toBe(base);
        expect(base.map?.magFilter, `${material}:${layer}`).toBe(THREE.NearestFilter);
        expect(base.map?.minFilter, `${material}:${layer}`).toBe(THREE.NearestFilter);
        expect(base.map?.generateMipmaps, `${material}:${layer}`).toBe(false);
        expect(base.alphaTest, `${material}:${layer}`).toBeGreaterThan(0);
        expect(base.transparent, `${material}:${layer}`).toBe(false);
        expect(base.depthWrite, `${material}:${layer}`).toBe(true);
        expect(base.depthTest, `${material}:${layer}`).toBe(true);
      }
    }
    const iron = cache.template('iron', 1);
    const chain = cache.template('chainmail', 1);
    expect(chain.map).not.toBe(iron.map);
    for (const layer of [1, 2] as const) {
      const leatherOverlay = cache.template('leather', layer, 'overlay');
      expect(leatherOverlay.alphaTest).toBeGreaterThan(0);
      expect(leatherOverlay.transparent).toBe(false);
      expect(leatherOverlay.depthWrite).toBe(true);
      expect(leatherOverlay.depthTest).toBe(true);
    }
    cache.dispose();
  });
});

describe('PlayerArmorVisual slot visibility', () => {
  it('uses deterministic part render order independent of armor material', () => {
    const fixture = createVisual();
    const visual = fixture.visual;
    expect(ARMOR_PART_RENDER_PRIORITY).toEqual({
      head: 0, body: 0, rightArm: 1, leftArm: 2, rightLeg: 1, leftLeg: 2,
    });

    for (const material of ARMOR_VISUAL_MATERIALS) {
      visual.setArmor({
        head: `${material}_helmet`,
        chest: `${material}_chestplate`,
        legs: `${material}_leggings`,
        feet: `${material}_boots`,
      });
      for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
        for (const pair of visual.armor.meshes(slot)) {
          const priority = ARMOR_PART_RENDER_PRIORITY[pair.part];
          const baseMaterial = pair.base.material as THREE.MeshBasicMaterial;
          expect(pair.base.renderOrder, `${material}:${slot}:${pair.part}:base`)
            .toBe(ARMOR_BASE_RENDER_ORDER + priority);
          expect(pair.overlay.renderOrder, `${material}:${slot}:${pair.part}:overlay`)
            .toBe(ARMOR_OVERLAY_RENDER_ORDER + priority);
          expect(baseMaterial.transparent, `${material}:${slot}:${pair.part}:transparent`).toBe(false);
          expect(baseMaterial.depthWrite, `${material}:${slot}:${pair.part}:depthWrite`).toBe(true);
          expect(baseMaterial.depthTest, `${material}:${slot}:${pair.part}:depthTest`).toBe(true);
          expect(baseMaterial.polygonOffset, `${material}:${slot}:${pair.part}:polygonOffset`)
            .toBe(priority > 0);
          expect(baseMaterial.polygonOffsetFactor, `${material}:${slot}:${pair.part}:polygonOffsetFactor`)
            .toBe(-priority);
          expect(baseMaterial.polygonOffsetUnits, `${material}:${slot}:${pair.part}:polygonOffsetUnits`)
            .toBe(-priority);
        }
      }
    }

    const chest = Object.fromEntries(visual.armor.meshes('chest').map((pair) => [pair.part, pair.base.renderOrder]));
    expect(chest).toMatchObject({ body: 20, rightArm: 21, leftArm: 22 });
    const legs = Object.fromEntries(visual.armor.meshes('legs').map((pair) => [pair.part, pair.base.renderOrder]));
    expect(legs).toMatchObject({ body: 20, rightLeg: 21, leftLeg: 22 });
    const feet = Object.fromEntries(visual.armor.meshes('feet').map((pair) => [pair.part, pair.base.renderOrder]));
    expect(feet).toEqual({ rightLeg: 21, leftLeg: 22 });
    fixture.dispose();
  });

  it('keeps skin, mixed armor, and leather overlay in one strict order for classic and slim', () => {
    const fixture = createVisual();
    for (const model of ['classic', 'slim'] as const) {
      fixture.visual.setAppearance(createPlayerAppearance({
        skinId: '0f15ad5e5c148f40',
        model,
      }));
      fixture.visual.setArmor({
        head: 'iron_helmet',
        chest: 'leather_chestplate',
        legs: 'diamond_leggings',
        feet: 'titanium_boots',
      });
      const skinBase = Object.keys(SKIN_PART_RENDER_PRIORITY).map((part) => (
        fixture.visual.rig[part as keyof typeof fixture.visual.rig]
          .getObjectByName(`player:${part}:base`) as THREE.Mesh
      ));
      const skinOuter = Object.keys(SKIN_PART_RENDER_PRIORITY).map((part) => (
        fixture.visual.rig[part as keyof typeof fixture.visual.rig]
          .getObjectByName(`player:${part}:outer`) as THREE.Mesh
      ));
      const armorBase = (['head', 'chest', 'legs', 'feet'] as const)
        .flatMap((slot) => fixture.visual.armor.meshes(slot).filter((pair) => pair.base.visible).map((pair) => pair.base));
      const leatherOverlay = fixture.visual.armor.meshes('chest')
        .filter((pair) => pair.overlay.visible).map((pair) => pair.overlay);
      expect(Math.min(...skinBase.map((mesh) => mesh.renderOrder))).toBe(SKIN_BASE_RENDER_ORDER);
      expect(Math.max(...skinBase.map((mesh) => mesh.renderOrder)))
        .toBe(SKIN_BASE_RENDER_ORDER + 2);
      expect(Math.min(...skinOuter.map((mesh) => mesh.renderOrder))).toBe(SKIN_OUTER_RENDER_ORDER);
      expect(Math.max(...skinBase.map((mesh) => mesh.renderOrder)))
        .toBeLessThan(Math.min(...skinOuter.map((mesh) => mesh.renderOrder)));
      expect(Math.max(...skinOuter.map((mesh) => mesh.renderOrder)))
        .toBeLessThan(Math.min(...armorBase.map((mesh) => mesh.renderOrder)));
      expect(Math.max(...armorBase.map((mesh) => mesh.renderOrder)))
        .toBeLessThan(Math.min(...leatherOverlay.map((mesh) => mesh.renderOrder)));
      expect(skinOuter.every((mesh) => (mesh.material as THREE.MeshBasicMaterial).depthTest)).toBe(true);
      expect(skinOuter.every((mesh) => (mesh.material as THREE.MeshBasicMaterial).depthWrite)).toBe(true);
      expect(armorBase.every((mesh) => !(mesh.material as THREE.MeshBasicMaterial).transparent)).toBe(true);
    }
    fixture.dispose();
  });

  it('always renders a leather overlay after its corresponding base', () => {
    const fixture = createVisual();
    fixture.visual.setArmor({
      head: 'leather_helmet', chest: 'leather_chestplate',
      legs: 'leather_leggings', feet: 'leather_boots',
    });
    for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
      for (const pair of fixture.visual.armor.meshes(slot)) {
        expect(pair.overlay.visible).toBe(true);
        expect(pair.overlay.renderOrder).toBeGreaterThan(pair.base.renderOrder);
        const baseMaterial = pair.base.material as THREE.MeshBasicMaterial;
        const overlayMaterial = pair.overlay.material as THREE.MeshBasicMaterial;
        expect(overlayMaterial.transparent).toBe(false);
        expect(overlayMaterial.depthWrite).toBe(true);
        expect(overlayMaterial.depthTest).toBe(true);
        expect(overlayMaterial.polygonOffset).toBe(baseMaterial.polygonOffset);
        expect(overlayMaterial.polygonOffsetFactor).toBe(baseMaterial.polygonOffsetFactor);
        expect(overlayMaterial.polygonOffsetUnits).toBe(baseMaterial.polygonOffsetUnits);
      }
    }
    fixture.dispose();
  });

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
      head: 'ruby_helmet',
      chest: 'titanium_chestplate',
      legs: 'ruby_leggings',
      feet: 'titanium_boots',
    };
    visual.setArmor(mixed);
    expect(visual.armor.meshes('head')[0]!.base).toBe(helmet);
    expect(materialName(helmet)).toContain(':ruby:1:base');
    expect(materialName(visual.armor.meshes('chest')[0]!.base)).toContain(':titanium:1:base');
    expect(materialName(visual.armor.meshes('legs')[0]!.base)).toContain(':ruby:2:base');
    expect(materialName(visual.armor.meshes('feet')[0]!.base)).toContain(':titanium:1:base');
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

  it('keeps Ruby and Titanium armor plus the held item visible while only skin is invisible', () => {
    const fixture = createVisual();
    const visual = fixture.visual;
    visual.setArmor({ ...EMPTY, head: 'ruby_helmet', chest: 'titanium_chestplate' });
    visual.setHeldItem('titanium_sword');

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
      head: 'ruby_helmet', chest: 'titanium_chestplate', legs: 'ruby_leggings', feet: 'titanium_boots',
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
