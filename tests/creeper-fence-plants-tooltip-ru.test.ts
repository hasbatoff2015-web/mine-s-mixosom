import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId, BLOCKS, getBlockDefinition } from '../src/blocks';
import { JUMP_VELOCITY } from '../src/core/constants';
import { MobManager } from '../src/entities/MobManager';
import { moveVoxelBody } from '../src/entities/voxelPhysics';
import {
  RU_DISPLAY_NAMES,
  hasExplicitDisplayName,
  requiredDisplayName,
} from '../src/i18n';
import { Inventory } from '../src/inventory';
import type { MoveInput } from '../src/input/InputManager';
import { ITEMS, ItemId, getItemDefinition, obtainableItems } from '../src/items';
import { PlayerController, type PlayerInputSource } from '../src/player';
import { SurvivalSystem } from '../src/survival';
import { queryRecipeBook } from '../src/ui/recipeBook';
import { absorptionHudIcons } from '../src/ui/heartHud';
import {
  clampTooltipPosition,
  copyItemHoverAttributes,
  itemHoverAttributeString,
} from '../src/ui/itemTooltip';
import { fenceLocalBoxes } from '../src/rendering/specialBlockGeometry';
import {
  blockCollisionBoxes,
  collisionCandidateCellRange,
  MAX_BLOCK_COLLISION_Y_OVERHANG,
} from '../src/world/collision';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import {
  isVegetationBlock,
  needsBlockSupport,
  supportCellForBlock,
} from '../src/world/placement';
import { DroppedItemManager } from '../src/entities';
import { RedstoneSystem } from '../src/redstone';
import { Game } from '../src/core/Game';
import type { VoxelWorld as VoxelWorldType } from '../src/world/World';
import gameSource from '../src/core/Game.ts?raw';
import uiSource from '../src/ui/GameUI.ts?raw';
import tooltipSource from '../src/ui/itemTooltip.ts?raw';
import playerSource from '../src/player/PlayerController.ts?raw';
import constantsSource from '../src/core/constants.ts?raw';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

class TestWorld {
  readonly blocks = new Map<string, BlockId>();
  readonly states = new Map<string, { facing?: 'north' | 'south' | 'east' | 'west' }>();

  set(x: number, y: number, z: number, block: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, block);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    return this.blocks.get(`${x},${y},${z}`) ?? BlockId.Air;
  }

  getBlockState(x: number, y: number, z: number) {
    return this.states.get(`${x},${y},${z}`);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }
}

const idle: MoveInput = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };

function input(movement: Partial<MoveInput> = {}, yaw = 0): PlayerInputSource {
  return { yaw, pitch: 0, movement: () => ({ ...idle, ...movement }) };
}

function flatGround(): TestWorld {
  const world = new TestWorld();
  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

function asWorld(world: TestWorld): VoxelWorldType {
  return world as unknown as VoxelWorldType;
}

function worldChunk(): VoxelWorld {
  const world = new VoxelWorld('creeper-fence-plants');
  world.chunks.set('0,0', new Chunk(0, 0));
  return world;
}

function setBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  world.applyBlockBatch([{ x, y, z, block }], { deferLighting: true });
}

function drainDetached(world: VoxelWorld): DroppedItemManager {
  const drops = new DroppedItemManager(new THREE.Scene(), world);
  const redstone = new RedstoneSystem(world);
  const game = Object.create(Game.prototype) as {
    session: unknown;
    simRandom: () => number;
    processDetachedBlocks(): void;
  };
  game.session = { world, drops, redstone };
  game.simRandom = () => 0.5;
  cleanup.push(() => { drops.dispose(); redstone.dispose(); });
  (game as unknown as { processDetachedBlocks(): void }).processDetachedBlocks();
  return drops;
}

describe('creeper death animation', () => {
  it('plays the generic death pose after a player kill and then removes the mob', () => {
    const world = new VoxelWorld('creeper-death');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    cleanup.push(() => manager.dispose());
    const mob = manager.spawn('creeper', new THREE.Vector3(0, 72, 2), { force: true })!;
    expect(manager.damage(mob, 40)).toBe(true);
    expect(mob.state).toBe('die');
    expect(mob.fuseSeconds).toBe(0);
    manager.update(0.35);
    manager.interpolateVisuals(1);
    expect(mob.visual!.rotation.z).toBeGreaterThan(0);
    expect(mob.visual!.scale.x).toBeLessThan(1);
    for (let tick = 0; tick < 12; tick += 1) manager.update(0.1);
    expect(manager.count).toBe(0);
  });

  it('cancels a primed fuse so a killed creeper does not explode later', () => {
    const world = new VoxelWorld('creeper-primed-kill');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    cleanup.push(() => manager.dispose());
    const mob = manager.spawn('creeper', new THREE.Vector3(0, 72, 2), { force: true })!;
    mob.fuseSeconds = 1.2;
    manager.damage(mob, 40);
    expect(mob.state).toBe('die');
    expect(mob.fuseSeconds).toBe(0);
    for (let tick = 0; tick < 20; tick += 1) manager.update(0.05);
    expect(manager.consumeExplosions()).toHaveLength(0);
  });

  it('keeps the self-explosion path: immediate remove, no corpse, no gunpowder drop', () => {
    const world = new VoxelWorld('creeper-fuse');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    cleanup.push(() => manager.dispose());
    for (let z = 0; z <= 2; z += 1) {
      world.setBlock(0, 71, z, BlockId.Stone);
      for (let y = 72; y < 80; y += 1) world.setBlock(0, y, z, BlockId.Air);
    }
    manager.spawn('creeper', new THREE.Vector3(0, 72, 2), { force: true });
    for (let index = 0; index < 7; index += 1) {
      manager.update(0.25, { playerPosition: new THREE.Vector3(0, 72, 0) });
    }
    expect(manager.consumeExplosions()).toHaveLength(1);
    expect(manager.count).toBe(0);
    expect(manager.consumeDrops()).toHaveLength(0);
  });
});

describe('fence 1.5 collision broadphase', () => {
  it('keeps authored fence collision at 1.5 and visual boxes at 1', () => {
    expect(MAX_BLOCK_COLLISION_Y_OVERHANG).toBe(0.5);
    expect(JUMP_VELOCITY).toBe(8.4);
    expect(constantsSource).toContain('export const JUMP_VELOCITY = 8.4');
    expect(playerSource).toContain('const STEP_HEIGHT = 0.6');
    const visual = fenceLocalBoxes({ north: false, south: false, east: false, west: false }, 1);
    expect(Math.max(...visual.map((box) => box.maxY))).toBe(1);
    const world = flatGround();
    world.set(1, 1, 0, BlockId.OakFence);
    const collision = blockCollisionBoxes(asWorld(world), 1, 1, 0);
    expect(Math.max(...collision.map((box) => box.maxY))).toBe(2.5);
  });

  it('includes the cell below the AABB so an elevated player still sees a fence', () => {
    const range = collisionCandidateCellRange(0.2, 2.15, 0.2, 0.8, 3.95, 0.8, 1e-7);
    expect(range.minY).toBe(1);
    expect(range.maxY).toBeGreaterThanOrEqual(3);
  });

  it('blocks walking into an isolated fence', () => {
    const world = flatGround();
    world.set(1, 1, 0, BlockId.OakFence);
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 20; tick += 1) player.tick(asWorld(world), input({ right: 1 }), 0.05);
    expect(player.position.x).toBeLessThan(1.08);
    expect(player.position.y).toBeCloseTo(1, 3);
  });

  it('blocks a full jump arc into a fence and does not step onto it', () => {
    const world = flatGround();
    world.set(1, 1, 0, BlockId.OakFence);
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    let maxX = player.position.x;
    for (let tick = 0; tick < 40; tick += 1) {
      player.tick(asWorld(world), input({ right: 1, jump: true }), 0.05);
      maxX = Math.max(maxX, player.position.x);
    }
    expect(maxX).toBeLessThan(1.12);
    expect(player.position.x).toBeLessThan(1.12);
    expect(player.position.y).toBeLessThan(2.2);
  });

  it('still blocks horizontally when feet are above the fence cell but below 1.5 collision', () => {
    const world = flatGround();
    world.set(1, 1, 0, BlockId.OakFence);
    const player = new PlayerController({ position: [0.85, 2.15, 0.5] });
    player.velocity.set(0, 0, 0);
    for (let tick = 0; tick < 12; tick += 1) {
      player.tick(asWorld(world), input({ right: 1 }), 0.05);
    }
    expect(player.position.x).toBeLessThan(1.12);
  });

  it('blocks connected and corner fences, and still allows jumping onto a full cube', () => {
    const connected = flatGround();
    connected.set(1, 1, 0, BlockId.OakFence);
    connected.set(1, 1, 1, BlockId.OakFence);
    const walker = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 16; tick += 1) walker.tick(asWorld(connected), input({ right: 1 }), 0.05);
    expect(walker.position.x).toBeLessThan(1.08);

    const corner = flatGround();
    corner.set(1, 1, 0, BlockId.OakFence);
    corner.set(2, 1, 0, BlockId.OakFence);
    corner.set(1, 1, 1, BlockId.OakFence);
    const cornerPlayer = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 16; tick += 1) {
      cornerPlayer.tick(asWorld(corner), input({ right: 1 }), 0.05);
    }
    expect(cornerPlayer.position.x).toBeLessThan(1.08);

    const cube = flatGround();
    cube.set(1, 1, 0, BlockId.Stone);
    const jumper = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 24; tick += 1) {
      jumper.tick(asWorld(cube), input({ right: 1, jump: true }), 0.05);
    }
    expect(jumper.position.x).toBeGreaterThan(1);
    expect(jumper.position.y).toBeGreaterThan(1.9);
  });

  it('keeps slab and stairs step-up working', () => {
    const slabWorld = flatGround();
    slabWorld.set(1, 1, 0, BlockId.StoneSlab);
    const slabPlayer = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 20 && slabPlayer.position.x < 1.3; tick += 1) {
      slabPlayer.tick(asWorld(slabWorld), input({ right: 1 }), 0.05);
    }
    expect(slabPlayer.position.x).toBeGreaterThan(1);
    expect(slabPlayer.position.y).toBeCloseTo(1.5, 5);

    const stairWorld = flatGround();
    stairWorld.set(1, 1, 0, BlockId.OakStairs);
    stairWorld.states.set('1,1,0', { facing: 'east' });
    const stairPlayer = new PlayerController({ position: [0.5, 1, 0.5] });
    for (let tick = 0; tick < 24 && stairPlayer.position.x < 1.35; tick += 1) {
      stairPlayer.tick(asWorld(stairWorld), input({ right: 1 }), 0.05);
    }
    expect(stairPlayer.position.x).toBeGreaterThan(1);
    expect(stairPlayer.position.y).toBeGreaterThan(1.45);
  });

  it('blocks mobs against the overhanging fence volume', () => {
    const world = flatGround();
    world.set(1, 1, 0, BlockId.OakFence);
    const position = new THREE.Vector3(1.0, 2.15, 0.5);
    const velocity = new THREE.Vector3(8, 0, 0);
    const result = moveVoxelBody(asWorld(world), position, velocity, 0.05, { width: 0.6, height: 1.7 });
    expect(result.hitX).toBe(true);
    expect(position.x).toBeLessThan(1.2);
  });
});

describe('vegetation support integrity', () => {
  it('treats grass/fern/flowers/dead bush as vegetation, not cobweb or fire', () => {
    expect(isVegetationBlock(BlockId.TallGrass)).toBe(true);
    expect(isVegetationBlock(BlockId.Fern)).toBe(true);
    expect(isVegetationBlock(BlockId.Dandelion)).toBe(true);
    expect(isVegetationBlock(BlockId.Poppy)).toBe(true);
    expect(isVegetationBlock(BlockId.OxeyeDaisy)).toBe(true);
    expect(isVegetationBlock(BlockId.DeadBush)).toBe(true);
    expect(isVegetationBlock(BlockId.Cobweb)).toBe(false);
    expect(isVegetationBlock(BlockId.Fire)).toBe(false);
    expect(needsBlockSupport(BlockId.TallGrass)).toBe(true);
    expect(supportCellForBlock(BlockId.TallGrass, undefined, 8, 41, 8)).toMatchObject({ x: 8, y: 40, z: 8 });
  });

  it('removes tall grass, fern and flowers after the substrate is mined', () => {
    const world = worldChunk();
    setBlock(world, 8, 40, 8, BlockId.GrassBlock);
    setBlock(world, 8, 41, 8, BlockId.TallGrass);
    setBlock(world, 9, 40, 8, BlockId.GrassBlock);
    setBlock(world, 9, 41, 8, BlockId.Fern);
    setBlock(world, 10, 40, 8, BlockId.Dirt);
    setBlock(world, 10, 41, 8, BlockId.Poppy);
    world.processSupportIntegrity();
    expect(world.getBlock(8, 41, 8)).toBe(BlockId.TallGrass);
    setBlock(world, 8, 40, 8, BlockId.Air);
    expect(world.processSupportIntegrity()).toBeGreaterThan(0);
    expect(world.processSupportIntegrity()).toBeLessThan(20);
    expect(world.getBlock(8, 41, 8)).toBe(BlockId.Air);
    setBlock(world, 9, 40, 8, BlockId.Air);
    world.processSupportIntegrity();
    expect(world.getBlock(9, 41, 8)).toBe(BlockId.Air);
    setBlock(world, 10, 40, 8, BlockId.Air);
    world.processSupportIntegrity();
    expect(world.getBlock(10, 41, 8)).toBe(BlockId.Air);
    const drops = drainDetached(world);
    expect(drops.count).toBe(0);
  });

  it('removes dead bush when sand disappears and leaves unrelated plants', () => {
    const world = worldChunk();
    setBlock(world, 8, 40, 8, BlockId.Sand);
    setBlock(world, 8, 41, 8, BlockId.DeadBush);
    setBlock(world, 12, 40, 8, BlockId.GrassBlock);
    setBlock(world, 12, 41, 8, BlockId.Dandelion);
    world.processSupportIntegrity();
    setBlock(world, 4, 40, 8, BlockId.Stone);
    world.processSupportIntegrity();
    expect(world.getBlock(8, 41, 8)).toBe(BlockId.DeadBush);
    expect(world.getBlock(12, 41, 8)).toBe(BlockId.Dandelion);
    setBlock(world, 8, 40, 8, BlockId.Air);
    world.processSupportIntegrity();
    expect(world.getBlock(8, 41, 8)).toBe(BlockId.Air);
    expect(world.getBlock(12, 41, 8)).toBe(BlockId.Dandelion);
  });

  it('lets water replace plants without inventing an item drop', () => {
    const world = worldChunk();
    setBlock(world, 8, 40, 8, BlockId.GrassBlock);
    setBlock(world, 8, 41, 8, BlockId.TallGrass);
    world.processSupportIntegrity();
    setBlock(world, 8, 41, 8, BlockId.Water);
    const drops = drainDetached(world);
    expect(world.getBlock(8, 41, 8)).toBe(BlockId.Water);
    expect(drops.count).toBe(0);
  });
});

describe('golden apple absorption rules', () => {
  it('sets absorption to 4 HP, replenishes without stacking, and refreshes duration', () => {
    const survival = new SurvivalSystem();
    expect(survival.absorption).toBe(0);
    survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 2400 });
    expect(survival.absorption).toBe(4);
    survival.damage(3, 'melee');
    expect(survival.absorption).toBe(1);
    survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 2400 });
    expect(survival.absorption).toBe(4);
    survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 2400 });
    expect(survival.absorption).toBe(4);
    survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 300 });
    survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 2400 });
    expect(survival.effectTicks('absorption')).toBe(2400);
  });

  it('shows the same two yellow hearts in HUD math used by Survival and Creative', () => {
    expect(absorptionHudIcons(4).icons).toEqual(['full', 'full']);
    expect(gameSource).toContain('absorption: session.survival.absorption');
    expect(gameSource).not.toMatch(/mode === 'creative' \? 0 : session\.survival\.absorption/);
  });

  it('clears leftover absorption on expiry and restores remaining HP from save', () => {
    const survival = new SurvivalSystem();
    survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 2 });
    expect(survival.absorption).toBe(4);
    survival.tick(0.1);
    expect(survival.hasEffect('absorption')).toBe(false);
    expect(survival.absorption).toBe(0);

    const saved = new SurvivalSystem();
    saved.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 2400 });
    saved.damage(1, 'generic', { ignoreInvulnerability: true });
    expect(saved.absorption).toBe(3);
    const restored = new SurvivalSystem();
    restored.restore(saved.serialize());
    expect(restored.absorption).toBe(3);
    expect(absorptionHudIcons(3).icons).toEqual(['full', 'half']);
    expect(restored.hasEffect('absorption')).toBe(true);
  });
});

describe('custom item tooltips', () => {
  it('emits tooltip metadata instead of a native title for item slots', () => {
    const markup = itemHoverAttributeString('Золотое яблоко', 'golden_apple', (value) => value);
    expect(markup).toContain('data-item-tooltip="Золотое яблоко"');
    expect(markup).toContain('data-item-id="golden_apple"');
    expect(markup).toContain('aria-label="Золотое яблоко"');
    expect(markup).not.toContain('title=');
    expect(uiSource).not.toMatch(/title="\$\{this\.escape\(definition/);
    expect(uiSource).not.toMatch(/title="\$\{this\.escape\(getItemDefinition/);
    expect(uiSource).toContain('itemHoverAttrs');
    expect(uiSource).toContain('attachItemTooltip');
    expect(tooltipSource).toContain('data-item-tooltip');
    expect(tooltipSource).toContain('aria-label');
  });

  it('clamps tooltip position on the right, bottom and top-left edges', () => {
    const right = clampTooltipPosition(990, 100, 80, 20, 1000, 400);
    expect(right.x + 80).toBeLessThanOrEqual(1000);
    expect(right.x).toBeGreaterThanOrEqual(8);
    const bottom = clampTooltipPosition(40, 390, 80, 24, 1000, 400);
    expect(bottom.y + 24).toBeLessThanOrEqual(400);
    const topLeft = clampTooltipPosition(0, 0, 80, 20, 1000, 400);
    expect(topLeft.x).toBeGreaterThanOrEqual(8);
    expect(topLeft.y).toBeGreaterThanOrEqual(8);
  });

  it('copies tooltip metadata when a dynamic slot is patched and clears native title', () => {
    const current = {
      title: 'Golden Apple',
      dataset: { sig: 'old', itemTooltip: 'Golden Apple', itemId: 'golden_apple' } as DOMStringMap,
      attributes: new Map<string, string>([['aria-label', 'Golden Apple'], ['title', 'Golden Apple']]),
      getAttribute(name: string) { return this.attributes.get(name) ?? null; },
      setAttribute(name: string, value: string) { this.attributes.set(name, value); },
      removeAttribute(name: string) {
        this.attributes.delete(name);
        if (name === 'title') this.title = '';
      },
    };
    const incoming = {
      dataset: { sig: 'new', itemTooltip: 'Золотое яблоко', itemId: 'golden_apple' } as DOMStringMap,
      attributes: new Map<string, string>([['aria-label', 'Золотое яблоко']]),
      getAttribute(name: string) { return this.attributes.get(name) ?? null; },
      setAttribute(name: string, value: string) { this.attributes.set(name, value); },
      removeAttribute(name: string) { this.attributes.delete(name); },
    };
    copyItemHoverAttributes(current as unknown as HTMLElement, incoming as unknown as HTMLElement);
    expect(current.title).toBe('');
    expect(current.dataset.itemTooltip).toBe('Золотое яблоко');
    expect(current.getAttribute('aria-label')).toBe('Золотое яблоко');
  });
});

describe('Russian item and block display names', () => {
  it('covers every obtainable item and gameplay block with an explicit mapping', () => {
    for (const item of obtainableItems()) {
      expect(hasExplicitDisplayName(item.id), item.id).toBe(true);
      expect(item.name).toBe(requiredDisplayName(item.id));
      expect(/[А-Яа-яЁё]/.test(item.name), item.id).toBe(true);
    }
    for (const block of BLOCKS) {
      expect(hasExplicitDisplayName(block.key), block.key).toBe(true);
      expect(block.name).toBe(RU_DISPLAY_NAMES[block.key]);
    }
    for (const item of ITEMS) {
      expect(hasExplicitDisplayName(item.id), item.id).toBe(true);
    }
  });

  it('uses the expected Russian names for representative items', () => {
    expect(getItemDefinition(ItemId.GoldenApple).name).toBe('Золотое яблоко');
    expect(getItemDefinition(ItemId.DiamondSword).name).toBe('Алмазный меч');
    expect(getItemDefinition(ItemId.WaterBucket).name).toBe('Ведро воды');
    expect(getItemDefinition(ItemId.PotionInvisibility).name).toBe('Зелье невидимости');
    expect(getItemDefinition(ItemId.Minecart).name).toBe('Вагонетка');
    expect(getItemDefinition(ItemId.WoodenPickaxe).name).toBe('Деревянная кирка');
    expect(getItemDefinition(ItemId.WoodenSword).name).toBe('Деревянный меч');
    expect(getItemDefinition(ItemId.IronChestplate).name).toBe('Железная кираса');
    expect(getItemDefinition('grass_block').name).toBe('Дёрн');
    expect(getBlockDefinition(BlockId.OakLog).name).toBe('Дубовое бревно');
  });

  it('lets the Recipe Book search Russian display names without changing recipe IDs', () => {
    const empty = new Map<string, number>();
    const swords = queryRecipeBook({
      kind: 'crafting', gridSize: 3, category: 'all', search: 'меч', craftableOnly: false,
    }, empty);
    expect(swords.some((entry) => entry.resultId === 'diamond_sword')).toBe(true);
    expect(swords.some((entry) => entry.id.includes('sword'))).toBe(true);
    const diamond = queryRecipeBook({
      kind: 'crafting', gridSize: 3, category: 'all', search: 'алмаз', craftableOnly: false,
    }, empty);
    expect(diamond.some((entry) => entry.resultId === 'diamond' || entry.resultId.includes('diamond'))).toBe(true);
    const planks = queryRecipeBook({
      kind: 'crafting', gridSize: 2, category: 'all', search: 'доски', craftableOnly: false,
    }, empty);
    expect(planks.some((entry) => entry.resultId === 'oak_planks')).toBe(true);
    const inventory = new Inventory();
    expect(inventory).toBeDefined();
  });
});
