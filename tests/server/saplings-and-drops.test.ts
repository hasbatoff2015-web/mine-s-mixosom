import { describe, expect, it, vi } from 'vitest';
import { BlockId, getBlockDefinition, GRAVEL_FLINT_CHANCE, LEAF_SAPLING_CHANCE } from '../../src/blocks';
import { CombatSystem } from '../../src/combat';
import { placeFromHit, rollBrokenBlockDrops, type UseSimulationContext } from '../../src/gameplay';
import { Inventory, createItemStack, createPortalChestInventory } from '../../src/inventory';
import { Vec3 } from '../../src/math/vec3';
import { PlayerController } from '../../src/player';
import { SurvivalSystem } from '../../src/survival';
import { Chunk } from '../../src/world/Chunk';
import { VoxelWorld } from '../../src/world/World';
import { SAPLING_GROW_MS, tryGrowSapling } from '../../src/world/saplings';
import { grownTreeHeight } from '../../src/world/trees';
import { EventBus } from '../../server/events';
import { ServerGameplay, type GameplayPlayer } from '../../server/gameplay';

function emptyWorld(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.chunks.set('0,0', new Chunk(0, 0));
  return world;
}

function playerNear(x: number, y: number, z: number): GameplayPlayer {
  return {
    id: 'planter', connected: true,
    controller: new PlayerController({ position: [x + 0.5, y, z + 1.5], yaw: 0, pitch: 0 }),
    inventory: new Inventory(), portalChest: createPortalChestInventory(), survival: new SurvivalSystem(), combat: new CombatSystem(),
    gamemode: 'survival', selectedSlot: 0, cursor: null,
    craftSlots: [null, null, null, null], window: { kind: 'inventory' },
    miningTarget: { x, y, z }, miningProgress: 1,
    bowUseTicks: 0, foodUseTicks: 0, lastUse: false, lastSprint: false,
    vehicleForward: 0, inventoryDirty: false,
  };
}

function dropIds(gameplay: ServerGameplay): string[] {
  return gameplay.drops.entities.map((entity) => entity.stack.itemId).sort();
}

describe('authoritative gravel and leaf drops', () => {
  it('keeps an ordinary block drop on the same roll path', () => {
    const drop = getBlockDefinition(BlockId.Dirt).drop!;
    expect(rollBrokenBlockDrops(drop, () => 0.01)).toEqual([{ item: 'dirt', count: 1 }]);
    const world = emptyWorld('dirt-drop');
    world.setBlock(5, 40, 5, BlockId.Dirt);
    const gameplay = new ServerGameplay(world, new EventBus());
    expect(gameplay.breakBlock(playerNear(5, 40, 5), 5, 40, 5)).toEqual({ ok: true });
    expect(dropIds(gameplay)).toEqual(['dirt']);
  });

  it('drops flint about 10% of the time and gravel otherwise, once per break', () => {
    expect(GRAVEL_FLINT_CHANCE).toBeCloseTo(0.1);
    const drop = getBlockDefinition(BlockId.Gravel).drop!;
    expect(rollBrokenBlockDrops(drop, () => 0)).toEqual([{ item: 'flint', count: 1 }]);
    expect(rollBrokenBlockDrops(drop, () => 0.1)).toEqual([{ item: 'gravel', count: 1 }]);
    expect(rollBrokenBlockDrops(drop, () => 0.99)).toEqual([{ item: 'gravel', count: 1 }]);

    for (const [roll, itemId] of [[0, 'flint'], [0.5, 'gravel']] as const) {
      const world = emptyWorld(`gravel-${itemId}`);
      world.setBlock(5, 40, 5, BlockId.Gravel);
      const gameplay = new ServerGameplay(world, new EventBus());
      Object.assign(gameplay, { random: () => roll });
      const player = playerNear(5, 40, 5);
      player.inventory.setSlot(0, createItemStack('wooden_shovel'));
      expect(gameplay.breakBlock(player, 5, 40, 5)).toEqual({ ok: true });
      expect(dropIds(gameplay)).toEqual([itemId]);
    }

    const hand = emptyWorld('gravel-hand');
    hand.setBlock(5, 40, 5, BlockId.Gravel);
    const handPlay = new ServerGameplay(hand, new EventBus());
    Object.assign(handPlay, { random: () => 0 });
    expect(handPlay.breakBlock(playerNear(5, 40, 5), 5, 40, 5).ok).toBe(true);
    expect(dropIds(handPlay)).toEqual(['flint']);
  });

  it('keeps the leaf block and adds a sapling about 20% of the time', () => {
    expect(LEAF_SAPLING_CHANCE).toBeCloseTo(0.2);
    const cases = [
      [BlockId.OakLeaves, 'oak_leaves', 'oak_sapling'],
      [BlockId.BirchLeaves, 'birch_leaves', 'birch_sapling'],
      [BlockId.SpruceLeaves, 'spruce_leaves', 'spruce_sapling'],
    ] as const;
    for (const [block, leaf, sapling] of cases) {
      const drop = getBlockDefinition(block).drop!;
      expect(rollBrokenBlockDrops(drop, () => 0).map((entry) => entry.item).sort())
        .toEqual([leaf, sapling].sort());
      expect(rollBrokenBlockDrops(drop, () => 0.2)).toEqual([{ item: leaf, count: 1 }]);

      const world = emptyWorld(leaf);
      world.setBlock(5, 40, 5, block);
      const gameplay = new ServerGameplay(world, new EventBus());
      Object.assign(gameplay, { random: () => 0 });
      expect(gameplay.breakBlock(playerNear(5, 40, 5), 5, 40, 5).ok).toBe(true);
      expect(dropIds(gameplay)).toEqual([leaf, sapling].sort());
    }
  });
});

describe('sapling placement and growth', () => {
  it('plants only on dirt, grass, farmland, or snow and records the plant time', () => {
    const world = emptyWorld('plant');
    const gameplay = new ServerGameplay(world, new EventBus());
    const player = playerNear(8, 40, 8);
    const raycast = vi.spyOn(world, 'raycast');
    const before = Date.now();

    world.setBlock(8, 39, 8, BlockId.Stone);
    player.inventory.setSlot(0, createItemStack('oak_sapling'));
    raycast.mockReturnValue({
      x: 8, y: 39, z: 8, block: BlockId.Stone, normal: new Vec3(0, 1, 0),
      point: new Vec3(8.5, 40, 8.5), distance: 2,
    });
    gameplay.useHeld(player);
    expect(world.getBlock(8, 40, 8, false)).toBe(BlockId.Air);
    expect(player.inventory.getSlot(0)?.itemId).toBe('oak_sapling');

    for (const ground of [BlockId.Dirt, BlockId.GrassBlock, BlockId.Farmland, BlockId.SnowBlock]) {
      world.setBlock(8, 39, 8, ground);
      world.setBlock(8, 40, 8, BlockId.Air);
      player.inventory.setSlot(0, createItemStack('birch_sapling'));
      raycast.mockReturnValue({
        x: 8, y: 39, z: 8, block: ground, normal: new Vec3(0, 1, 0),
        point: new Vec3(8.5, 40, 8.5), distance: 2,
      });
      expect(gameplay.useHeld(player).ok).toBe(true);
      expect(world.getBlock(8, 40, 8, false)).toBe(BlockId.BirchSapling);
      const plantedAt = world.getBlockState(8, 40, 8)?.plantedAtMs;
      expect(plantedAt).toBeGreaterThanOrEqual(before);
      expect(world.saplingPlantedAt.get('8,40,8')).toBe(plantedAt);
      world.setBlock(8, 40, 8, BlockId.Air);
    }
  });

  it('grows the matching tree after two real minutes and refuses to overwrite a build', () => {
    const world = emptyWorld('grow');
    const gameplay = new ServerGameplay(world, new EventBus());
    world.setBlock(8, 39, 8, BlockId.Dirt);
    world.setBlock(8, 40, 8, BlockId.OakSapling);
    world.setBlockState(8, 40, 8, { plantedAtMs: Date.now() });
    gameplay.consumeBlockChanges();
    world.tick();
    expect(world.getBlock(8, 40, 8, false)).toBe(BlockId.OakSapling);

    const height = grownTreeHeight('oak', 8, 8);
    world.setBlock(8, 40 + height - 1, 8, BlockId.Stone);
    expect(tryGrowSapling(world, 8, 40, 8, BlockId.OakSapling, 'oak')).toBe(false);
    expect(world.getBlock(8, 40, 8, false)).toBe(BlockId.OakSapling);
    expect(world.getBlock(8, 40 + height - 1, 8, false)).toBe(BlockId.Stone);
    world.setBlock(8, 40 + height - 1, 8, BlockId.Air);

    world.setBlockState(8, 40, 8, { plantedAtMs: Date.now() - SAPLING_GROW_MS });
    world.tick();
    expect(world.getBlock(8, 40, 8, false)).toBe(BlockId.OakLog);
    expect(world.getBlock(8, 41, 8, false)).toBe(BlockId.OakLog);
    expect(world.saplingPlantedAt.has('8,40,8')).toBe(false);
    expect(gameplay.consumeBlockChanges().some((change) => change.blockId === BlockId.OakLog)).toBe(true);

    const birch = emptyWorld('birch');
    birch.setBlock(8, 39, 8, BlockId.Dirt);
    birch.setBlock(8, 40, 8, BlockId.BirchSapling);
    birch.setBlockState(8, 40, 8, { plantedAtMs: 0 });
    birch.tick();
    expect(birch.getBlock(8, 40, 8, false)).toBe(BlockId.BirchLog);

    const spruce = emptyWorld('spruce');
    spruce.setBlock(8, 39, 8, BlockId.GrassBlock);
    spruce.setBlock(8, 40, 8, BlockId.SpruceSapling);
    spruce.setBlockState(8, 40, 8, { plantedAtMs: 0 });
    spruce.tick();
    expect(spruce.getBlock(8, 40, 8, false)).toBe(BlockId.SpruceLog);
  });

  it('keeps the remaining grow time across a world restore', () => {
    const world = emptyWorld('save');
    const plantedAt = Date.now();
    world.setBlock(8, 39, 8, BlockId.Dirt);
    world.setBlock(8, 40, 8, BlockId.OakSapling);
    world.setBlockState(8, 40, 8, { plantedAtMs: plantedAt });
    const saved = world.serializeBlockStates();

    const loaded = emptyWorld('load');
    loaded.setBlock(8, 39, 8, BlockId.Dirt);
    loaded.setBlock(8, 40, 8, BlockId.OakSapling);
    loaded.restore({
      timeOfDay: 0,
      modifications: {},
      chests: {},
      furnaces: {},
      blockStates: saved,
      signs: {},
    });
    expect(loaded.getBlockState(8, 40, 8)?.plantedAtMs).toBe(plantedAt);
    expect(loaded.saplingPlantedAt.get('8,40,8')).toBe(plantedAt);
    loaded.tick();
    expect(loaded.getBlock(8, 40, 8, false)).toBe(BlockId.OakSapling);

    loaded.setBlockState(8, 40, 8, { plantedAtMs: Date.now() - SAPLING_GROW_MS - 50 });
    const persisted = loaded.serializeBlockStates();
    const resumed = emptyWorld('resume');
    resumed.setBlock(8, 39, 8, BlockId.Dirt);
    resumed.setBlock(8, 40, 8, BlockId.OakSapling);
    resumed.restore({
      timeOfDay: 0,
      modifications: {},
      chests: {},
      furnaces: {},
      blockStates: persisted,
      signs: {},
    });
    resumed.tick();
    expect(resumed.getBlock(8, 40, 8, false)).toBe(BlockId.OakLog);
  });

  it('rejects a sapling with air under it through the shared placement helper', () => {
    const world = emptyWorld('air');
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('spruce_sapling'));
    const ctx = {
      world,
      inventory,
      selectedSlot: 0,
      gamemode: 'survival',
      reach: 6,
      eyePosition: () => new Vec3(8, 42, 8),
      viewDirection: () => new Vec3(0, -1, 0),
      yaw: 0,
      position: new Vec3(8, 42, 8),
      intersectsBlock: () => false,
      intersectsCollisionBoxes: () => false,
      foodUseTicks: 0,
      bowUseTicks: 0,
      minecarts: { raycast: () => undefined },
      redstone: { notifyBlockChanged: () => undefined },
    } as unknown as UseSimulationContext;
    const hit = {
      x: 8, y: 39, z: 8, block: BlockId.Air,
      normal: new Vec3(0, 1, 0),
      distance: 2,
      point: new Vec3(8.5, 40, 8.5),
    };
    expect(placeFromHit(ctx, hit, BlockId.SpruceSapling).ok).toBe(false);
    expect(world.getBlock(8, 40, 8, false)).toBe(BlockId.Air);
  });
});
