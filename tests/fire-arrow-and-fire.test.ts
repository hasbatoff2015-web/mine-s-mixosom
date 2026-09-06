import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIRE_ARROW_IGNITE_TICKS, PlayerArrowManager, flamingArrowBlockHit } from '../src/combat';
import { HeadlessEntityHost, MobManager } from '../src/entities';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { Vec3 } from '../src/math/vec3';
import { classifyItemForRendering } from '../src/items/itemRenderProfiles';
import { ChunkMesher, disposeMeshedChunk } from '../src/rendering/ChunkMesher';
import { FIRE_PLANE_COUNT, fireBlockPlanes } from '../src/rendering/fireGeometry';
import { SharedFireTexture } from '../src/rendering/fireTexture';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

const ITEM_TEXTURES = import.meta.glob('../public/textures/item/*.png');
const BLOCK_TEXTURES = import.meta.glob('../public/textures/block/*.png');

describe('fire arrow combat', () => {
  it('only primes TNT and never places world fire on ordinary blocks', () => {
    expect(flamingArrowBlockHit(BlockId.Tnt)).toBe('prime_tnt');
    for (const block of [
      BlockId.Sand, BlockId.GrassBlock, BlockId.Dirt, BlockId.OakLog,
      BlockId.OakPlanks, BlockId.TallGrass, BlockId.Stone, BlockId.Air,
    ]) {
      expect(flamingArrowBlockHit(block), String(block)).toBe('none');
    }
  });

  it('ignites a living mob for five seconds with periodic fire damage, then water puts it out', () => {
    const world = new VoxelWorld('fire-arrow-burn');
    world.getChunk(0, 0);
    for (let x = 2; x <= 8; x += 1) {
      for (let z = 2; z <= 8; z += 1) world.setBlock(x, 40, z, BlockId.Stone);
    }
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const cow = manager.spawn('cow', new THREE.Vector3(4.5, 41, 4.5), { force: true });
    expect(cow).toBeDefined();
    manager.damage(cow!, 1, { source: 'projectile', igniteTicks: FIRE_ARROW_IGNITE_TICKS });
    expect(cow!.fireTicks).toBe(FIRE_ARROW_IGNITE_TICKS);
    const afterHit = cow!.health;
    for (let tick = 0; tick < 22; tick += 1) manager.update(0.05);
    expect(cow!.health).toBeLessThan(afterHit);
    expect(cow!.fireTicks).toBeGreaterThan(0);
    expect(cow!.fireTicks).toBeLessThan(FIRE_ARROW_IGNITE_TICKS);
    cow!.position.set(4.5, 41, 4.5);
    cow!.velocity.set(0, 0, 0);
    world.setBlock(4, 41, 4, BlockId.Water);
    world.setBlock(4, 42, 4, BlockId.Water);
    manager.update(0.05);
    expect(cow!.fireTicks).toBe(0);
    manager.dispose();
  });

  it.each([
    [false, ItemId.Arrow, ItemId.FireArrow],
    [true, ItemId.FireArrow, ItemId.Arrow],
  ] as const)('returns embedded flaming=%s projectiles to the matching ammo stack', (flaming, expected, other) => {
    const world = new VoxelWorld(`arrow-pickup-${flaming}`);
    const host = new HeadlessEntityHost();
    const mobs = new MobManager(host, world, { automaticSpawning: false });
    const arrows = new PlayerArrowManager(host, world, mobs, { random: () => 0.5 });
    arrows.spawn(new Vec3(4.5, 80, 4.5), new Vec3(1, 0, 0), 0, 0, false, flaming, undefined, 'shooter');
    const projectile = arrows.entities[0]!;
    projectile.inGround = true;
    projectile.pickupDelay = 0;
    const inventory = new Inventory();
    const player = { minX: 4, minY: 79, minZ: 4, maxX: 5, maxY: 81, maxZ: 5 };
    const collect = () => arrows.tryCollect(player, {
      mode: 'survival',
      addItem: (itemId, count) => inventory.addItem(itemId, count),
    });

    expect(collect()).toBe(1);
    expect(inventory.count(expected)).toBe(1);
    expect(inventory.count(other)).toBe(0);
    expect(arrows.count).toBe(0);
    expect(collect()).toBe(0);
    expect(inventory.count(expected)).toBe(1);
    arrows.dispose();
    mobs.dispose();
  });

  it('keeps an embedded fire arrow in the world when the FireArrow stack cannot accept it', () => {
    const world = new VoxelWorld('fire-arrow-full-pickup');
    const host = new HeadlessEntityHost();
    const mobs = new MobManager(host, world, { automaticSpawning: false });
    const arrows = new PlayerArrowManager(host, world, mobs, { random: () => 0.5 });
    arrows.spawn(new Vec3(4.5, 80, 4.5), new Vec3(1, 0, 0), 0, 0, false, true, undefined, 'shooter');
    const projectile = arrows.entities[0]!;
    projectile.inGround = true;
    projectile.pickupDelay = 0;
    const inventory = new Inventory();
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      inventory.setSlot(slot, createItemStack('dirt', 64));
    }

    expect(arrows.tryCollect(
      { minX: 4, minY: 79, minZ: 4, maxX: 5, maxY: 81, maxZ: 5 },
      { mode: 'survival', addItem: (itemId, count) => inventory.addItem(itemId, count) },
    )).toBe(0);
    expect(inventory.count(ItemId.Arrow)).toBe(0);
    expect(inventory.count(ItemId.FireArrow)).toBe(0);
    expect(arrows.count).toBe(1);
    expect(arrows.entities[0]).toBe(projectile);
    arrows.dispose();
    mobs.dispose();
  });

  it('keeps Creative pickup removal-only for fire arrows', () => {
    const world = new VoxelWorld('fire-arrow-creative-pickup');
    const host = new HeadlessEntityHost();
    const mobs = new MobManager(host, world, { automaticSpawning: false });
    const arrows = new PlayerArrowManager(host, world, mobs, { random: () => 0.5 });
    arrows.spawn(new Vec3(4.5, 80, 4.5), new Vec3(1, 0, 0), 0, 0, false, true, undefined, 'shooter');
    arrows.entities[0]!.inGround = true;
    arrows.entities[0]!.pickupDelay = 0;
    const added: string[] = [];

    expect(arrows.tryCollect(
      { minX: 4, minY: 79, minZ: 4, maxX: 5, maxY: 81, maxZ: 5 },
      { mode: 'creative', addItem: (itemId) => { added.push(itemId); return 0; } },
    )).toBe(1);
    expect(added).toEqual([]);
    expect(arrows.count).toBe(0);
    arrows.dispose();
    mobs.dispose();
  });
});

describe('fire block mesh and assets', () => {
  it('uses a dedicated fire shape with six planes, not a cube or plant cross', () => {
    expect(getBlockDefinition(BlockId.Fire).renderShape).toBe('fire');
    expect(fireBlockPlanes().length).toBe(FIRE_PLANE_COUNT);
    const world = new VoxelWorld('fire-mesh');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    world.setBlock(4, 12, 4, BlockId.Sand);
    world.setBlock(4, 13, 4, BlockId.Fire);
    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    expect(meshed.fire.getAttribute('position').count).toBe(FIRE_PLANE_COUNT * 4);
    expect(meshed.fire.getIndex()!.count).toBe(FIRE_PLANE_COUNT * 6);
    expect(meshed.cutout.getAttribute('position').count).toBe(0);
    expect(meshed.vegetation.getAttribute('position').count).toBe(0);
    disposeMeshedChunk(meshed);
  });

  it('ships an animated fire strip and readable flint/fire-arrow icons', () => {
    expect(BLOCK_TEXTURES['../public/textures/block/fire.png']).toBeTypeOf('function');
    expect(ITEM_TEXTURES['../public/textures/item/flint_and_steel.png']).toBeTypeOf('function');
    expect(ITEM_TEXTURES['../public/textures/item/fire_arrow.png']).toBeTypeOf('function');
    expect(ITEM_TEXTURES['../public/textures/item/arrow.png']).toBeTypeOf('function');
    expect(SharedFireTexture.instance().frames).toBeGreaterThanOrEqual(1);
  });

  it('holds flint and steel and the fire arrow as handheld generated items', () => {
    expect(classifyItemForRendering(ItemId.FlintAndSteel)).toBe('handheld');
    expect(classifyItemForRendering(ItemId.FireArrow)).toBe('handheld');
    const visuals = new ItemVisualFactory();
    const flint = visuals.createItemModel(ItemId.FlintAndSteel);
    const arrow = visuals.createItemModel(ItemId.FireArrow);
    expect(flint.userData.heldMeshKind).toBe('generated');
    expect(arrow.userData.heldMeshKind).toBe('generated');
    expect(flint.children.length).toBeGreaterThan(0);
    expect(arrow.children.length).toBeGreaterThan(0);
    visuals.dispose();
  });
});
