import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { CombatSystem } from '../../src/combat';
import { Inventory, createPortalChestInventory } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { PlayerController } from '../../src/player';
import { SurvivalSystem } from '../../src/survival';
import { Chunk } from '../../src/world/Chunk';
import { VoxelWorld } from '../../src/world/World';
import { EventBus } from '../../server/events';
import { ServerGameplay, type GameplayPlayer } from '../../server/gameplay';

function emptyWorld(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.chunks.set('0,0', new Chunk(0, 0));
  return world;
}

function playerNear(id: string, gamemode: 'survival' | 'creative' = 'survival'): GameplayPlayer {
  return {
    id, connected: true,
    controller: new PlayerController({ position: [5.5, 40, 6.5], yaw: 0, pitch: 0 }),
    inventory: new Inventory(), portalChest: createPortalChestInventory(), survival: new SurvivalSystem(), combat: new CombatSystem(),
    gamemode, selectedSlot: 0, cursor: null,
    craftSlots: [null, null, null, null], window: { kind: 'inventory' },
    miningTarget: { x: 5, y: 40, z: 5 }, miningProgress: 1,
    bowUseTicks: 0, foodUseTicks: 0, lastUse: false, lastSprint: false,
    vehicleForward: 0, inventoryDirty: false,
  };
}

function arm(player: GameplayPlayer): void {
  player.miningTarget = { x: 5, y: 40, z: 5 };
  player.miningProgress = 1;
}

function countDrops(gameplay: ServerGameplay, itemId: string): number {
  return gameplay.drops.entities
    .filter((entity) => entity.stack.itemId === itemId)
    .reduce((sum, entity) => sum + entity.stack.count, 0);
}

describe('authoritative leaf apples', () => {
  it('drops one apple on every fifth leaf and keeps saplings and the leaf itself', () => {
    const world = emptyWorld('leaf-apples');
    const gameplay = new ServerGameplay(world, new EventBus());
    Object.assign(gameplay, { random: () => 0 });
    const player = playerNear('miner');
    const leaves = [
      BlockId.OakLeaves, BlockId.OakLeaves, BlockId.BirchLeaves, BlockId.SpruceLeaves, BlockId.OakLeaves,
      BlockId.BirchLeaves, BlockId.BirchLeaves, BlockId.SpruceLeaves, BlockId.OakLeaves, BlockId.SpruceLeaves,
    ];
    for (const block of leaves) {
      world.setBlock(5, 40, 5, block);
      arm(player);
      expect(gameplay.breakBlock(player, 5, 40, 5)).toEqual({ ok: true });
    }
    expect(countDrops(gameplay, ItemId.Apple)).toBe(2);
    expect(player.leafBreaksTowardApple).toBe(0);
    expect(countDrops(gameplay, 'oak_leaves') + countDrops(gameplay, 'birch_leaves') + countDrops(gameplay, 'spruce_leaves')).toBe(10);
    expect(countDrops(gameplay, 'oak_sapling') + countDrops(gameplay, 'birch_sapling') + countDrops(gameplay, 'spruce_sapling')).toBe(10);
  });

  it('keeps a separate counter per player and ignores a counted batch shortcut', () => {
    const world = emptyWorld('leaf-players');
    const gameplay = new ServerGameplay(world, new EventBus());
    Object.assign(gameplay, { random: () => 1 });
    const first = playerNear('one');
    const second = playerNear('two');
    for (let index = 0; index < 4; index += 1) {
      world.setBlock(5, 40, 5, BlockId.OakLeaves);
      arm(first);
      expect(gameplay.breakBlock(first, 5, 40, 5).ok).toBe(true);
      world.setBlock(5, 40, 5, BlockId.BirchLeaves);
      arm(second);
      expect(gameplay.breakBlock(second, 5, 40, 5).ok).toBe(true);
    }
    expect(countDrops(gameplay, ItemId.Apple)).toBe(0);
    expect(first.leafBreaksTowardApple).toBe(4);
    expect(second.leafBreaksTowardApple).toBe(4);
    world.setBlock(5, 40, 5, BlockId.SpruceLeaves);
    arm(first);
    expect(gameplay.breakBlock(first, 5, 40, 5).ok).toBe(true);
    expect(countDrops(gameplay, ItemId.Apple)).toBe(1);
    expect(first.leafBreaksTowardApple).toBe(0);
    expect(second.leafBreaksTowardApple).toBe(4);
    expect(countDrops(gameplay, 'spruce_leaves')).toBe(1);
  });

  it('does not award apples for creative breaks, non-leaves, or a second break of air', () => {
    const world = emptyWorld('leaf-guards');
    const gameplay = new ServerGameplay(world, new EventBus());
    Object.assign(gameplay, { random: () => 0 });
    const creative = playerNear('creative', 'creative');
    for (let index = 0; index < 5; index += 1) {
      world.setBlock(5, 40, 5, BlockId.OakLeaves);
      arm(creative);
      expect(gameplay.breakBlock(creative, 5, 40, 5).ok).toBe(true);
    }
    expect(countDrops(gameplay, ItemId.Apple)).toBe(0);
    expect(creative.leafBreaksTowardApple ?? 0).toBe(0);

    const survival = playerNear('survival');
    for (let index = 0; index < 5; index += 1) {
      world.setBlock(5, 40, 5, BlockId.Dirt);
      arm(survival);
      expect(gameplay.breakBlock(survival, 5, 40, 5).ok).toBe(true);
    }
    expect(countDrops(gameplay, ItemId.Apple)).toBe(0);
    expect(survival.leafBreaksTowardApple ?? 0).toBe(0);
    expect(gameplay.breakBlock(survival, 5, 40, 5)).toEqual({ ok: false, reason: 'empty' });
    expect(countDrops(gameplay, ItemId.Apple)).toBe(0);
  });
});
