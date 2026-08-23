import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, getBlockDefinition, isFenceBlock } from '../src/blocks';
import { consumeCraftingGrid, matchCraftingRecipe } from '../src/crafting';
import { MinecartManager, MobManager } from '../src/entities';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId, getItemDefinition, obtainableItems } from '../src/items';
import { PlayerController } from '../src/player';
import { RedstoneSystem } from '../src/redstone';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { fenceLocalBoxes, resolveRailShape } from '../src/rendering/specialBlockGeometry';
import { SurvivalSystem } from '../src/survival';
import { blockCollisionBoxes } from '../src/world/collision';
import { VoxelWorld } from '../src/world/World';
import { TerrainGenerator } from '../src/world/Generator';
import { Chunk } from '../src/world/Chunk';

function clearColumn(world: VoxelWorld, x: number, z: number, from: number, to: number): void {
  for (let y = from; y <= to; y += 1) world.setBlock(x, y, z, BlockId.Air);
}

describe('new items, blocks and entities', () => {
  it('registers flint and steel, cobweb, fences, rails and new items in creative', () => {
    expect(getItemDefinition(ItemId.FlintAndSteel)).toMatchObject({ durability: 64 });
    expect(getBlockDefinition(BlockId.Cobweb).renderShape).toBe('cross');
    expect(isFenceBlock(BlockId.OakFence)).toBe(true);
    expect(isFenceBlock(BlockId.BirchFence)).toBe(true);
    expect(isFenceBlock(BlockId.SpruceFence)).toBe(true);
    expect(getBlockDefinition(BlockId.Rail).renderShape).toBe('rail');
    const ids = new Set(obtainableItems().map((item) => item.id));
    for (const id of [
      ItemId.FlintAndSteel, ItemId.GoldenApple, ItemId.GlassBottle,
      ItemId.PotionInvisibility, ItemId.PotionRegeneration, ItemId.FireArrow,
      ItemId.Minecart, 'oak_fence', 'rail', 'cobweb',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('crafts a fire arrow from arrow + lava bucket and returns an empty bucket', () => {
    const match = matchCraftingRecipe([ItemId.Arrow, ItemId.LavaBucket, null, null], 2, 2);
    expect(match?.output.itemId).toBe(ItemId.FireArrow);
    const leftover = consumeCraftingGrid([
      createItemStack(ItemId.Arrow),
      createItemStack(ItemId.LavaBucket),
      null,
      null,
    ], match!);
    expect(leftover[1]?.itemId).toBe(ItemId.Bucket);
  });

  it('gives golden apple absorption and regeneration, and potions return a bottle', () => {
    const survival = new SurvivalSystem({ health: 10, hunger: 10 });
    const inventory = new Inventory();
    inventory.add(createItemStack(ItemId.GoldenApple));
    expect(survival.consumeFood(ItemId.GoldenApple, inventory)).toBe(true);
    expect(survival.absorption).toBeGreaterThanOrEqual(4);
    expect(survival.hasEffect('regeneration')).toBe(true);

    inventory.add(createItemStack(ItemId.PotionInvisibility));
    expect(survival.consumeFood(ItemId.PotionInvisibility, inventory)).toBe(true);
    expect(survival.invisible).toBe(true);
    expect(inventory.has(ItemId.GlassBottle, 1)).toBe(true);

    inventory.add(createItemStack(ItemId.PotionRegeneration));
    const before = survival.health;
    survival.consumeFood(ItemId.PotionRegeneration, inventory);
    for (let tick = 0; tick < 60; tick += 1) survival.tick(0.05);
    expect(survival.health).toBeGreaterThan(before);
  });

  it('slows the player inside cobweb and keeps fence collision taller than a jump', () => {
    const world = new VoxelWorld('cobweb-fence');
    world.getChunk(0, 0);
    for (let x = 4; x <= 10; x += 1) {
      for (let z = 4; z <= 10; z += 1) world.setBlock(x, 40, z, BlockId.Stone);
    }
    world.setBlock(6, 41, 6, BlockId.Cobweb);
    const player = new PlayerController({ position: [6.5, 41, 6.5] });
    player.tick(world, {
      yaw: 0, pitch: 0,
      movement: () => ({ forward: 1, right: 0, jump: false, sprint: false, sneak: false }),
    }, 0.05);
    expect(player.inCobweb).toBe(true);

    world.setBlock(8, 41, 8, BlockId.OakFence);
    const boxes = blockCollisionBoxes(world, 8, 41, 8);
    const height = Math.max(...boxes.map((box) => box.maxY - box.minY));
    expect(height).toBeGreaterThan(1.4);
    expect(fenceLocalBoxes({ north: true, south: false, east: false, west: false }).length).toBeGreaterThan(1);
  });

  it('connects rails and moves a minecart along them', () => {
    const world = new VoxelWorld('rails-cart');
    world.getChunk(0, 0);
    for (let z = 4; z <= 10; z += 1) {
      world.setBlock(5, 40, z, BlockId.Stone);
      world.setBlock(5, 41, z, BlockId.Rail);
    }
    world.setBlockState(5, 41, 6, { railShape: resolveRailShape(world, 5, 41, 6) });
    expect(resolveRailShape(world, 5, 41, 6)).toBe('north_south');
    const scene = new THREE.Scene();
    const carts = new MinecartManager(scene, world, new ItemVisualFactory());
    const cart = carts.spawn(5, 41, 6);
    expect(cart).toBeDefined();
    carts.push(cart!, new THREE.Vector3(0, 0, 1), 0.3);
    const startZ = cart!.position.z;
    for (let tick = 0; tick < 12; tick += 1) carts.update(0.05);
    expect(Math.abs(cart!.position.z - startZ)).toBeGreaterThan(0.05);
  });

  it('primes TNT with flint-and-steel style ignition', () => {
    const world = new VoxelWorld('flint-tnt');
    world.getChunk(0, 0);
    clearColumn(world, 4, 4, 40, 45);
    world.setBlock(4, 40, 4, BlockId.Stone);
    world.setBlock(4, 41, 4, BlockId.Tnt);
    const redstone = new RedstoneSystem(world);
    redstone.primeTnt(4, 41, 4);
    expect(world.getBlock(4, 41, 4)).toBe(BlockId.Air);
    expect(redstone.primedTntCount).toBeGreaterThan(0);
  });

  it('ignites a mob for five seconds from a fire arrow hit', () => {
    const world = new VoxelWorld('fire-arrow');
    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const cow = manager.spawn('cow', new THREE.Vector3(4, 42, 4), { force: true });
    expect(cow).toBeDefined();
    manager.damage(cow!, 1, { source: 'projectile', igniteTicks: 100 });
    expect(cow!.fireTicks).toBeGreaterThanOrEqual(100);
    manager.dispose();
  });
});

describe('worldgen lava lakes', () => {
  it('places connected lava pockets instead of scattered single voxels', () => {
    const generator = new TerrainGenerator('lava-lake-audit');
    let lava = 0;
    let singles = 0;
    let clustered = 0;
    for (let cz = -2; cz <= 2; cz += 1) {
      for (let cx = -2; cx <= 2; cx += 1) {
        const chunk = new Chunk(cx, cz);
        generator.generate(chunk);
        for (let z = 0; z < 16; z += 1) {
          for (let x = 0; x < 16; x += 1) {
            for (let y = 1; y <= 14; y += 1) {
              if (chunk.get(x, y, z) !== BlockId.Lava) continue;
              lava += 1;
              let neighbors = 0;
              for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = x + dx;
                const nz = z + dz;
                if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
                if (chunk.get(nx, y, nz) === BlockId.Lava) neighbors += 1;
              }
              if (neighbors === 0) singles += 1;
              else clustered += 1;
            }
          }
        }
      }
    }
    expect(lava).toBeGreaterThan(20);
    expect(clustered).toBeGreaterThan(singles);
    expect(singles / Math.max(1, lava)).toBeLessThan(0.25);
  });
});
