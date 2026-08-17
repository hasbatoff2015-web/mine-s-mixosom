import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BLOCKS, getBlockDefinition } from '../src/blocks';
import {
  ITEMS,
  classifyItemForRendering,
  itemRenderProfile,
} from '../src/items';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../src/rendering/FirstPersonRenderer';
import { createGeneratedItemGeometry } from '../src/rendering/GeneratedItemGeometry';
import {
  ItemVisualFactory,
  droppedVisualCopyCount,
} from '../src/rendering/ItemVisualFactory';

const ITEM_TEXTURES = import.meta.glob('../public/textures/item/*.png');
const BLOCK_TEXTURES = import.meta.glob('../public/textures/block/*.png');
const FULL_TILE = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });

function frameState(overrides: Partial<FirstPersonFrameState> = {}): FirstPersonFrameState {
  return {
    visible: true,
    movementSpeed: 0,
    onGround: true,
    sprinting: false,
    mining: false,
    foodUseProgress: 0,
    bowCharge: 0,
    shieldRaised: false,
    ...overrides,
  };
}

describe('item render profiles and assets', () => {
  it('classifies blocks, generated items, handheld tools, bow and shield separately', () => {
    expect(classifyItemForRendering('stone')).toBe('block');
    expect(classifyItemForRendering('apple')).toBe('generated');
    expect(classifyItemForRendering('coal')).toBe('generated');
    expect(classifyItemForRendering('iron_pickaxe')).toBe('handheld');
    expect(classifyItemForRendering('diamond_sword')).toBe('handheld');
    expect(classifyItemForRendering('bow')).toBe('bow');
    expect(classifyItemForRendering('shield')).toBe('shield');
  });

  it('provides independent first-person, ground and GUI transform contexts', () => {
    for (const item of ['stone', 'apple', 'iron_pickaxe', 'bow', 'shield']) {
      const transforms = itemRenderProfile(item).transforms;
      expect(transforms.firstPersonRightHand).not.toBe(transforms.ground);
      expect(transforms.ground).not.toBe(transforms.gui);
      expect(transforms.firstPersonRightHand.scale.every((value) => value > 0)).toBe(true);
    }
  });

  it('maps every registered item and every block face texture to an imported PNG', () => {
    const itemPaths = Object.keys(ITEM_TEXTURES);
    const blockPaths = Object.keys(BLOCK_TEXTURES);
    for (const item of ITEMS) {
      if (item.kind !== 'block') {
        expect(itemPaths.some((path) => path.endsWith(`/${item.texture}.png`)), item.id).toBe(true);
      }
    }
    for (const block of BLOCKS) {
      for (const texture of Object.values(getBlockDefinition(block.id).textures)) {
        if (!texture || texture === 'block/air') continue;
        expect(blockPaths.some((path) => path.endsWith(`/${texture}.png`)), `${block.key}:${texture}`).toBe(true);
      }
    }
  });
});

describe('ItemVisualFactory', () => {
  it('builds cached atlas cubes for blocks and real textured thin models for items', () => {
    const atlasTexture = new THREE.Texture();
    const factory = new ItemVisualFactory({
      atlas: { texture: atlasTexture, tile: () => FULL_TILE },
    });
    const stone = factory.createItemModel('stone');
    const apple = factory.createItemModel('apple');
    const firstStats = factory.cacheStats;
    const secondStone = factory.createItemModel('stone');
    const secondApple = factory.createItemModel('apple');

    const stoneMesh = stone.children[0] as THREE.Mesh;
    expect(stoneMesh.geometry.getAttribute('position').count).toBe(24);
    expect((stoneMesh.material as THREE.MeshLambertMaterial).map).toBe(atlasTexture);
    const appleMesh = apple.children[0] as THREE.Mesh;
    expect(Array.isArray(appleMesh.material)).toBe(false);
    const appleSurface = appleMesh.material as THREE.MeshLambertMaterial;
    expect(appleSurface.map).toBeInstanceOf(THREE.Texture);
    expect(factory.cacheStats).toEqual(firstStats);
    expect(secondStone.children[0]).not.toBe(stoneMesh);
    expect((secondStone.children[0] as THREE.Mesh).geometry).toBe(stoneMesh.geometry);
    expect((secondApple.children[0] as THREE.Mesh).geometry).toBe(appleMesh.geometry);

    factory.dispose();
    atlasTexture.dispose();
  });

  it('extrudes the opaque pixel silhouette instead of a rectangular item box', () => {
    const alpha = new Uint8Array([
      0, 255, 0,
      255, 255, 255,
      0, 255, 0,
    ]);
    const geometry = createGeneratedItemGeometry({ width: 3, height: 3, alpha });
    const bounds = geometry.boundingBox!;
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.08);
    expect(geometry.userData.generatedItem).toMatchObject({ opaquePixels: 5 });
    expect(geometry.userData.generatedItem.sideSpans).toBeGreaterThan(4);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(24);
    geometry.dispose();
  });

  it('uses bounded vanilla-like visual copies for dropped stacks', () => {
    expect([1, 2, 16, 17, 32, 33, 64].map(droppedVisualCopyCount)).toEqual([1, 2, 2, 3, 3, 4, 4]);
    const factory = new ItemVisualFactory();
    const visual = factory.createDroppedItemVisual('apple', 33);
    expect(visual.userData.visualCopies).toBe(4);
    expect(visual.children).toHaveLength(4);
    factory.updateDroppedItemVisual(visual, 'apple', 1);
    expect(visual.userData.visualCopies).toBe(1);
    expect(visual.children).toHaveLength(1);
    factory.dispose();
  });
});

describe('FirstPersonRenderer', () => {
  it('keeps an arm for empty hand and swaps category-specific held models', () => {
    const factory = new ItemVisualFactory();
    const viewmodel = new FirstPersonRenderer(factory);
    viewmodel.setHeldItems();
    viewmodel.update(0.016, frameState());
    const arm = viewmodel.scene.getObjectByName('first-person:right-arm')!;
    expect(arm).toBeDefined();
    expect(arm.parent?.visible).toBe(true);
    expect(viewmodel.heldItemId).toBeUndefined();

    viewmodel.setHeldItems('apple');
    viewmodel.update(0.016, frameState());
    expect(viewmodel.heldCategory).toBe('generated');
    expect(viewmodel.scene.getObjectByName('item-model:apple')).toBeDefined();
    expect(arm.parent?.visible).toBe(false);
    viewmodel.setHeldItems('stone');
    expect(viewmodel.heldCategory).toBe('block');
    viewmodel.setHeldItems('iron_pickaxe');
    expect(viewmodel.heldCategory).toBe('handheld');

    viewmodel.dispose();
    factory.dispose();
  });

  it('recomputes swing, eat and bow poses from the base transform', () => {
    const factory = new ItemVisualFactory();
    const viewmodel = new FirstPersonRenderer(factory);
    viewmodel.setHeldItems('apple');
    viewmodel.update(0.1, frameState());
    const apple = viewmodel.scene.getObjectByName('item-model:apple')!;
    const baseAppleY = apple.position.y;
    viewmodel.update(0.016, frameState({ foodUseProgress: 0.5 }));
    expect(apple.position.y).toBeGreaterThan(baseAppleY);
    viewmodel.swing();
    viewmodel.update(0.12, frameState());
    expect(Math.abs(viewmodel.root.rotation.y)).toBeGreaterThan(0.01);

    viewmodel.setHeldItems('bow');
    viewmodel.update(0.016, frameState());
    const bow = viewmodel.scene.getObjectByName('item-model:bow')!;
    const baseBowY = bow.rotation.y;
    viewmodel.update(0.016, frameState({ bowCharge: 1 }));
    expect(bow.rotation.y).toBeGreaterThan(baseBowY + 0.4);

    viewmodel.dispose();
    factory.dispose();
  });
});
