import { describe, expect, it } from 'vitest';
import {
  BlockId,
  breakTimeSeconds,
  canHarvestBlock,
  getBlockDefinition,
  miningProgressPerTick,
  miningToolFromItemId,
} from '../src/blocks';
import { ItemId, getItemDefinition } from '../src/items';

describe('Java 1.9-style mining', () => {
  it('harvests wood and dirt by hand, but not stone or ores', () => {
    expect(canHarvestBlock(getBlockDefinition(BlockId.OakLog))).toBe(true);
    expect(canHarvestBlock(getBlockDefinition(BlockId.Dirt))).toBe(true);
    expect(canHarvestBlock(getBlockDefinition(BlockId.Sand))).toBe(true);
    expect(canHarvestBlock(getBlockDefinition(BlockId.Stone))).toBe(false);
    expect(canHarvestBlock(getBlockDefinition(BlockId.IronOre))).toBe(false);
    expect(canHarvestBlock(getBlockDefinition(BlockId.Furnace))).toBe(false);
    expect(canHarvestBlock(getBlockDefinition(BlockId.Furnace), getItemDefinition(ItemId.WoodenPickaxe))).toBe(true);
  });

  it('matches 1.9 break times for the core alpha blocks', () => {
    const hand = undefined;
    const woodenAxe = getItemDefinition(ItemId.WoodenAxe);
    const woodenShovel = getItemDefinition(ItemId.WoodenShovel);
    const woodenPick = getItemDefinition(ItemId.WoodenPickaxe);
    const stonePick = getItemDefinition(ItemId.StonePickaxe);
    const ironPick = getItemDefinition(ItemId.IronPickaxe);

    expect(breakTimeSeconds(getBlockDefinition(BlockId.OakLog), hand)).toBeCloseTo(3, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.OakLog), woodenAxe)).toBeCloseTo(1.5, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.OakPlanks), hand)).toBeCloseTo(3, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.Dirt), hand)).toBeCloseTo(0.75, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.GrassBlock), hand)).toBeCloseTo(0.9, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.Sand), woodenShovel)).toBeCloseTo(0.4, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.Stone), hand)).toBeCloseTo(7.5, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.Stone), woodenPick)).toBeCloseTo(1.15, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.Stone), stonePick)).toBeCloseTo(0.6, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.Stone), ironPick)).toBeCloseTo(0.4, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.CoalOre), woodenPick)).toBeCloseTo(2.25, 1);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.Glass), hand)).toBeCloseTo(0.45, 5);
    expect(breakTimeSeconds(getBlockDefinition(BlockId.Torch), hand)).toBe(0);
  });

  it('applies the preferred-tool speed bonus without treating it as a harvest requirement', () => {
    const woodenAxe = miningToolFromItemId(ItemId.WoodenAxe);
    const handProgress = miningProgressPerTick(getBlockDefinition(BlockId.OakLog));
    const axeProgress = miningProgressPerTick(getBlockDefinition(BlockId.OakLog), woodenAxe);
    expect(axeProgress).toBeCloseTo(handProgress * 2, 8);
    expect(canHarvestBlock(getBlockDefinition(BlockId.OakLog), woodenAxe)).toBe(true);
  });
});
