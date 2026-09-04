import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../../src/blocks';
import { CombatSystem } from '../../src/combat';
import { Inventory, createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { Vec3 } from '../../src/math/vec3';
import { PlayerController } from '../../src/player';
import { SurvivalSystem } from '../../src/survival';
import { Chunk } from '../../src/world/Chunk';
import { VoxelWorld } from '../../src/world/World';
import { EventBus } from '../../server/events';
import { ServerGameplay, type GameplayPlayer } from '../../server/gameplay';

function playerNear(x: number, y: number, z: number): GameplayPlayer {
  return {
    id: 'farmer', connected: true,
    controller: new PlayerController({ position: [x + 0.5, y, z + 1.5], yaw: 0, pitch: 0 }),
    inventory: new Inventory(), survival: new SurvivalSystem(), combat: new CombatSystem(),
    gamemode: 'survival', selectedSlot: 0, cursor: null,
    craftSlots: [null, null, null, null], window: { kind: 'inventory' },
    miningTarget: { x, y, z }, miningProgress: 1,
    bowUseTicks: 0, foodUseTicks: 0, lastUse: false, lastSprint: false,
    vehicleForward: 0, inventoryDirty: false,
  };
}

describe('Anarchy farming authority', () => {
  it('authoritatively tills, plants, and applies bone meal with one inventory mutation', () => {
    const world = new VoxelWorld('server-farm-use');
    world.chunks.set('0,0', new Chunk(0, 0));
    world.setBlock(5, 40, 5, BlockId.Dirt);
    world.setBlock(6, 40, 5, BlockId.Water);
    const gameplay = new ServerGameplay(world, new EventBus());
    Object.assign(gameplay, { random: () => 0 });
    const player = playerNear(5, 40, 5);
    const raycast = vi.spyOn(world, 'raycast');

    player.inventory.setSlot(0, createItemStack(ItemId.WoodenHoe));
    raycast.mockReturnValue({
      x: 5, y: 40, z: 5, block: BlockId.Dirt, normal: new Vec3(0, 1, 0),
      point: new Vec3(5.5, 41, 5.5), distance: 2,
    });
    gameplay.useHeld(player);
    expect(world.getBlock(5, 40, 5, false)).toBe(BlockId.Farmland);
    expect(world.getBlockState(5, 40, 5)).toEqual({ hydrated: true });
    expect(player.inventory.getSlot(0)?.durability).toBe(58);
    expect(gameplay.consumeBlockChanges()).toEqual([
      { x: 5, y: 40, z: 5, blockId: BlockId.Farmland, state: { hydrated: true } },
    ]);

    player.inventory.setSlot(0, createItemStack(ItemId.WheatSeeds, 2));
    raycast.mockReturnValue({
      x: 5, y: 40, z: 5, block: BlockId.Farmland, normal: new Vec3(0, 1, 0),
      point: new Vec3(5.5, 41, 5.5), distance: 2,
    });
    gameplay.useHeld(player);
    expect(player.inventory.getSlot(0)?.count).toBe(1);
    expect(gameplay.consumeBlockChanges()).toEqual([
      { x: 5, y: 41, z: 5, blockId: BlockId.WheatCrop, state: { age: 0 } },
    ]);

    player.inventory.setSlot(0, createItemStack(ItemId.BoneMeal, 2));
    raycast.mockReturnValue({
      x: 5, y: 41, z: 5, block: BlockId.WheatCrop, normal: new Vec3(0, 1, 0),
      point: new Vec3(5.5, 42, 5.5), distance: 2,
    });
    gameplay.useHeld(player);
    expect(world.getBlockState(5, 41, 5)).toEqual({ age: 2 });
    expect(player.inventory.getSlot(0)?.count).toBe(1);
    expect(gameplay.consumeBlockChanges()).toEqual([
      { x: 5, y: 41, z: 5, blockId: BlockId.WheatCrop, state: { age: 2 } },
    ]);
  });

  it('publishes one canonical state change for a server growth pulse', () => {
    const world = new VoxelWorld('server-farm-pulse');
    world.chunks.set('0,0', new Chunk(0, 0));
    world.setBlock(5, 40, 5, BlockId.Farmland);
    world.setBlockState(5, 40, 5, { hydrated: true });
    world.setBlock(4, 40, 5, BlockId.Water);
    world.setBlock(5, 41, 5, BlockId.CarrotCrop);
    world.setBlockState(5, 41, 5, { age: 0 });
    const gameplay = new ServerGameplay(world, new EventBus());
    Object.assign(gameplay.farming, { random: () => 0 });
    world.tickNumber = 1_200;
    expect(gameplay.farming.tick([{ x: 5, z: 5 }]).stateWrites).toBe(1);
    expect(gameplay.consumeBlockChanges()).toEqual([
      { x: 5, y: 41, z: 5, blockId: BlockId.CarrotCrop, state: { age: 1 } },
    ]);
  });

  it('accepts one of two harvest attempts and emits one authoritative block delta', () => {
    const world = new VoxelWorld('server-farm-race');
    world.chunks.set('0,0', new Chunk(0, 0));
    world.applyBlockBatch([{ x: 5, y: 40, z: 5, block: BlockId.WheatCrop }], {
      updateLighting: false, scheduleNeighbors: false,
    });
    world.setBlockState(5, 40, 5, { age: 7 });
    const gameplay = new ServerGameplay(world, new EventBus());
    const player = playerNear(5, 40, 5);

    expect(gameplay.breakBlock(player, 5, 40, 5)).toEqual({ ok: true });
    player.miningTarget = { x: 5, y: 40, z: 5 };
    player.miningProgress = 1;
    expect(gameplay.breakBlock(player, 5, 40, 5)).toEqual({ ok: false, reason: 'empty' });
    const changes = gameplay.consumeBlockChanges();
    expect(changes).toEqual([{ x: 5, y: 40, z: 5, blockId: BlockId.Air }]);
    expect(gameplay.drops.count).toBe(2);
  });

  it('coalesces farming state into the same live block-update path', () => {
    const world = new VoxelWorld('server-farm-state');
    world.chunks.set('0,0', new Chunk(0, 0));
    const gameplay = new ServerGameplay(world, new EventBus());
    world.setBlock(4, 40, 4, BlockId.Farmland);
    world.setBlockState(4, 40, 4, { hydrated: true });
    expect(gameplay.consumeBlockChanges()).toEqual([
      { x: 4, y: 40, z: 4, blockId: BlockId.Farmland, state: { hydrated: true } },
    ]);
  });

  it('keeps Creative harvest free of Survival drops', () => {
    const world = new VoxelWorld('server-farm-creative');
    world.chunks.set('0,0', new Chunk(0, 0));
    world.setBlock(5, 40, 5, BlockId.Melon);
    const gameplay = new ServerGameplay(world, new EventBus());
    const player = playerNear(5, 40, 5);
    player.gamemode = 'creative';
    expect(gameplay.breakBlock(player, 5, 40, 5)).toEqual({ ok: true });
    expect(gameplay.drops.count).toBe(0);
  });
});
