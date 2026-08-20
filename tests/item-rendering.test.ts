import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BLOCKS, getBlockDefinition } from '../src/blocks';
import {
  ITEMS,
  classifyItemForRendering,
  itemRenderProfile,
  itemVisualKind,
} from '../src/items';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../src/rendering/FirstPersonRenderer';
import { createGeneratedItemGeometry, GENERATED_ITEM_DEPTH } from '../src/rendering/GeneratedItemGeometry';
import {
  ItemVisualFactory,
  droppedVisualCopyCount,
} from '../src/rendering/ItemVisualFactory';
import { createTorchItemGeometry, TORCH_HEIGHT, TORCH_WIDTH } from '../src/rendering/specialBlockGeometry';

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
  it('classifies blocks, torches, generated items, handheld tools, bow and shield separately', () => {
    expect(classifyItemForRendering('stone')).toBe('block');
    expect(classifyItemForRendering('torch')).toBe('torch');
    expect(classifyItemForRendering('redstone_torch')).toBe('torch');
    expect(classifyItemForRendering('apple')).toBe('generated');
    expect(classifyItemForRendering('arrow')).toBe('generated');
    expect(classifyItemForRendering('coal')).toBe('generated');
    expect(classifyItemForRendering('iron_pickaxe')).toBe('handheld');
    expect(classifyItemForRendering('diamond_sword')).toBe('handheld');
    expect(classifyItemForRendering('bow')).toBe('bow');
    expect(classifyItemForRendering('shield')).toBe('shield');
  });

  it('keeps cube block items on the cube visual path and routes non-blocks away from it', () => {
    for (const item of ITEMS) {
      if (item.kind !== 'block') {
        expect(itemVisualKind(item), item.id).toBe('generated');
        continue;
      }
      const shape = getBlockDefinition(item.blockId).renderShape;
      expect(itemVisualKind(item), item.id).toBe(shape === 'torch' ? 'special-torch' : 'block-cube');
    }
    expect(itemVisualKind('stone')).toBe('block-cube');
    expect(itemVisualKind('oak_planks')).toBe('block-cube');
    expect(itemVisualKind('stone_button')).toBe('block-cube');
    expect(itemVisualKind('oak_door')).toBe('block-cube');
    expect(itemVisualKind('torch')).toBe('special-torch');
    expect(itemVisualKind('iron_pickaxe')).toBe('generated');
    expect(itemVisualKind('arrow')).toBe('generated');
  });

  it('yaws generated and handheld first-person poses enough to show extrusion thickness', () => {
    const generatedYaw = itemRenderProfile('arrow').transforms.firstPersonRightHand.rotation[1];
    const handheldYaw = itemRenderProfile('iron_pickaxe').transforms.firstPersonRightHand.rotation[1];
    const blockYaw = itemRenderProfile('stone').transforms.firstPersonRightHand.rotation[1];
    expect(generatedYaw).toBeLessThan(-0.7);
    expect(handheldYaw).toBeLessThan(-0.8);
    expect(Math.abs(handheldYaw)).toBeGreaterThan(Math.abs(blockYaw));
    expect(itemRenderProfile('torch').transforms.firstPersonRightHand.scale[1]).toBeGreaterThan(0.4);
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
    expect(stone.userData.visualKind).toBe('block-cube');
    expect(stoneMesh.geometry.getAttribute('position').count).toBe(24);
    expect((stoneMesh.material as THREE.MeshBasicMaterial).map).toBe(atlasTexture);
    const appleMesh = apple.children[0] as THREE.Mesh;
    expect(apple.userData.visualKind).toBe('generated');
    expect(Array.isArray(appleMesh.material)).toBe(false);
    const appleSurface = appleMesh.material as THREE.MeshBasicMaterial;
    expect(appleSurface.map).toBeInstanceOf(THREE.Texture);
    expect(factory.cacheStats).toEqual(firstStats);
    expect(secondStone.children[0]).not.toBe(stoneMesh);
    expect((secondStone.children[0] as THREE.Mesh).geometry).toBe(stoneMesh.geometry);
    expect((secondApple.children[0] as THREE.Mesh).geometry).toBe(appleMesh.geometry);

    factory.dispose();
    atlasTexture.dispose();
  });

  it('uses special torch cuboid geometry instead of a full block cube', () => {
    const atlasTexture = new THREE.Texture();
    const factory = new ItemVisualFactory({
      atlas: { texture: atlasTexture, tile: () => FULL_TILE },
    });
    const torch = factory.createItemModel('torch');
    const redstone = factory.createItemModel('redstone_torch');
    const reused = factory.createItemModel('torch');
    const torchMesh = torch.children[0] as THREE.Mesh;
    const box = torchMesh.geometry.boundingBox!;
    expect(torch.userData.visualKind).toBe('special-torch');
    expect(torchMesh.name).toBe('item-model:torch:torch');
    expect(torchMesh.geometry.userData.specialItem).toMatchObject({
      kind: 'torch',
      width: TORCH_WIDTH,
      height: TORCH_HEIGHT,
    });
    expect(box.max.x - box.min.x).toBeCloseTo(TORCH_WIDTH);
    expect(box.max.y - box.min.y).toBeCloseTo(TORCH_HEIGHT);
    expect(box.max.z - box.min.z).toBeCloseTo(TORCH_WIDTH);
    expect(box.max.y - box.min.y).toBeGreaterThan((box.max.x - box.min.x) * 3);
    expect((reused.children[0] as THREE.Mesh).geometry).toBe(torchMesh.geometry);
    expect((redstone.children[0] as THREE.Mesh).geometry).not.toBe(torchMesh.geometry);
    expect(redstone.userData.visualKind).toBe('special-torch');
    factory.dispose();
    atlasTexture.dispose();
  });

  it('gives tools, arrows and other non-block items extruded generated geometry', () => {
    const factory = new ItemVisualFactory();
    for (const itemId of ['iron_pickaxe', 'diamond_sword', 'arrow', 'stick', 'apple', 'bow']) {
      const model = factory.createItemModel(itemId);
      const mesh = model.children[0] as THREE.Mesh;
      const box = mesh.geometry.boundingBox!;
      expect(model.userData.visualKind, itemId).toBe('generated');
      expect(mesh.geometry.userData.generatedItem.depth, itemId).toBe(GENERATED_ITEM_DEPTH);
      expect(box.max.z - box.min.z, itemId).toBeCloseTo(GENERATED_ITEM_DEPTH);
      expect(box.max.x - box.min.x, itemId).toBeLessThan(1.01);
      expect(box.max.y - box.min.y, itemId).toBeLessThan(1.01);
    }
    const stoneBox = (factory.createItemModel('stone').children[0] as THREE.Mesh).geometry.boundingBox!;
    expect(stoneBox.max.x - stoneBox.min.x).toBeCloseTo(1);
    expect(stoneBox.max.z - stoneBox.min.z).toBeCloseTo(1);
    factory.dispose();
  });

  it('extrudes the opaque pixel silhouette instead of a rectangular item box', () => {
    const alpha = new Uint8Array([
      0, 255, 0,
      255, 255, 255,
      0, 255, 0,
    ]);
    const geometry = createGeneratedItemGeometry({ width: 3, height: 3, alpha });
    const bounds = geometry.boundingBox!;
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(GENERATED_ITEM_DEPTH);
    expect(geometry.userData.generatedItem).toMatchObject({
      opaquePixels: 5,
      frontSpans: 3,
      depth: GENERATED_ITEM_DEPTH,
    });
    expect(geometry.userData.generatedItem.sideSpans).toBeGreaterThan(4);
    expect(geometry.userData.generatedItem.frontSpans).toBeGreaterThan(1);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(24);
    geometry.dispose();
  });

  it('keeps torch item bounds on the world stick size', () => {
    const geometry = createTorchItemGeometry();
    const box = geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(TORCH_WIDTH);
    expect(box.max.y - box.min.y).toBeCloseTo(TORCH_HEIGHT);
    expect(box.max.z - box.min.z).toBeCloseTo(TORCH_WIDTH);
    expect(geometry.getAttribute('position').count).toBe(24);
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
    viewmodel.setHeldItems('torch');
    expect(viewmodel.heldCategory).toBe('torch');
    expect(viewmodel.scene.getObjectByName('item-model:torch:torch')).toBeDefined();

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
