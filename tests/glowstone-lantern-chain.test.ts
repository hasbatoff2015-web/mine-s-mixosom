import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  BlockId,
  getBlockByKey,
  getBlockDefinition,
  glowstoneBlockEmission,
  lanternBlockEmission,
  lanternPlacementFromHit,
  torchBlockEmission,
} from '../src/blocks';
import { Game } from '../src/core/Game';
import { CHUNK_SIZE, PLAYER_REACH, floorDiv, positiveMod } from '../src/core/constants';
import { findCraftingRecipe, getCraftingResult } from '../src/crafting';
import { Inventory, createItemStack } from '../src/inventory';
import {
  getItemDefinition,
  itemHeldMeshKind,
  itemIconDescriptor,
  obtainableItems,
  usesBlockModelIcon,
} from '../src/items';
import { selectionLocalBoxes, CHAIN_PLANE_B_UV, LANTERN_BODY_UV } from '../src/rendering/specialBlockGeometry';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { canSupportHanger, isBlockStillSupported, needsBlockSupport } from '../src/world/placement';
import { blockCollisionBoxes } from '../src/world/collision';
import { blockSelectionBoxes } from '../src/world/selection';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function emptyColumn(world: VoxelWorld, x: number, z: number, y0 = 38, y1 = 48): void {
  for (let y = y0; y <= y1; y += 1) writeBlock(world, x, y, z, BlockId.Air);
}

const faces = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

function placementFixture(block = BlockId.Stone, normal = faces[2]!) {
  const world = new VoxelWorld('glow-lantern-chain');
  const chunk = new Chunk(0, 0);
  world.chunks.set('0,0', chunk);
  chunk.set(5, 40, 5, block);
  const inventory = new Inventory();
  const player = {
    position: new THREE.Vector3(2, 40, 2),
    velocity: new THREE.Vector3(),
    yaw: 0,
    eyePosition: () => new THREE.Vector3(2, 42, 2),
    viewDirection: () => new THREE.Vector3(0, 0, -1),
    intersectsBlock: () => false,
    intersectsCollisionBoxes: () => false,
  };
  const redstone = {
    notifyBlockChanged: vi.fn(),
    setButtonOrientation: () => undefined,
    setLeverOrientation: () => undefined,
  };
  const game = Object.create(Game.prototype) as any;
  const session = {
    world,
    inventory,
    selectedSlot: 0,
    summary: { mode: 'survival' },
    player,
    redstone,
    target: {
      x: 5, y: 40, z: 5, block, normal, distance: 2,
      point: new THREE.Vector3(5.5, 40.5, 5.5),
    },
    minecarts: { raycast: () => undefined, cartAt: () => undefined, nearest: () => undefined },
    foodUseTicks: 0,
    bowUseTicks: 0,
  };
  Object.assign(game, {
    session,
    input: { yaw: 0, pitch: 0 },
    ui: { toast: vi.fn() },
    audio: { playTone: vi.fn(), play: vi.fn(), playAt: vi.fn(), playBlock: vi.fn() },
    firstPerson: { swing: vi.fn() },
    listenerPose: () => ({ x: 0, y: 0, z: 0 }),
  });
  const place = (itemId: string) => {
    inventory.setSlot(0, createItemStack(itemId));
    game.useTargetOrItem();
  };
  return { world, chunk, game, session, inventory, place };
}

describe('glowstone / lantern / chain registry', () => {
  it('registers all three as obtainable blocks with items', () => {
    for (const key of ['glowstone', 'lantern', 'chain'] as const) {
      expect(getBlockByKey(key)?.key).toBe(key);
      expect(getItemDefinition(key).placesBlockId).toBe(getBlockByKey(key)!.id);
      expect(obtainableItems().some((item) => item.id === key)).toBe(true);
    }
    expect(getBlockDefinition(BlockId.Glowstone)).toMatchObject({
      renderShape: 'cube', solid: true, opaque: true, emission: 15,
    });
    expect(getBlockDefinition(BlockId.Lantern)).toMatchObject({
      renderShape: 'lantern', solid: true, opaque: false, emission: 15,
    });
    expect(getBlockDefinition(BlockId.Chain)).toMatchObject({
      renderShape: 'chain', solid: true, opaque: false,
    });
    expect(getBlockDefinition(BlockId.Chain).emission ?? 0).toBe(0);
  });

  it('uses 3D special models for lantern and chain, cube for glowstone', () => {
    expect(itemHeldMeshKind('glowstone')).toBe('block_cube');
    expect(itemHeldMeshKind('lantern')).toBe('special_model');
    expect(itemHeldMeshKind('chain')).toBe('special_model');
    expect(itemIconDescriptor('lantern')).toEqual({ kind: 'texture', texturePath: 'item/lantern' });
    expect(itemIconDescriptor('chain')).toEqual({ kind: 'texture', texturePath: 'item/chain' });
    expect(getItemDefinition('lantern').texture).toBe('item/lantern');
    expect(getItemDefinition('chain').texture).toBe('item/chain');
    expect(itemIconDescriptor('glowstone').kind).toBe('special_preview');
  });
});

describe('glowstone / lantern / chain recipes', () => {
  it('crafts glowstone shapeless from torch + gold ingot', () => {
    const a = [null, 'torch', null, 'gold_ingot'];
    const b = ['gold_ingot', null, 'torch', null];
    expect(findCraftingRecipe(a, 2, 2)?.id).toBe('glowstone');
    expect(findCraftingRecipe(b, 2, 2)?.id).toBe('glowstone');
    expect(getCraftingResult(a, 2, 2)).toEqual({ itemId: 'glowstone', count: 1 });
  });

  it('crafts lantern shapeless from torch + iron ingot', () => {
    const input = ['torch', 'iron_ingot', null, null];
    expect(findCraftingRecipe(input, 2, 2)?.id).toBe('lantern');
    expect(getCraftingResult(input, 2, 2)).toEqual({ itemId: 'lantern', count: 1 });
  });

  it('crafts 16 chains from the shaped iron/stick grid', () => {
    const grid = [
      'iron_ingot', 'stick', 'iron_ingot',
      'iron_ingot', 'stick', 'iron_ingot',
      'iron_ingot', 'stick', 'iron_ingot',
    ];
    expect(findCraftingRecipe(grid, 3, 3)?.id).toBe('chain');
    expect(getCraftingResult(grid, 3, 3)).toEqual({ itemId: 'chain', count: 16 });
    const shapeless = ['iron_ingot', 'stick', 'iron_ingot', 'stick', null, null, null, null, null];
    expect(findCraftingRecipe(shapeless, 3, 3)?.id).not.toBe('chain');
  });
});

describe('vanilla light levels', () => {
  it('keeps torch=14, glowstone=15, lantern=15', () => {
    expect(torchBlockEmission()).toBe(14);
    expect(glowstoneBlockEmission()).toBe(15);
    expect(lanternBlockEmission()).toBe(15);
    expect(getBlockDefinition(BlockId.Torch).emission).toBe(14);
    expect(getBlockDefinition(BlockId.Glowstone).emission).toBe(15);
    expect(getBlockDefinition(BlockId.Lantern).emission).toBe(15);
  });

  it('emits and clears glowstone/lantern block light without a leftover cell', () => {
    const world = new VoxelWorld('glow-light');
    for (let x = 6; x <= 10; x += 1) emptyColumn(world, x, 8);
    world.setBlock(8, 40, 8, BlockId.Glowstone);
    expect(world.blockEmissionAt(8, 40, 8)).toBe(15);
    expect(world.blockLightAt(8, 40, 8)).toBe(15);
    expect(world.blockLightAt(9, 40, 8)).toBeGreaterThanOrEqual(14);
    world.setBlock(8, 40, 8, BlockId.Air);
    expect(world.blockEmissionAt(8, 40, 8)).toBe(0);
    expect(world.blockLightAt(8, 40, 8)).toBe(0);

    world.setBlock(8, 40, 8, BlockId.Lantern);
    world.setBlockState(8, 40, 8, { attachment: 'floor' });
    expect(world.blockEmissionAt(8, 40, 8)).toBe(15);
    expect(world.blockLightAt(8, 40, 8)).toBe(15);
    world.setBlock(8, 40, 8, BlockId.Air);
    expect(world.blockLightAt(8, 40, 8)).toBe(0);
  });

  it('propagates glowstone light across the x=15/16 chunk border', () => {
    const world = new VoxelWorld('glow-border');
    world.getChunk(0, 0);
    world.getChunk(1, 0);
    emptyColumn(world, 15, 8);
    emptyColumn(world, 16, 8);
    world.setBlock(15, 40, 8, BlockId.Glowstone);
    expect(world.blockLightAt(15, 40, 8)).toBe(15);
    expect(world.blockLightAt(16, 40, 8)).toBeGreaterThanOrEqual(14);
  });
});

describe('lantern and chain placement', () => {
  it('places a standing lantern on a top face and a hanging lantern on a bottom face', () => {
    const standing = placementFixture(BlockId.Stone, faces[2]!);
    standing.place('lantern');
    expect(standing.world.getBlock(5, 41, 5, false)).toBe(BlockId.Lantern);
    expect(standing.world.getBlockState(5, 41, 5)?.attachment).toBe('floor');

    const hanging = placementFixture(BlockId.Stone, faces[3]!);
    hanging.place('lantern');
    expect(hanging.world.getBlock(5, 39, 5, false)).toBe(BlockId.Lantern);
    expect(hanging.world.getBlockState(5, 39, 5)?.attachment).toBe('ceiling');
  });

  it('rejects wall lanterns and lanterns without support', () => {
    expect(lanternPlacementFromHit(1, 0, 0)).toBeUndefined();
    const wall = placementFixture(BlockId.Stone, faces[0]!);
    wall.place('lantern');
    expect(wall.world.getBlock(6, 40, 5, false)).toBe(BlockId.Air);

    const torch = placementFixture(BlockId.Torch, faces[2]!);
    torch.place('lantern');
    expect(torch.world.getBlock(5, 41, 5, false)).toBe(BlockId.Air);
  });

  it('places vertical chain on a ceiling and continues another chain downward', () => {
    const first = placementFixture(BlockId.Stone, faces[3]!);
    first.place('chain');
    expect(first.world.getBlock(5, 39, 5, false)).toBe(BlockId.Chain);
    expect(first.world.getBlockState(5, 39, 5)?.attachment).toBe('ceiling');

    first.session.target = {
      x: 5, y: 39, z: 5, block: BlockId.Chain, normal: faces[3]!, distance: 1,
      point: new THREE.Vector3(5.5, 39.0, 5.5),
    };
    first.place('chain');
    expect(first.world.getBlock(5, 38, 5, false)).toBe(BlockId.Chain);
    expect(first.world.getBlockState(5, 38, 5)?.attachment).toBe('ceiling');
  });

  it('hangs a lantern from the bottom of a chain', () => {
    const f = placementFixture(BlockId.Stone, faces[3]!);
    f.place('chain');
    expect(f.world.getBlock(5, 39, 5, false)).toBe(BlockId.Chain);
    f.session.target = {
      x: 5, y: 39, z: 5, block: BlockId.Chain, normal: faces[3]!, distance: 1,
      point: new THREE.Vector3(5.5, 39.0, 5.5),
    };
    f.place('lantern');
    expect(f.world.getBlock(5, 38, 5, false)).toBe(BlockId.Lantern);
    expect(f.world.getBlockState(5, 38, 5)?.attachment).toBe('ceiling');
  });

  it('rejects a sideways chain', () => {
    const f = placementFixture(BlockId.Stone, faces[0]!);
    f.place('chain');
    expect(f.world.getBlock(6, 40, 5, false)).toBe(BlockId.Air);
  });

  it('drops unsupported hanging lanterns and chain columns through existing integrity', () => {
    const world = new VoxelWorld('hanger-support');
    const chunk = new Chunk(0, 0);
    world.chunks.set('0,0', chunk);
    world.setBlock(8, 42, 8, BlockId.Stone);
    world.setBlock(8, 41, 8, BlockId.Chain);
    world.setBlockState(8, 41, 8, { attachment: 'ceiling' });
    world.setBlock(8, 40, 8, BlockId.Chain);
    world.setBlockState(8, 40, 8, { attachment: 'ceiling' });
    world.setBlock(8, 39, 8, BlockId.Lantern);
    world.setBlockState(8, 39, 8, { attachment: 'ceiling' });
    expect(needsBlockSupport(BlockId.Chain)).toBe(true);
    expect(needsBlockSupport(BlockId.Lantern)).toBe(true);
    expect(canSupportHanger(world, 8, 41, 8, 'down')).toBe(true);
    expect(isBlockStillSupported(world, 8, 39, 8)).toBe(true);

    world.setBlock(8, 42, 8, BlockId.Air);
    world.processSupportIntegrity(256);
    expect(world.getBlock(8, 41, 8, false)).toBe(BlockId.Air);
    world.processSupportIntegrity(256);
    expect(world.getBlock(8, 40, 8, false)).toBe(BlockId.Air);
    world.processSupportIntegrity(256);
    expect(world.getBlock(8, 39, 8, false)).toBe(BlockId.Air);
  });
});

describe('lantern and chain selection', () => {
  it('does not treat chain or lantern as a full cube for raycast', () => {
    const chain = selectionLocalBoxes(BlockId.Chain, undefined);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.maxX - chain[0]!.minX).toBeLessThan(0.3);
    expect(chain[0]!.maxX - chain[0]!.minX).toBeGreaterThan(0.1);

    const lantern = selectionLocalBoxes(BlockId.Lantern, { attachment: 'floor' });
    expect(lantern[0]!.maxX - lantern[0]!.minX).toBeLessThan(0.5);
    expect(lantern[0]!.maxY - lantern[0]!.minY).toBeLessThan(0.7);

    const world = new VoxelWorld('partial-select');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    world.setBlock(4, 40, 4, BlockId.Chain);
    world.setBlock(4, 40, 6, BlockId.Stone);
    const missChain = world.raycast(new THREE.Vector3(4.1, 40.5, 3), new THREE.Vector3(0, 0, 1), PLAYER_REACH);
    expect(missChain).toMatchObject({ x: 4, y: 40, z: 6, block: BlockId.Stone });
    const hitChain = world.raycast(new THREE.Vector3(4.5, 40.5, 3), new THREE.Vector3(0, 0, 1), PLAYER_REACH);
    expect(hitChain).toMatchObject({ x: 4, y: 40, z: 4, block: BlockId.Chain });

    world.setBlock(2, 40, 2, BlockId.Lantern);
    world.setBlockState(2, 40, 2, { attachment: 'floor' });
    world.setBlock(2, 40, 4, BlockId.Dirt);
    const missLantern = world.raycast(new THREE.Vector3(2.05, 40.8, 1), new THREE.Vector3(0, 0, 1), 6);
    expect(missLantern).toMatchObject({ x: 2, y: 40, z: 4, block: BlockId.Dirt });
    const hitLantern = world.raycast(new THREE.Vector3(2.5, 40.2, 1), new THREE.Vector3(0, 0, 1), 6);
    expect(hitLantern).toMatchObject({ x: 2, y: 40, z: 2, block: BlockId.Lantern });
  });

  it('keeps glowstone as a full-block target', () => {
    const boxes = selectionLocalBoxes(BlockId.Glowstone, undefined);
    expect(boxes).toEqual([{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }]);
  });

  it('uses thin collision for lantern and chain, full for glowstone', () => {
    const world = new VoxelWorld('collision-shape');
    world.getChunk(0, 0)!.blocks.fill(BlockId.Air);
    world.setBlock(3, 40, 3, BlockId.Glowstone);
    world.setBlock(4, 40, 4, BlockId.Chain);
    world.setBlock(5, 40, 5, BlockId.Lantern);
    world.setBlockState(5, 40, 5, { attachment: 'floor' });
    const glow = blockCollisionBoxes(world, 3, 40, 3)[0]!;
    expect(glow.maxX - glow.minX).toBe(1);
    const chain = blockCollisionBoxes(world, 4, 40, 4)[0]!;
    expect(chain.maxX - chain.minX).toBeLessThan(0.3);
    const lantern = blockCollisionBoxes(world, 5, 40, 5)[0]!;
    expect(lantern.maxY - lantern.minY).toBeLessThan(0.7);
    expect(blockSelectionBoxes(world, 4, 40, 4)[0]!.maxX - blockSelectionBoxes(world, 4, 40, 4)[0]!.minX)
      .toBeLessThan(0.3);
  });
});

describe('drops and save/load', () => {
  it('drops the matching item for each block', () => {
    expect(getBlockDefinition(BlockId.Glowstone).drop).toMatchObject({ item: 'glowstone', count: 1 });
    expect(getBlockDefinition(BlockId.Lantern).drop).toMatchObject({ item: 'lantern', count: 1 });
    expect(getBlockDefinition(BlockId.Chain).drop).toMatchObject({ item: 'chain', count: 1 });
  });

  it('restores glowstone, hanging lantern and chain after save/load', () => {
    const original = new VoxelWorld('light-save');
    original.setBlock(6, 44, 6, BlockId.Glowstone);
    original.setBlock(7, 44, 7, BlockId.Chain);
    original.setBlockState(7, 44, 7, { attachment: 'ceiling' });
    original.setBlock(7, 43, 7, BlockId.Lantern);
    original.setBlockState(7, 43, 7, { attachment: 'ceiling' });
    const restored = new VoxelWorld('light-save');
    restored.restore({
      timeOfDay: 1000,
      modifications: original.serializeModifications(),
      chests: {},
      furnaces: {},
      blockStates: original.serializeBlockStates(),
    });
    restored.getChunk(0, 0);
    expect(restored.getBlock(6, 44, 6)).toBe(BlockId.Glowstone);
    expect(restored.getBlock(7, 44, 7)).toBe(BlockId.Chain);
    expect(restored.getBlockState(7, 44, 7)?.attachment).toBe('ceiling');
    expect(restored.getBlock(7, 43, 7)).toBe(BlockId.Lantern);
    expect(restored.getBlockState(7, 43, 7)?.attachment).toBe('ceiling');
    expect(restored.blockEmissionAt(6, 44, 6)).toBe(15);
    expect(restored.blockEmissionAt(7, 43, 7)).toBe(15);
  });
});

describe('meshing is special, not a full cube', () => {
  it('emits lantern and chain cutout geometry instead of a unit cube', () => {
    const world = new VoxelWorld('light-mesh');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    world.setBlock(8, 40, 8, BlockId.Lantern);
    world.setBlockState(8, 40, 8, { attachment: 'floor' });
    world.setBlock(9, 40, 9, BlockId.Chain);
    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    expect(meshed.cutout.getAttribute('position').count).toBeGreaterThan(24);
    expect(meshed.opaque.getAttribute('position').count).toBe(0);
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.vegetation.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
    meshed.fire.dispose();
  });
});

describe('pack textures and inventory icons', () => {
  it('does not bake lantern/chain GUI from the block UV atlas', () => {
    expect(usesBlockModelIcon('glowstone')).toBe(true);
    expect(usesBlockModelIcon('lantern')).toBe(false);
    expect(usesBlockModelIcon('chain')).toBe(false);
  });

  it('builds held lantern/chain meshes from world UV rects, not full-tile box mapping', () => {
    const factory = new ItemVisualFactory();
    const lantern = factory.createItemModel('lantern');
    const chain = factory.createItemModel('chain');
    const lanternGeometry = (lantern.children[0] as THREE.Mesh).geometry;
    const chainGeometry = (chain.children[0] as THREE.Mesh).geometry;
    expect(lanternGeometry.userData.specialHeldAtlasUv).toBe(true);
    expect(chainGeometry.userData.specialHeldAtlasUv).toBe(true);
    const lanternUv = lanternGeometry.getAttribute('uv');
    let lanternMinU = Infinity;
    for (let index = 0; index < lanternUv.count; index += 1) {
      lanternMinU = Math.min(lanternMinU, lanternUv.getX(index));
    }
    expect(lanternMinU).toBeCloseTo(LANTERN_BODY_UV[0], 5);
    const chainUv = chainGeometry.getAttribute('uv');
    let chainMaxU = -Infinity;
    for (let index = 0; index < chainUv.count; index += 1) {
      chainMaxU = Math.max(chainMaxU, chainUv.getX(index));
    }
    expect(chainMaxU).toBeCloseTo(CHAIN_PLANE_B_UV[2], 5);
    factory.dispose();
  });
});
