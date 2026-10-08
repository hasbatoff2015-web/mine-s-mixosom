import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { Inventory, createPortalChestInventory } from '../src/inventory';
import { ItemId, isCollectiblePaintingItemId } from '../src/items';
import { CombatSystem } from '../src/combat';
import { PlayerController } from '../src/player';
import { SurvivalSystem } from '../src/survival';
import { Chunk } from '../src/world/Chunk';
import { destroyedToMutations, resolveExplosion } from '../src/world/Explosion';
import { VoxelWorld } from '../src/world/World';
import { EventBus } from '../server/events';
import { ServerGameplay, type GameplayPlayer } from '../server/gameplay';

function world(): VoxelWorld {
  const next = new VoxelWorld('painting-explosion');
  next.chunks.set('0,0', new Chunk(0, 0));
  return next;
}

function hang(
  voxels: VoxelWorld,
  x: number,
  y: number,
  z: number,
  itemId: string,
  facing: 'east' | 'south' = 'east',
): void {
  voxels.setBlock(x, y, z, BlockId.CollectiblePainting);
  voxels.setBlockState(x, y, z, { attachment: 'wall', facing, paintingItemId: itemId });
}

function gameplayFor(voxels: VoxelWorld): ServerGameplay {
  return new ServerGameplay(voxels, new EventBus());
}

function tick(gameplay: ServerGameplay, players: readonly GameplayPlayer[] = []): void {
  gameplay.tick(players, 0.05, { tickPlayers: () => undefined });
}

function paintingDrops(gameplay: ServerGameplay): Array<{ itemId: string; count: number }> {
  return gameplay.drops.entities.map((entity) => ({
    itemId: entity.stack.itemId,
    count: entity.stack.count,
  }));
}

function creativePlayer(): GameplayPlayer {
  return {
    id: 'creative',
    connected: true,
    controller: new PlayerController({ position: [5.5, 40, 7], yaw: 0, pitch: 0 }),
    inventory: new Inventory(),
    portalChest: createPortalChestInventory(),
    survival: new SurvivalSystem(),
    combat: new CombatSystem(),
    gamemode: 'creative',
    selectedSlot: 0,
    cursor: null,
    craftSlots: [null, null, null, null],
    window: { kind: 'inventory' },
    miningTarget: { x: 5, y: 40, z: 5 },
    miningProgress: 0,
    bowUseTicks: 0,
    foodUseTicks: 0,
    lastUse: false,
    lastSprint: false,
    vehicleForward: 0,
    inventoryDirty: false,
  };
}

describe('collectible painting explosion drops', () => {
  it('drops the exact held variant when the blast destroys the painting', () => {
    const voxels = world();
    voxels.setBlock(5, 40, 5, BlockId.Stone);
    hang(voxels, 6, 40, 5, ItemId.Painting03SunsetCat);
    const gameplay = gameplayFor(voxels);
    const dropped: string[] = [];
    gameplay.events.on('itemDrop', (event) => {
      dropped.push(event.itemId);
    });
    gameplay.explosions.enqueue({ x: 6.5, y: 40.5, z: 5.5, radius: 3, power: 8 });
    tick(gameplay, [creativePlayer()]);
    tick(gameplay, [creativePlayer()]);
    expect(voxels.getBlock(6, 40, 5, false)).toBe(BlockId.Air);
    expect(paintingDrops(gameplay)).toEqual([{ itemId: ItemId.Painting03SunsetCat, count: 1 }]);
    expect(dropped).toEqual([ItemId.Painting03SunsetCat]);
    expect(paintingDrops(gameplay).some((drop) => drop.itemId === 'collectible_painting')).toBe(false);
  });

  it('keeps a second variant instead of a generic painting', () => {
    const voxels = world();
    voxels.setBlock(5, 40, 5, BlockId.Stone);
    hang(voxels, 6, 40, 5, ItemId.Painting20TigerMusya);
    const gameplay = gameplayFor(voxels);
    gameplay.explosions.enqueue({ x: 6.5, y: 40.5, z: 5.5, radius: 3, power: 8 });
    tick(gameplay);
    tick(gameplay);
    expect(paintingDrops(gameplay)).toEqual([{ itemId: ItemId.Painting20TigerMusya, count: 1 }]);
  });

  it('drops the painting once when only the support is destroyed', () => {
    const voxels = world();
    voxels.setBlock(5, 40, 5, BlockId.Stone);
    hang(voxels, 6, 40, 5, ItemId.Painting09RainbowGhast);
    const gameplay = gameplayFor(voxels);
    gameplay.explosions.enqueue({ x: 5.5, y: 40.5, z: 5.5, radius: 0.8, power: 4 });
    tick(gameplay);
    expect(voxels.getBlock(5, 40, 5, false)).toBe(BlockId.Air);
    expect(voxels.getBlock(6, 40, 5, false)).toBe(BlockId.CollectiblePainting);
    expect(paintingDrops(gameplay)).toEqual([]);
    tick(gameplay);
    expect(voxels.getBlock(6, 40, 5, false)).toBe(BlockId.Air);
    expect(paintingDrops(gameplay)).toEqual([{ itemId: ItemId.Painting09RainbowGhast, count: 1 }]);
  });

  it('drops one item when the same blast destroys the support and the painting', () => {
    const voxels = world();
    voxels.setBlock(5, 40, 5, BlockId.Stone);
    hang(voxels, 6, 40, 5, ItemId.Painting11CrowdScream);
    const gameplay = gameplayFor(voxels);
    gameplay.explosions.enqueue({ x: 5.5, y: 40.5, z: 5.5, radius: 3, power: 8 });
    tick(gameplay);
    expect(voxels.getBlock(5, 40, 5, false)).toBe(BlockId.Air);
    expect(voxels.getBlock(6, 40, 5, false)).toBe(BlockId.Air);
    expect(paintingDrops(gameplay)).toEqual([{ itemId: ItemId.Painting11CrowdScream, count: 1 }]);
    expect(paintingDrops(gameplay).every((drop) => isCollectiblePaintingItemId(drop.itemId))).toBe(true);
    tick(gameplay);
    expect(paintingDrops(gameplay)).toEqual([{ itemId: ItemId.Painting11CrowdScream, count: 1 }]);
  });

  it('does not drop a painting the blast is not allowed to destroy', () => {
    const voxels = world();
    voxels.setBlock(5, 40, 5, BlockId.Stone);
    hang(voxels, 6, 40, 5, ItemId.Painting01VillagerHmm);
    const gameplay = gameplayFor(voxels);
    gameplay.explosions.enqueue({
      x: 6.5, y: 40.5, z: 5.5, radius: 3, power: 8,
      canDestroy: () => false,
    });
    tick(gameplay);
    tick(gameplay);
    expect(voxels.getBlock(6, 40, 5, false)).toBe(BlockId.CollectiblePainting);
    expect(voxels.getBlockState(6, 40, 5)?.paintingItemId).toBe(ItemId.Painting01VillagerHmm);
    expect(paintingDrops(gameplay)).toEqual([]);
  });

  it('destroys a painting with a missing or unknown id without minting an item', () => {
    const voxels = world();
    voxels.setBlock(5, 40, 5, BlockId.CollectiblePainting);
    voxels.setBlock(7, 40, 5, BlockId.CollectiblePainting);
    voxels.setBlockState(7, 40, 5, { attachment: 'wall', facing: 'south', paintingItemId: 'not_a_painting' });
    const gameplay = gameplayFor(voxels);
    gameplay.explosions.enqueue({ x: 6.5, y: 40.5, z: 5.5, radius: 3, power: 8 });
    expect(() => {
      tick(gameplay);
      tick(gameplay);
    }).not.toThrow();
    expect(voxels.getBlock(5, 40, 5, false)).toBe(BlockId.Air);
    expect(voxels.getBlock(7, 40, 5, false)).toBe(BlockId.Air);
    expect(paintingDrops(gameplay)).toEqual([]);
  });

  it('drops each destroyed painting once and never stacks past maxStack 1', () => {
    const voxels = world();
    hang(voxels, 5, 40, 5, ItemId.Painting02NightGuardian, 'south');
    hang(voxels, 7, 40, 5, ItemId.Painting04GrassCat, 'south');
    hang(voxels, 5, 42, 5, ItemId.Painting07SunnyBee, 'south');
    hang(voxels, 8, 40, 5, ItemId.Painting07SunnyBee, 'south');
    const gameplay = gameplayFor(voxels);
    gameplay.explosions.enqueue({ x: 6.5, y: 41, z: 5.5, radius: 4, power: 8 });
    gameplay.explosions.enqueue({ x: 6.5, y: 41, z: 5.5, radius: 4, power: 8 });
    tick(gameplay);
    tick(gameplay);
    const drops = paintingDrops(gameplay);
    expect(drops).toHaveLength(4);
    expect(drops.every((drop) => drop.count === 1)).toBe(true);
    expect(drops.map((drop) => drop.itemId).sort()).toEqual([
      ItemId.Painting02NightGuardian,
      ItemId.Painting04GrassCat,
      ItemId.Painting07SunnyBee,
      ItemId.Painting07SunnyBee,
    ].sort());
  });

  it('keeps the pre-mutation painting id after the world cell is cleared', () => {
    const voxels = world();
    voxels.setBlock(4, 40, 4, BlockId.Stone);
    hang(voxels, 5, 40, 4, ItemId.Painting16GrassSteve);
    const result = resolveExplosion(voxels, { x: 5.5, y: 40.5, z: 4.5, radius: 2, power: 8 }, { random: () => 1 });
    const painting = result.destroyed.find((entry) => entry.previous === BlockId.CollectiblePainting);
    expect(painting?.previousState?.paintingItemId).toBe(ItemId.Painting16GrassSteve);
    voxels.applyBlockBatch(destroyedToMutations(result.destroyed));
    expect(voxels.getBlock(5, 40, 4, false)).toBe(BlockId.Air);
    expect(voxels.getBlockState(5, 40, 4)).toBeUndefined();
    expect(painting?.previousState?.paintingItemId).toBe(ItemId.Painting16GrassSteve);
  });

  it('uses the same previousState snapshot in the local explosion path', () => {
    const source = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    const server = readFileSync(new URL('../server/gameplay.ts', import.meta.url), 'utf8');
    expect(source).toContain('collectiblePaintingDropItemId(block.previous, block.previousState)');
    expect(server).toContain('collectiblePaintingDropItemId(entry.previous, entry.previousState)');
    const localDrop = source.slice(
      source.indexOf('private processExplosionQueue'),
      source.indexOf('private applyExplosionDamage'),
    );
    expect(localDrop).toContain('collectiblePaintingDropItemId(block.previous, block.previousState)');
    expect(localDrop).not.toContain("summary.mode === 'creative'");
  });
});
