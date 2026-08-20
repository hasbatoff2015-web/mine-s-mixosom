import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BLOCKS, getBlockDefinition } from '../src/blocks';
import {
  ITEMS,
  FIRST_PERSON_SPRITE_POSE,
  bowPullingTexturePath,
  classifyItemForRendering,
  itemRenderProfile,
  itemUsesGeneratedHeldGeometry,
} from '../src/items';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../src/rendering/FirstPersonRenderer';
import {
  VANILLA_GENERATED_DEPTH,
  collectGeneratedItemSpans,
  createGeneratedItemGeometry,
  generatedItemInfo,
  isGeneratedTransparentAlpha,
} from '../src/rendering/GeneratedItemGeometry';
import {
  ItemVisualFactory,
  droppedVisualCopyCount,
} from '../src/rendering/ItemVisualFactory';
import {
  formatHeldItemQaQuery,
  parseHeldItemQaOverride,
  resolveHeldItemTransform,
} from '../src/rendering/heldItemQa';

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

function opaqueRect(size: number): { width: number; height: number; alpha: Uint8Array } {
  return { width: size, height: size, alpha: new Uint8Array(size * size).fill(255) };
}

function plusMask(size: number): { width: number; height: number; alpha: Uint8Array } {
  const alpha = new Uint8Array(size * size);
  const mid = Math.floor(size / 2);
  for (let i = 0; i < size; i += 1) {
    alpha[mid * size + i] = 255;
    alpha[i * size + mid] = 255;
  }
  return { width: size, height: size, alpha };
}

function diagonalMask(size: number): { width: number; height: number; alpha: Uint8Array } {
  const alpha = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const x = y;
    if (x < size) alpha[y * size + x] = 255;
  }
  return { width: size, height: size, alpha };
}

function fullSpriteQuads(geometry: THREE.BufferGeometry): { front: number; back: number } {
  const position = geometry.getAttribute('position');
  let front = 0;
  let back = 0;
  for (let vertex = 0; vertex < position.count; vertex += 4) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let corner = 0; corner < 4; corner += 1) {
      const index = vertex + corner;
      minX = Math.min(minX, position.getX(index));
      maxX = Math.max(maxX, position.getX(index));
      minY = Math.min(minY, position.getY(index));
      maxY = Math.max(maxY, position.getY(index));
      minZ = Math.min(minZ, position.getZ(index));
      maxZ = Math.max(maxZ, position.getZ(index));
    }
    const coversSprite = minX === -0.5 && maxX === 0.5 && minY === -0.5 && maxY === 0.5;
    const flatZ = maxZ - minZ < 1e-8;
    if (!coversSprite || !flatZ) continue;
    if (minZ > 0) front += 1;
    if (maxZ < 0) back += 1;
  }
  return { front, back };
}

describe('item render profiles and assets', () => {
  it('classifies representative Phase 1 items onto generated, handheld, block and bow paths', () => {
    expect(classifyItemForRendering('diamond_sword')).toBe('handheld');
    expect(classifyItemForRendering('iron_pickaxe')).toBe('handheld');
    expect(classifyItemForRendering('stick')).toBe('handheld');
    expect(classifyItemForRendering('coal')).toBe('generated');
    expect(classifyItemForRendering('apple')).toBe('generated');
    expect(classifyItemForRendering('arrow')).toBe('generated');
    expect(classifyItemForRendering('torch')).toBe('generated');
    expect(classifyItemForRendering('stone')).toBe('block');
    expect(classifyItemForRendering('bow')).toBe('bow');
    expect(itemUsesGeneratedHeldGeometry('torch')).toBe(true);
    expect(itemUsesGeneratedHeldGeometry('redstone_torch')).toBe(true);
    expect(itemUsesGeneratedHeldGeometry('stone')).toBe(false);
    expect(itemUsesGeneratedHeldGeometry('arrow')).toBe(true);
    expect(itemUsesGeneratedHeldGeometry('bow')).toBe(true);
  });

  it('uses one first-person pose for generated, handheld and bow', () => {
    const generated = itemRenderProfile('coal').transforms.firstPersonRightHand;
    const handheld = itemRenderProfile('diamond_sword').transforms.firstPersonRightHand;
    const pickaxe = itemRenderProfile('iron_pickaxe').transforms.firstPersonRightHand;
    const stick = itemRenderProfile('stick').transforms.firstPersonRightHand;
    const bow = itemRenderProfile('bow').transforms.firstPersonRightHand;
    expect(handheld).toEqual(generated);
    expect(pickaxe).toEqual(generated);
    expect(stick).toEqual(generated);
    expect(bow).toEqual(generated);
    expect(itemRenderProfile('stone').transforms.firstPersonRightHand).not.toEqual(generated);
    expect(generated.position).toEqual(FIRST_PERSON_SPRITE_POSE.position);
    expect(generated.scale[0]).toBe(FIRST_PERSON_SPRITE_POSE.scale);
    expect(generated.rotation[0]).toBeCloseTo(0);
    expect(generated.rotation[1]).toBeCloseTo(0);
    expect(generated.rotation[2]).toBeCloseTo(FIRST_PERSON_SPRITE_POSE.rotationDeg[2] * Math.PI / 180);
  });

  it('provides independent first-person, ground and GUI transform contexts', () => {
    for (const item of ['stone', 'apple', 'iron_pickaxe', 'bow', 'shield']) {
      const transforms = itemRenderProfile(item).transforms;
      expect(transforms.firstPersonRightHand).not.toBe(transforms.ground);
      expect(transforms.ground).not.toBe(transforms.gui);
      expect(transforms.firstPersonRightHand.scale.every((value) => value > 0)).toBe(true);
    }
  });

  it('maps vanilla bow pull thresholds to pulling_0/1/2 textures', () => {
    expect(bowPullingTexturePath(0)).toBe('item/bow');
    expect(bowPullingTexturePath(0.01)).toBe('item/bow_pulling_0');
    expect(bowPullingTexturePath(0.64)).toBe('item/bow_pulling_0');
    expect(bowPullingTexturePath(0.65)).toBe('item/bow_pulling_1');
    expect(bowPullingTexturePath(0.89)).toBe('item/bow_pulling_1');
    expect(bowPullingTexturePath(0.9)).toBe('item/bow_pulling_2');
    expect(bowPullingTexturePath(1)).toBe('item/bow_pulling_2');
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

describe('GeneratedItemGeometry', () => {
  it('builds one full-sprite front quad and one mirrored back quad', () => {
    const geometry = createGeneratedItemGeometry(plusMask(8));
    const info = generatedItemInfo(geometry);
    expect(info.frontQuads).toBe(1);
    expect(info.backQuads).toBe(1);
    expect(fullSpriteQuads(geometry)).toEqual({ front: 1, back: 1 });
    expect(info.depth).toBeCloseTo(VANILLA_GENERATED_DEPTH);
    expect(geometry.boundingBox!.max.z - geometry.boundingBox!.min.z).toBeCloseTo(1 / 16);
    geometry.dispose();
  });

  it('does not emit front row-span faces', () => {
    const alpha = new Uint8Array([
      255, 255, 255, 0,
      255, 0, 255, 0,
      255, 255, 255, 0,
      0, 0, 0, 0,
    ]);
    const geometry = createGeneratedItemGeometry({ width: 4, height: 4, alpha });
    expect(fullSpriteQuads(geometry)).toEqual({ front: 1, back: 1 });
    expect(generatedItemInfo(geometry).frontQuads).toBe(1);
    geometry.dispose();
  });

  it('treats only alpha 0 as transparent and merges neighboring boundary spans', () => {
    expect(isGeneratedTransparentAlpha(0)).toBe(true);
    expect(isGeneratedTransparentAlpha(1)).toBe(false);
    expect(isGeneratedTransparentAlpha(7)).toBe(false);
    expect(isGeneratedTransparentAlpha(255)).toBe(false);

    const spans = collectGeneratedItemSpans({
      width: 3,
      height: 2,
      alpha: new Uint8Array([
        1, 255, 7,
        0, 0, 0,
      ]),
    });
    const up = spans.filter((span) => span.facing === 'up');
    const down = spans.filter((span) => span.facing === 'down');
    expect(up).toEqual([expect.objectContaining({ min: 0, max: 2, anchor: 0 })]);
    expect(down).toEqual([expect.objectContaining({ min: 0, max: 2, anchor: 0 })]);
    expect(spans.some((span) => span.facing === 'left' && span.anchor === 0)).toBe(true);
    expect(spans.some((span) => span.facing === 'right' && span.anchor === 2)).toBe(true);
  });

  it('keeps 32×32 geometry in the same 16×16 model size as 16×16', () => {
    const small = createGeneratedItemGeometry(opaqueRect(16));
    const large = createGeneratedItemGeometry(opaqueRect(32));
    const smallBox = small.boundingBox!;
    const largeBox = large.boundingBox!;
    expect(largeBox.max.x - largeBox.min.x).toBeCloseTo(smallBox.max.x - smallBox.min.x);
    expect(largeBox.max.y - largeBox.min.y).toBeCloseTo(smallBox.max.y - smallBox.min.y);
    expect(largeBox.max.x - largeBox.min.x).toBeCloseTo(1);
    expect(largeBox.max.z - largeBox.min.z).toBeCloseTo(VANILLA_GENERATED_DEPTH);
    expect(generatedItemInfo(large).sideSpans).toBe(generatedItemInfo(small).sideSpans);
    expect(generatedItemInfo(large).frontQuads).toBe(1);

    const detailed = createGeneratedItemGeometry(diagonalMask(32));
    const coarse = createGeneratedItemGeometry(diagonalMask(16));
    expect(detailed.boundingBox!.max.x - detailed.boundingBox!.min.x).toBeCloseTo(
      coarse.boundingBox!.max.x - coarse.boundingBox!.min.x,
    );
    expect(generatedItemInfo(detailed).sideSpans).toBeGreaterThan(generatedItemInfo(coarse).sideSpans);
    small.dispose();
    large.dispose();
    detailed.dispose();
    coarse.dispose();
  });

  it('uses 32×32 collapsed UV strips from the ItemModelGenerator (size-1) formula', () => {
    const topLeft = new Uint8Array(32 * 32);
    topLeft[0] = 255;
    const topGeometry = createGeneratedItemGeometry({ width: 32, height: 32, alpha: topLeft });
    const topUv = topGeometry.getAttribute('uv');
    expect(topUv.getY(8)).toBeCloseTo(1);
    expect(topUv.getX(16)).toBeCloseTo(0);
    topGeometry.dispose();

    const bottomRight = new Uint8Array(32 * 32);
    bottomRight[31 * 32 + 31] = 255;
    const bottomGeometry = createGeneratedItemGeometry({ width: 32, height: 32, alpha: bottomRight });
    const bottomUv = bottomGeometry.getAttribute('uv');
    expect(bottomUv.getY(12)).toBeCloseTo(0);
    expect(bottomUv.getX(20)).toBeCloseTo(1);
    bottomGeometry.dispose();
  });
});

describe('ItemVisualFactory', () => {
  it('builds cached atlas cubes for blocks and generated geometry for items', () => {
    const atlasTexture = new THREE.Texture();
    const factory = new ItemVisualFactory({
      atlas: { texture: atlasTexture, tile: () => FULL_TILE },
    });
    const stone = factory.createItemModel('stone');
    const apple = factory.createItemModel('apple');
    const torch = factory.createItemModel('torch');
    const arrow = factory.createItemModel('arrow');
    const firstStats = factory.cacheStats;
    const secondStone = factory.createItemModel('stone');
    const secondApple = factory.createItemModel('apple');
    const secondTorch = factory.createItemModel('torch');

    const stoneMesh = stone.children[0] as THREE.Mesh;
    expect(stoneMesh.geometry.getAttribute('position').count).toBe(24);
    expect(stoneMesh.geometry.userData.generatedItem).toBeUndefined();
    expect((stoneMesh.material as THREE.MeshBasicMaterial).map).toBe(atlasTexture);
    expect(stoneMesh.name).toContain(':block');

    const appleMesh = apple.children[0] as THREE.Mesh;
    expect(appleMesh.name).toContain(':generated');
    expect(generatedItemInfo(appleMesh.geometry).frontQuads).toBe(1);
    expect(Array.isArray(appleMesh.material)).toBe(false);
    expect((appleMesh.material as THREE.MeshBasicMaterial).map).toBeInstanceOf(THREE.Texture);

    const torchMesh = torch.children[0] as THREE.Mesh;
    expect(torchMesh.name).toContain(':generated');
    expect(torchMesh.geometry.userData.generatedItem).toBeDefined();
    expect((arrow.children[0] as THREE.Mesh).name).toContain(':generated');

    expect(factory.cacheStats).toEqual(firstStats);
    expect(secondStone.children[0]).not.toBe(stoneMesh);
    expect((secondStone.children[0] as THREE.Mesh).geometry).toBe(stoneMesh.geometry);
    expect((secondApple.children[0] as THREE.Mesh).geometry).toBe(appleMesh.geometry);
    expect((secondTorch.children[0] as THREE.Mesh).geometry).toBe(torchMesh.geometry);

    factory.dispose();
    atlasTexture.dispose();
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
    viewmodel.setHeldItems('stick');
    expect(viewmodel.heldCategory).toBe('handheld');
    viewmodel.setHeldItems('torch');
    expect(viewmodel.heldCategory).toBe('generated');

    viewmodel.dispose();
    factory.dispose();
  });

  it('recomputes eat/swing from the shared pose and swaps bow textures at vanilla pull stages', () => {
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
    expect(bow.userData.texturePath).toBe('item/bow');
    const baseRotationY = bow.rotation.y;
    viewmodel.update(0.016, frameState({ bowCharge: 0.5 }));
    expect(bow.userData.texturePath).toBe('item/bow_pulling_0');
    expect(bow.rotation.y).toBeCloseTo(baseRotationY);
    viewmodel.update(0.016, frameState({ bowCharge: 0.65 }));
    expect(bow.userData.texturePath).toBe('item/bow_pulling_1');
    viewmodel.update(0.016, frameState({ bowCharge: 0.9 }));
    expect(bow.userData.texturePath).toBe('item/bow_pulling_2');

    viewmodel.dispose();
    factory.dispose();
  });
});

describe('held item QA transform overrides', () => {
  it('parses held* query params and leaves missing or invalid keys unset', () => {
    expect(parseHeldItemQaOverride('')).toBeUndefined();
    expect(parseHeldItemQaOverride('qaItem=iron_pickaxe')).toBeUndefined();
    expect(parseHeldItemQaOverride('heldScale=abc&heldX=')).toBeUndefined();
    expect(parseHeldItemQaOverride('heldScale=0.85&heldX=0.5&heldRoll=14')).toEqual({
      scale: 0.85,
      x: 0.5,
      roll: 14,
    });
    const onePointSixTarget = resolveHeldItemTransform(
      itemRenderProfile('iron_pickaxe').transforms.firstPersonRightHand,
      { scale: 0.578 },
    );
    expect(onePointSixTarget.scale[0]).toBeCloseTo(0.578);
    expect(onePointSixTarget.scale[0]).not.toBeCloseTo(0.578 * 0.68);
  });

  it('overrides only the first-person sprite pose and keeps ground transforms', () => {
    const base = itemRenderProfile('iron_pickaxe').transforms.firstPersonRightHand;
    const ground = itemRenderProfile('iron_pickaxe').transforms.ground;
    const resolved = resolveHeldItemTransform(base, { scale: 1.1, y: -0.7, pitch: 0, yaw: 0, roll: 10 });
    expect(resolved.scale[0]).toBeCloseTo(1.1);
    expect(resolved.position[1]).toBeCloseTo(-0.7);
    expect(resolved.rotation[2]).toBeCloseTo(10 * Math.PI / 180);
    expect(itemRenderProfile('iron_pickaxe').transforms.ground).toBe(ground);
    expect(formatHeldItemQaQuery({
      scale: 0.85, x: 0.5, y: -0.56, z: -0.82, roll: 14, pitch: 0, yaw: 0,
    })).toContain('heldScale=0.85');
  });

  it('keeps the idle generated front facing the viewmodel camera', () => {
    const factory = new ItemVisualFactory();
    const viewmodel = new FirstPersonRenderer(factory, {
      qaOverride: { pitch: 0, yaw: 0, roll: 14 },
    });
    viewmodel.setHeldItems('diamond_sword');
    viewmodel.update(0.2, frameState());
    const dot = viewmodel.measureHeldFrontCameraDot();
    const front = viewmodel.heldFrontWorldNormal();
    expect(dot).toBeDefined();
    expect(dot).toBeCloseTo(1, 5);
    expect(front?.z).toBeCloseTo(1, 5);
    expect(Math.abs(front?.x ?? 1)).toBeLessThan(1e-5);
    expect(Math.abs(front?.y ?? 1)).toBeLessThan(1e-5);
    expect(viewmodel.root.rotation.x).toBeCloseTo(0);
    expect(viewmodel.root.rotation.y).toBeCloseTo(0);
    viewmodel.dispose();
    factory.dispose();
  });
});
