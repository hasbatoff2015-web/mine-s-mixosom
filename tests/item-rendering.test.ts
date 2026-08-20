import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BLOCKS, getBlockDefinition } from '../src/blocks';
import {
  ITEMS,
  classifyItemForRendering,
  itemRenderProfile,
  itemVisualFamily,
} from '../src/items';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../src/rendering/FirstPersonRenderer';
import { familyTriangleCount } from '../src/rendering/ItemFamilyGeometry';
import {
  ItemVisualFactory,
  droppedVisualCopyCount,
} from '../src/rendering/ItemVisualFactory';
import {
  DOOR_ITEM_SIZE,
  TORCH_HEIGHT,
  TORCH_WIDTH,
  createTorchItemGeometry,
} from '../src/rendering/specialBlockGeometry';

const ITEM_TEXTURES = import.meta.glob('../public/textures/item/*.png');
const BLOCK_TEXTURES = import.meta.glob('../public/textures/block/*.png');
const FULL_TILE = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });

const EXPECTED_FAMILY: Readonly<Record<string, string>> = {
  torch: 'torch',
  redstone_torch: 'torch',
  oak_door: 'door',
  lever: 'lever',
  stone_button: 'button',
  oak_pressure_plate: 'pressure-plate',
  wooden_sword: 'sword',
  stone_sword: 'sword',
  iron_sword: 'sword',
  diamond_sword: 'sword',
  wooden_pickaxe: 'pickaxe',
  stone_pickaxe: 'pickaxe',
  iron_pickaxe: 'pickaxe',
  diamond_pickaxe: 'pickaxe',
  wooden_axe: 'axe',
  stone_axe: 'axe',
  iron_axe: 'axe',
  diamond_axe: 'axe',
  wooden_shovel: 'shovel',
  stone_shovel: 'shovel',
  iron_shovel: 'shovel',
  diamond_shovel: 'shovel',
  arrow: 'arrow',
  bow: 'bow',
  shield: 'shield',
  stick: 'stick',
  iron_ingot: 'ingot',
  gold_ingot: 'ingot',
  brick: 'brick',
  diamond: 'gem',
  coal: 'chunk',
  charcoal: 'chunk',
  flint: 'flint',
  clay_ball: 'clay-ball',
  gunpowder: 'pile',
  redstone_dust: 'pile',
  string: 'string',
  feather: 'feather',
  leather: 'leather',
  book: 'book',
  apple: 'food-round',
  bread: 'food-loaf',
  beef: 'food-cut',
  cooked_beef: 'food-cut',
  porkchop: 'food-cut',
  cooked_porkchop: 'food-cut',
  chicken: 'food-cut',
  cooked_chicken: 'food-cut',
  leather_helmet: 'armor-helmet',
  iron_helmet: 'armor-helmet',
  gold_helmet: 'armor-helmet',
  diamond_helmet: 'armor-helmet',
  leather_chestplate: 'armor-chest',
  iron_chestplate: 'armor-chest',
  gold_chestplate: 'armor-chest',
  diamond_chestplate: 'armor-chest',
  leather_leggings: 'armor-legs',
  iron_leggings: 'armor-legs',
  gold_leggings: 'armor-legs',
  diamond_leggings: 'armor-legs',
  leather_boots: 'armor-boots',
  iron_boots: 'armor-boots',
  gold_boots: 'armor-boots',
  diamond_boots: 'armor-boots',
};

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

function firstMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  root.traverse((child) => {
    if (!found && child instanceof THREE.Mesh) found = child;
  });
  if (!found) throw new Error(`No mesh in ${root.name}`);
  return found;
}

function modelTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const index = child.geometry.getIndex();
    triangles += index ? index.count / 3 : child.geometry.getAttribute('position').count / 3;
  });
  return triangles;
}

function modelSize(root: THREE.Object3D): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(root);
  return box.getSize(new THREE.Vector3());
}

describe('item visual families', () => {
  it('routes every registry item to a family and never to pixel extrusion', () => {
    expect(ITEMS).toHaveLength(123);
    const classified = ITEMS.map((item) => itemVisualFamily(item));
    expect(classified).toHaveLength(123);
    expect(classified.includes('generic-fallback')).toBe(false);
    for (const item of ITEMS) {
      const family = itemVisualFamily(item);
      if (item.kind === 'block') {
        const shape = getBlockDefinition(item.blockId).renderShape;
        if (shape === 'cube') expect(family, item.id).toBe('block-cube');
        else expect(family, item.id).toBe(EXPECTED_FAMILY[item.id]);
      } else {
        expect(family, item.id).toBe(EXPECTED_FAMILY[item.id]);
      }
    }
  });

  it('keeps pose categories for block, torch, tools, bow and shield', () => {
    expect(classifyItemForRendering('stone')).toBe('block');
    expect(classifyItemForRendering('torch')).toBe('torch');
    expect(classifyItemForRendering('iron_pickaxe')).toBe('handheld');
    expect(classifyItemForRendering('diamond_sword')).toBe('handheld');
    expect(classifyItemForRendering('bow')).toBe('bow');
    expect(classifyItemForRendering('shield')).toBe('shield');
    expect(classifyItemForRendering('apple')).toBe('generated');
    expect(classifyItemForRendering('arrow')).toBe('generated');
  });

  it('provides independent first-person, ground and GUI transform contexts', () => {
    for (const item of ['stone', 'apple', 'iron_pickaxe', 'bow', 'shield', 'arrow']) {
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
  it('builds cached atlas cubes for blocks and palette family meshes for items', () => {
    const atlasTexture = new THREE.Texture();
    const factory = new ItemVisualFactory({
      atlas: { texture: atlasTexture, tile: () => FULL_TILE },
    });
    const stone = factory.createItemModel('stone');
    const apple = factory.createItemModel('apple');
    const firstStats = factory.cacheStats;
    const secondStone = factory.createItemModel('stone');
    const secondApple = factory.createItemModel('apple');

    const stoneMesh = firstMesh(stone);
    expect(stone.userData.visualFamily).toBe('block-cube');
    expect(stoneMesh.geometry.getAttribute('position').count).toBe(24);
    expect((stoneMesh.material as THREE.MeshBasicMaterial).map).toBe(atlasTexture);
    expect(apple.userData.visualFamily).toBe('food-round');
    expect(apple.userData.visualKind).toBe('food-round');
    expect(firstMesh(apple).geometry.userData.generatedItem).toBeUndefined();
    expect(factory.cacheStats.blockGeometries).toBe(firstStats.blockGeometries);
    expect(factory.cacheStats.materials).toBe(firstStats.materials);
    expect(firstMesh(secondStone).geometry).toBe(stoneMesh.geometry);
    expect(firstMesh(secondApple).geometry).toBe(firstMesh(apple).geometry);

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
    const torchMesh = firstMesh(torch);
    const box = torchMesh.geometry.boundingBox!;
    expect(torch.userData.visualFamily).toBe('torch');
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
    expect(firstMesh(reused).geometry).toBe(torchMesh.geometry);
    expect(firstMesh(redstone).geometry).not.toBe(torchMesh.geometry);
    expect(redstone.userData.visualFamily).toBe('torch');
    factory.dispose();
    atlasTexture.dispose();
  });

  it('gives door, lever, button and plate their own non-cube bounds', () => {
    const factory = new ItemVisualFactory({
      atlas: { texture: new THREE.Texture(), tile: () => FULL_TILE },
    });
    const door = factory.createItemModel('oak_door');
    const lever = factory.createItemModel('lever');
    const button = factory.createItemModel('stone_button');
    const plate = factory.createItemModel('oak_pressure_plate');
    expect(door.userData.visualFamily).toBe('door');
    expect(lever.userData.visualFamily).toBe('lever');
    expect(button.userData.visualFamily).toBe('button');
    expect(plate.userData.visualFamily).toBe('pressure-plate');
    const doorSize = modelSize(door);
    expect(doorSize.z).toBeCloseTo(DOOR_ITEM_SIZE[2], 5);
    expect(doorSize.x).toBeLessThan(0.99);
    expect(modelSize(lever).y).toBeGreaterThan(modelSize(lever).x);
    expect(modelSize(button).y).toBeLessThan(0.3);
    expect(modelSize(plate).y).toBeLessThan(0.15);
    factory.dispose();
  });

  it('builds low-poly family meshes for tools, arrow, resources and food', () => {
    const factory = new ItemVisualFactory();
    const samples = [
      ['iron_pickaxe', 'pickaxe'],
      ['diamond_sword', 'sword'],
      ['iron_axe', 'axe'],
      ['iron_shovel', 'shovel'],
      ['arrow', 'arrow'],
      ['stick', 'stick'],
      ['apple', 'food-round'],
      ['coal', 'chunk'],
      ['diamond', 'gem'],
      ['iron_ingot', 'ingot'],
      ['book', 'book'],
      ['iron_helmet', 'armor-helmet'],
      ['bow', 'bow'],
      ['shield', 'shield'],
    ] as const;
    for (const [itemId, family] of samples) {
      const model = factory.createItemModel(itemId);
      const size = modelSize(model);
      expect(model.userData.visualFamily, itemId).toBe(family);
      expect(firstMesh(model).geometry.userData.generatedItem, itemId).toBeUndefined();
      expect(size.x, itemId).toBeLessThan(1);
      expect(size.y, itemId).toBeLessThan(1.2);
      expect(size.z, itemId).toBeLessThan(1);
      expect(size.x * size.y * size.z, itemId).toBeLessThan(0.95);
      expect(modelTriangles(model), itemId).toBeGreaterThanOrEqual(8);
      expect(modelTriangles(model), itemId).toBeLessThan(80);
    }
    const stoneSize = modelSize(factory.createItemModel('stone'));
    expect(stoneSize.x).toBeCloseTo(1);
    expect(stoneSize.z).toBeCloseTo(1);
    factory.dispose();
  });

  it('reuses one geometry per family across material variants', () => {
    const factory = new ItemVisualFactory();
    const wood = firstMesh(factory.createItemModel('wooden_pickaxe')).geometry;
    const iron = firstMesh(factory.createItemModel('iron_pickaxe')).geometry;
    const diamond = firstMesh(factory.createItemModel('diamond_pickaxe')).geometry;
    expect(iron).toBe(wood);
    expect(diamond).toBe(wood);
    expect(familyTriangleCount('pickaxe')).toBeLessThan(60);
    expect(familyTriangleCount('sword')).toBeLessThan(60);
    expect(familyTriangleCount('gem')).toBe(8);
    factory.dispose();
  });

  it('instantiates every registry item without extrusion or generic-fallback', () => {
    const factory = new ItemVisualFactory({
      atlas: { texture: new THREE.Texture(), tile: () => FULL_TILE },
    });
    for (const item of ITEMS) {
      const model = factory.createItemModel(item.id);
      expect(model.userData.visualFamily, item.id).not.toBe('generic-fallback');
      expect(model.children.length, item.id).toBeGreaterThan(0);
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          expect(child.geometry.userData.generatedItem, item.id).toBeUndefined();
        }
      });
      const triangles = modelTriangles(model);
      expect(triangles, item.id).toBeGreaterThanOrEqual(8);
      expect(triangles, item.id).toBeLessThan(80);
      if (model.userData.visualFamily !== 'block-cube') {
        expect(modelSize(model).x * modelSize(model).y * modelSize(model).z, item.id).toBeLessThan(0.95);
      }
    }
    factory.dispose();
  });

  it('reserves generic-fallback for unknown future item ids', () => {
    expect(itemVisualFamily({
      id: 'future_widget',
      name: 'Future Widget',
      kind: 'resource',
      maxStack: 64,
      texture: 'item/future_widget',
    })).toBe('generic-fallback');
    expect(familyTriangleCount('generic-fallback')).toBe(12);
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
    const string = bow.getObjectByName('bow:string')!;
    const restZ = string.position.z;
    viewmodel.update(0.016, frameState({ bowCharge: 1 }));
    expect(bow.rotation.y).toBeGreaterThan(baseBowY + 0.4);
    expect(string.position.z).toBeGreaterThan(restZ);

    viewmodel.dispose();
    factory.dispose();
  });
});
