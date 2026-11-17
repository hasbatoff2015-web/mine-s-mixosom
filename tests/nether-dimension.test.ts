import { describe, expect, it } from 'vitest';
import { BlockId, canHarvestBlock, getBlockDefinition, miningToolFromItemId } from '../src/blocks';
import { ItemId } from '../src/items';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { NetherGenerator } from '../src/world/NetherGenerator';
import { findNetherPortalFrame, lightNetherPortal, sweepInvalidPortals } from '../src/world/netherPortal';
import { enchantmentFlowerDrops, ENCHANTMENT_FLOWER_GROW_MS } from '../src/world/enchantmentFlower';
import { dimensionFromStoredWorldId, dimensionWorldId, parseDimension } from '../src/world/dimension';
import { isLiveFire } from '../src/blocks/fireBlocks';
import { HOSTILE_KINDS } from '../src/entities/MobManager';

function columnSolid(world: VoxelWorld, x: number, z: number): { bedrock: boolean; gap: boolean; surface: number } {
  let surface = 0;
  let gap = false;
  let seenSolid = false;
  for (let y = 255; y >= 0; y -= 1) {
    const block = world.getBlock(x, y, z);
    if (block === BlockId.Air || block === BlockId.EnchantmentFlower || block === BlockId.SoulFire
      || block === BlockId.NetherMushroomCap || block === BlockId.NetherMushroomStem) continue;
    if (!seenSolid) {
      surface = y;
      seenSolid = true;
      continue;
    }
    if (block === BlockId.Air) gap = true;
  }
  return { bedrock: world.getBlock(x, 0, z) === BlockId.Bedrock, gap, surface };
}

describe('nether dimension', () => {
  it('keeps old saves in the overworld and separates claim ids', () => {
    expect(parseDimension(undefined)).toBe('overworld');
    expect(parseDimension('nope')).toBe('overworld');
    expect(parseDimension('nether')).toBe('nether');
    expect(dimensionWorldId('anarchy', 'overworld')).toBe('anarchy');
    expect(dimensionWorldId('anarchy', 'nether')).toBe('anarchy:nether');
    expect(dimensionFromStoredWorldId('anarchy')).toBe('overworld');
    expect(dimensionFromStoredWorldId('anarchy:nether')).toBe('nether');
  });

  it('generates a solid deterministic nether without caves', () => {
    const first = new NetherGenerator('mega-seed');
    const second = new NetherGenerator('mega-seed');
    const a = new Chunk(3, -2);
    const b = new Chunk(3, -2);
    first.generate(a);
    second.generate(b);
    expect(Array.from(a.blocks)).toEqual(Array.from(b.blocks));
    const world = new VoxelWorld('mega-seed', 'nether');
    world.getChunk(0, 0);
    world.getChunk(1, 0);
    let soul = 0;
    let flowers = 0;
    let lavaAbove = 0;
    for (let x = 0; x < 32; x += 1) {
      for (let z = 0; z < 16; z += 1) {
        const column = columnSolid(world, x, z);
        expect(column.bedrock).toBe(true);
        expect(column.gap).toBe(false);
        expect(world.generator.isCave(x, 8, z, column.surface)).toBe(false);
        for (let y = 1; y <= column.surface; y += 1) {
          const block = world.getBlock(x, y, z);
          if (block === BlockId.Air) {
            const below = world.getBlock(x, y - 1, z);
            if (below === BlockId.Lava) {
              for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const side = world.getBlock(x + dx, y - 1, z + dz);
                if (side === BlockId.Air) lavaAbove += 1;
              }
            }
          }
          if (block === BlockId.SoulSand) {
            soul += 1;
            if (world.getBlock(x, y + 1, z) === BlockId.EnchantmentFlower) flowers += 1;
          }
        }
      }
    }
    expect(lavaAbove).toBe(0);
    expect(flowers).toBe(soul);
  });

  it('lights a cornerless obsidian frame on both axes and drops it when the frame breaks', () => {
    const world = new VoxelWorld('portal', 'overworld');
    const place = (x: number, y: number, z: number) => world.setBlock(x, y, z, BlockId.Obsidian);
    const base = 220;
    for (let y = base + 1; y <= base + 3; y += 1) {
      place(0, y, 0);
      place(3, y, 0);
    }
    place(1, base, 0);
    place(2, base, 0);
    place(1, base + 4, 0);
    place(2, base + 4, 0);
    expect(findNetherPortalFrame(world, 1, base + 1, 0)?.axis).toBe('z');
    expect(lightNetherPortal(world, 1, base + 2, 0)?.cells).toHaveLength(6);
    expect(world.getBlock(1, base + 1, 0)).toBe(BlockId.NetherPortal);
    world.setBlock(0, base + 2, 0, BlockId.Air);
    expect(sweepInvalidPortals(world, 1, base + 2, 0)).toBeGreaterThan(0);
    expect(world.getBlock(1, base + 1, 0)).toBe(BlockId.Air);

    for (let y = base + 1; y <= base + 3; y += 1) {
      place(8, y, 0);
      place(8, y, 3);
    }
    place(8, base, 1);
    place(8, base, 2);
    place(8, base + 4, 1);
    place(8, base + 4, 2);
    expect(findNetherPortalFrame(world, 8, base + 2, 1)?.axis).toBe('x');
  });

  it('mines mythril only with a titanium pickaxe and rolls flower loot', () => {
    const ore = getBlockDefinition(BlockId.MythrilOre);
    expect(canHarvestBlock(ore, null)).toBe(false);
    expect(canHarvestBlock(ore, miningToolFromItemId(ItemId.DiamondPickaxe))).toBe(false);
    expect(canHarvestBlock(ore, miningToolFromItemId(ItemId.IronPickaxe))).toBe(false);
    expect(canHarvestBlock(ore, miningToolFromItemId(ItemId.TitaniumPickaxe))).toBe(true);
    expect(enchantmentFlowerDrops(BlockId.EnchantmentFlower, { age: 0 }, () => 0)).toEqual([]);
    expect(enchantmentFlowerDrops(BlockId.EnchantmentFlower, undefined, () => 0.1)).toEqual([
      { item: ItemId.EnchantmentFlower, count: 1 },
    ]);
    expect(enchantmentFlowerDrops(BlockId.EnchantmentFlower, { age: 1 }, () => 0.9)).toEqual([
      { item: ItemId.EnchantmentFlower, count: 2 },
    ]);
    expect(isLiveFire(BlockId.SoulFire)).toBe(true);
    expect(isLiveFire(BlockId.Fire)).toBe(true);
    expect(ENCHANTMENT_FLOWER_GROW_MS).toBe(12 * 60 * 1000);
    expect(HOSTILE_KINDS.includes('nether_skeleton' as never)).toBe(false);
  });
});
