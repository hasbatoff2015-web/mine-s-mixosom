import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FirstPersonRenderer } from '../src/rendering/FirstPersonRenderer';
import {
  ALL_PLAYER_SKIN_LAYERS,
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import {
  BUILTIN_MINECRAFT_SKINS,
  MinecraftSkinRegistry,
  validateMinecraftSkinDimensions,
} from '../src/rendering/player/MinecraftSkin';
import { PRODUCTION_PLAYER_SKINS } from '../src/player/appearance/builtinSkins';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import {
  PLAYER_MODEL_PIXEL,
  PlayerSkinGeometryCache,
  playerSkinPartDefinition,
  playerSkinPartSize,
  playerSkinUvRects,
  type PlayerSkinPart,
} from '../src/rendering/player/PlayerSkinGeometry';
import {
  PlayerVisual,
  SKIN_BASE_RENDER_ORDER,
  SKIN_OUTER_RENDER_ORDER,
  SKIN_PART_RENDER_PRIORITY,
} from '../src/rendering/player/PlayerVisual';

const PLAYER_SKIN_ASSETS = import.meta.glob('../public/textures/**/*.png');
const SKIN_PARTS = Object.keys(SKIN_PART_RENDER_PRIORITY) as PlayerSkinPart[];
const PART_LAYER_KEY = {
  head: 'hat',
  body: 'jacket',
  rightArm: 'rightSleeve',
  leftArm: 'leftSleeve',
  rightLeg: 'rightPants',
  leftLeg: 'leftPants',
} as const;

function skinMesh(visual: PlayerVisual, part: PlayerSkinPart, layer: 'base' | 'outer'): THREE.Mesh {
  return visual.rig[part].getObjectByName(`player:${part}:${layer}`) as THREE.Mesh;
}

function createVisual(appearance = DEFAULT_PLAYER_APPEARANCE) {
  const registry = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  const items = new ItemVisualFactory();
  const visual = new PlayerVisual(registry, geometries, items, appearance);
  return {
    visual,
    registry,
    geometries,
    items,
    dispose: () => {
      visual.dispose();
      geometries.dispose();
      items.dispose();
      registry.dispose();
    },
  };
}

describe('Minecraft-compatible player skins', () => {
  it('accepts modern 64x64 and rejects legacy or arbitrary dimensions', () => {
    expect(validateMinecraftSkinDimensions(64, 64)).toEqual({ ok: true });
    expect(validateMinecraftSkinDimensions(64, 32)).toMatchObject({ ok: false });
    expect(validateMinecraftSkinDimensions(128, 128)).toMatchObject({ ok: false });
  });

  it('ships every unique archive skin and the authored QA sheet under its registry path', () => {
    expect(BUILTIN_MINECRAFT_SKINS).toHaveLength(46);
    expect(PRODUCTION_PLAYER_SKINS).toHaveLength(45);
    expect(new Set(BUILTIN_MINECRAFT_SKINS.map((skin) => skin.id)).size).toBe(46);
    for (const skin of BUILTIN_MINECRAFT_SKINS) {
      expect(
        Object.keys(PLAYER_SKIN_ASSETS).some((path) => path.endsWith(`/textures/${skin.texturePath}.png`)),
        skin.id,
      ).toBe(true);
    }
  });

  it('uses canonical part sizes and distinct modern left/right and outer UV islands', () => {
    expect(playerSkinPartSize('head', 'classic')).toEqual([8, 8, 8]);
    expect(playerSkinPartSize('body', 'classic')).toEqual([8, 12, 4]);
    expect(playerSkinPartSize('rightArm', 'classic')).toEqual([4, 12, 4]);
    expect(playerSkinPartSize('rightArm', 'slim')).toEqual([3, 12, 4]);
    expect(playerSkinUvRects('rightArm', 'classic', 'base').front).toEqual({ u: 44, v: 20, width: 4, height: 12 });
    expect(playerSkinUvRects('leftArm', 'classic', 'base').front).toEqual({ u: 36, v: 52, width: 4, height: 12 });
    expect(playerSkinUvRects('rightArm', 'classic', 'outer').front).toEqual({ u: 44, v: 36, width: 4, height: 12 });
    expect(playerSkinUvRects('leftLeg', 'classic', 'outer').front).toEqual({ u: 4, v: 52, width: 4, height: 12 });
    expect(playerSkinPartDefinition('head', 'classic', 'outer').inflate).toBeCloseTo(0.5 * PLAYER_MODEL_PIXEL);
    expect(playerSkinPartDefinition('body', 'classic', 'outer').inflate).toBeCloseTo(0.25 * PLAYER_MODEL_PIXEL);
  });

  it('configures nearest filtering and reuses one texture until its final reference is released', () => {
    const registry = new MinecraftSkinRegistry();
    const first = registry.acquire(DEFAULT_PLAYER_APPEARANCE.skinId);
    const second = registry.acquire(DEFAULT_PLAYER_APPEARANCE.skinId);
    expect(first.texture).toBe(second.texture);
    expect(first.texture.magFilter).toBe(THREE.NearestFilter);
    expect(first.texture.minFilter).toBe(THREE.NearestFilter);
    expect(first.texture.generateMipmaps).toBe(false);
    expect(registry.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(2);
    first.release();
    expect(registry.cacheSize).toBe(1);
    second.release();
    expect(registry.cacheSize).toBe(0);
    registry.dispose();
  });

  it('swaps appearance without recreating the world rig and releases old skin references', () => {
    const registry = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(registry, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    const root = visual.root;
    const slim = createPlayerAppearance({
      skinId: 'e3eb6f99ea1c3fe1',
      model: 'slim',
      layers: { ...ALL_PLAYER_SKIN_LAYERS, hat: false },
    });
    expect(registry.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(1);
    visual.setAppearance(slim);
    expect(visual.root).toBe(root);
    expect(visual.appearance).toEqual(slim);
    expect(registry.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(0);
    expect(registry.referenceCount(slim.skinId)).toBe(1);
    const armBase = visual.rig.rightArm.getObjectByName('player:rightArm:base') as THREE.Mesh;
    const armWidth = new THREE.Box3().setFromBufferAttribute(
      armBase.geometry.getAttribute('position') as THREE.BufferAttribute,
    ).getSize(new THREE.Vector3()).x;
    expect(armWidth).toBeCloseTo(3 * PLAYER_MODEL_PIXEL);
    visual.dispose();
    expect(registry.cacheSize).toBe(0);
    geometries.dispose();
    items.dispose();
    registry.dispose();
  });

  it('uses entity-owned base/outer materials on one shared texture with data-driven alpha semantics', () => {
    const first = createVisual();
    const second = new PlayerVisual(first.registry, first.geometries, first.items, DEFAULT_PLAYER_APPEARANCE);
    const firstBase = skinMesh(first.visual, 'body', 'base').material as THREE.MeshBasicMaterial;
    const secondBase = skinMesh(second, 'body', 'base').material as THREE.MeshBasicMaterial;
    expect(firstBase).not.toBe(secondBase);

    const binaryMaterials = SKIN_PARTS.flatMap((part) => [
      skinMesh(first.visual, part, 'base').material as THREE.MeshBasicMaterial,
      skinMesh(first.visual, part, 'outer').material as THREE.MeshBasicMaterial,
    ]);
    expect(new Set(binaryMaterials.map((material) => material.map))).toEqual(new Set([firstBase.map]));
    expect(new Set(SKIN_PARTS.map((part) => skinMesh(first.visual, part, 'base').material))).toHaveLength(1);
    expect(new Set(SKIN_PARTS.map((part) => skinMesh(first.visual, part, 'outer').material))).toHaveLength(3);
    for (const part of SKIN_PARTS) {
      const base = skinMesh(first.visual, part, 'base').material as THREE.MeshBasicMaterial;
      const outer = skinMesh(first.visual, part, 'outer').material as THREE.MeshBasicMaterial;
      expect(base.alphaTest, `${part}:base:alphaTest`).toBeGreaterThan(0);
      expect(base.transparent, `${part}:base:transparent`).toBe(false);
      expect(base.depthTest, `${part}:base:depthTest`).toBe(true);
      expect(base.depthWrite, `${part}:base:depthWrite`).toBe(true);
      expect(outer.alphaTest, `${part}:outer:alphaTest`).toBeGreaterThan(0);
      expect(outer.transparent, `${part}:outer:transparent`).toBe(false);
      expect(outer.depthTest, `${part}:outer:depthTest`).toBe(true);
      expect(outer.depthWrite, `${part}:outer:depthWrite`).toBe(true);
    }

    const materialObjects = new Set(binaryMaterials);
    const previousTexture = firstBase.map;
    first.visual.setAppearance(createPlayerAppearance({
      skinId: '0f15ad5e5c148f40',
      model: 'slim',
    }));
    expect(first.registry.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(1);
    expect(first.registry.referenceCount('0f15ad5e5c148f40')).toBe(1);
    const translucentMaterials = SKIN_PARTS.flatMap((part) => [
      skinMesh(first.visual, part, 'base').material as THREE.MeshBasicMaterial,
      skinMesh(first.visual, part, 'outer').material as THREE.MeshBasicMaterial,
    ]);
    expect(new Set(translucentMaterials)).toEqual(materialObjects);
    expect(new Set(translucentMaterials.map((material) => material.map))).toHaveLength(1);
    expect(translucentMaterials[0]!.map).not.toBe(previousTexture);
    for (const part of SKIN_PARTS) {
      expect((skinMesh(first.visual, part, 'base').material as THREE.MeshBasicMaterial).transparent).toBe(false);
      expect((skinMesh(first.visual, part, 'outer').material as THREE.MeshBasicMaterial).transparent).toBe(true);
    }

    first.visual.setAppearance(createPlayerAppearance({ skinId: 'e3eb6f99ea1c3fe1', model: 'slim' }));
    expect(first.registry.referenceCount('0f15ad5e5c148f40')).toBe(0);
    for (const part of SKIN_PARTS) {
      expect((skinMesh(first.visual, part, 'outer').material as THREE.MeshBasicMaterial).transparent).toBe(false);
    }
    second.dispose();
    first.dispose();
  });

  it('keeps deterministic base/outer priorities and outer seam offsets for classic and slim rigs', () => {
    const fixture = createVisual();
    expect(SKIN_PART_RENDER_PRIORITY).toEqual({
      head: 0, body: 0, rightArm: 1, leftArm: 2, rightLeg: 1, leftLeg: 2,
    });
    for (const model of ['classic', 'slim'] as const) {
      fixture.visual.setAppearance(createPlayerAppearance({
        skinId: DEFAULT_PLAYER_APPEARANCE.skinId,
        model,
      }));
      for (const part of SKIN_PARTS) {
        const priority = SKIN_PART_RENDER_PRIORITY[part];
        const base = skinMesh(fixture.visual, part, 'base');
        const outer = skinMesh(fixture.visual, part, 'outer');
        const baseMaterial = base.material as THREE.MeshBasicMaterial;
        const outerMaterial = outer.material as THREE.MeshBasicMaterial;
        expect(base.renderOrder, `${model}:${part}:base`).toBe(SKIN_BASE_RENDER_ORDER + priority);
        expect(outer.renderOrder, `${model}:${part}:outer`).toBe(SKIN_OUTER_RENDER_ORDER + priority);
        expect(outer.renderOrder).toBeGreaterThan(base.renderOrder);
        expect(baseMaterial.polygonOffset, `${model}:${part}:base:polygonOffset`).toBe(false);
        expect(outerMaterial.polygonOffset, `${model}:${part}:outer:polygonOffset`).toBe(priority > 0);
        expect(outerMaterial.polygonOffsetFactor, `${model}:${part}:outer:factor`).toBe(-priority);
        expect(outerMaterial.polygonOffsetUnits, `${model}:${part}:outer:units`).toBe(-priority);
      }
    }
    fixture.dispose();
  });

  it('honors every independent outer-layer visibility toggle', () => {
    const fixture = createVisual();
    for (const disabledLayer of Object.values(PART_LAYER_KEY)) {
      fixture.visual.setAppearance(createPlayerAppearance({
        ...DEFAULT_PLAYER_APPEARANCE,
        layers: { ...ALL_PLAYER_SKIN_LAYERS, [disabledLayer]: false },
      }));
      for (const part of SKIN_PARTS) {
        expect(skinMesh(fixture.visual, part, 'base').visible, `${disabledLayer}:${part}:base`).toBe(true);
        expect(skinMesh(fixture.visual, part, 'outer').visible, `${disabledLayer}:${part}:outer`)
          .toBe(PART_LAYER_KEY[part] !== disabledLayer);
      }
    }
    fixture.dispose();
  });

  it('leaves the separate first-person arm material path stable across appearance changes', () => {
    const registry = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const renderer = new FirstPersonRenderer(items, {
      skinRegistry: registry,
      skinGeometries: geometries,
      appearance: DEFAULT_PLAYER_APPEARANCE,
    });
    const arm = renderer.root.getObjectByName('first-person:right-arm') as THREE.Mesh;
    const sleeve = renderer.root.getObjectByName('first-person:right-sleeve') as THREE.Mesh;
    const material = arm.material as THREE.MeshLambertMaterial;
    const previousMap = material.map;
    expect(sleeve.material).toBe(material);
    expect(material.transparent).toBe(true);
    expect(material.alphaTest).toBeGreaterThan(0);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    renderer.setAppearance(createPlayerAppearance({ skinId: '0f15ad5e5c148f40', model: 'slim' }));
    expect(arm.material).toBe(material);
    expect(sleeve.material).toBe(material);
    expect(material.map).not.toBe(previousMap);
    expect(registry.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(0);
    expect(registry.referenceCount('0f15ad5e5c148f40')).toBe(1);
    renderer.dispose();
    expect(registry.cacheSize).toBe(0);
    geometries.dispose();
    items.dispose();
    registry.dispose();
  });

  it('places feet at the root and keeps the canonical base model 1.8 blocks tall', () => {
    const registry = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(registry, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    for (const object of [visual.rig.head, visual.rig.body, visual.rig.rightArm, visual.rig.leftArm, visual.rig.rightLeg, visual.rig.leftLeg]) {
      for (const child of object.children) if (child.name.endsWith(':outer')) child.visible = false;
    }
    visual.root.updateMatrixWorld(true);
    const baseMeshes: THREE.Object3D[] = [];
    visual.root.traverse((object) => {
      if (object.name.endsWith(':base')) baseMeshes.push(object);
    });
    const bounds = baseMeshes.reduce((box, object) => box.union(new THREE.Box3().setFromObject(object)), new THREE.Box3());
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(1.8);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(0.8);
    visual.dispose();
    geometries.dispose();
    items.dispose();
    registry.dispose();
  });
});
