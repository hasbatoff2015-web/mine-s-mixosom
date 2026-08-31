import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ALL_PLAYER_SKIN_LAYERS,
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import {
  BUILTIN_MINECRAFT_SKINS,
  MinecraftSkinRegistry,
  validateMinecraftSkinDimensions,
} from '../src/player/appearance/MinecraftSkin';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import {
  PLAYER_MODEL_PIXEL,
  PlayerSkinGeometryCache,
  playerSkinPartDefinition,
  playerSkinPartSize,
  playerSkinUvRects,
} from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';

const PLAYER_SKIN_ASSETS = import.meta.glob('../public/textures/**/*.png');

describe('Minecraft-compatible player skins', () => {
  it('accepts modern 64x64 and rejects legacy or arbitrary dimensions', () => {
    expect(validateMinecraftSkinDimensions(64, 64)).toEqual({ ok: true });
    expect(validateMinecraftSkinDimensions(64, 32)).toMatchObject({ ok: false });
    expect(validateMinecraftSkinDimensions(128, 128)).toMatchObject({ ok: false });
  });

  it('ships every unique archive skin and the authored QA sheet under its registry path', () => {
    expect(BUILTIN_MINECRAFT_SKINS).toHaveLength(46);
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
