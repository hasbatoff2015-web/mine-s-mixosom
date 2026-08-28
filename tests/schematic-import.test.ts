import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y, WORLD_HEIGHT } from '../src/core/constants';
import { VoxelWorld } from '../src/world/World';
import {
  ANARCHY_SPAWN_Y_SHIFT,
  applyVerticalShift,
  chooseVerticalOffset,
  encodeSpongeSchematicGzip,
  importSchematicIntoWorld,
  mapMinecraftBlock,
  parseMinecraftBlockId,
  parseSchematic,
  schematicIndex,
  SchematicHeightError,
} from '../src/world/import';

async function tinySpawnSchematic() {
  const width = 4;
  const height = 3;
  const length = 4;
  const palette = [
    'minecraft:air',
    'minecraft:stone',
    'minecraft:torch[facing=up]',
    'minecraft:completely_unknown_mod:foo',
    'minecraft:oak_stairs[facing=east,half=top,shape=straight]',
    'minecraft:lantern[hanging=true]',
    'minecraft:water[level=0]',
    'minecraft:jungle_log[axis=y]',
  ];
  const blocks = new Uint16Array(width * height * length);
  const set = (x: number, y: number, z: number, paletteIndex: number) => {
    blocks[schematicIndex(x, y, z, width, length)] = paletteIndex;
  };
  set(1, 0, 1, 1);
  set(2, 0, 1, 1);
  set(1, 1, 1, 2);
  set(2, 1, 1, 3);
  set(1, 0, 2, 4);
  set(2, 2, 1, 5);
  set(3, 0, 1, 6);
  set(0, 0, 1, 7);
  return encodeSpongeSchematicGzip({
    width,
    height,
    length,
    palette,
    blocks,
    entities: [{ id: 'minecraft:pig', x: 1, y: 1, z: 1 }],
    blockEntities: [{ id: 'minecraft:chest', x: 0, y: 0, z: 0 }],
  });
}

describe('schematic import', () => {
  it('parses dimensions, palette and varint block data', async () => {
    const parsed = await parseSchematic(await tinySpawnSchematic());
    expect(parsed.width).toBe(4);
    expect(parsed.height).toBe(3);
    expect(parsed.length).toBe(4);
    expect(parsed.palette).toContain('minecraft:stone');
    expect(parsed.blocks[schematicIndex(1, 0, 1, 4, 4)]).toBe(1);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.blockEntities[0]?.id).toBe('minecraft:chest');
  });

  it('maps supported blocks and replaces unsupported with diamond', () => {
    expect(mapMinecraftBlock('minecraft:stone').block).toBe(BlockId.Stone);
    expect(mapMinecraftBlock('minecraft:glowstone').block).toBe(BlockId.Glowstone);
    expect(mapMinecraftBlock('minecraft:lantern[hanging=true]')).toMatchObject({
      block: BlockId.Lantern,
      supported: true,
      state: { attachment: 'ceiling' },
    });
    const stairs = mapMinecraftBlock('minecraft:oak_stairs[facing=east,half=top]');
    expect(stairs.block).toBe(BlockId.OakStairs);
    expect(stairs.state).toMatchObject({ facing: 'east', stairHalf: 'top' });
    const unknown = mapMinecraftBlock('minecraft:completely_unknown_mod:foo');
    expect(unknown.block).toBe(BlockId.DiamondBlock);
    expect(unknown.supported).toBe(false);
    expect(parseMinecraftBlockId('minecraft:rail[shape=east_west]').states.shape).toBe('east_west');
  });

  it('maps jungle log and wood to oak log, not diamond and not planks', () => {
    const cases = [
      'minecraft:jungle_log',
      'minecraft:jungle_log[axis=y]',
      'minecraft:jungle_wood',
      'minecraft:jungle_wood[axis=x]',
      'minecraft:stripped_jungle_log',
      'minecraft:stripped_jungle_wood',
      'minecraft:log[variant=jungle,axis=y]',
      'minecraft:wood[variant=jungle]',
    ];
    for (const raw of cases) {
      const mapped = mapMinecraftBlock(raw);
      expect(mapped.block, raw).toBe(BlockId.OakLog);
      expect(mapped.block, raw).not.toBe(BlockId.OakPlanks);
      expect(mapped.block, raw).not.toBe(BlockId.DiamondBlock);
      expect(mapped.supported, raw).toBe(true);
      expect(mapped.jungleToOak, raw).toBe(true);
    }
    const stillDiamond = mapMinecraftBlock('minecraft:andesite');
    expect(stillDiamond.block).toBe(BlockId.DiamondBlock);
    expect(stillDiamond.supported).toBe(false);
    expect(stillDiamond.jungleToOak).toBeUndefined();
  });

  it('chooses a Y translation that stays inside 0..255', () => {
    const fit = chooseVerticalOffset(10, 40, 66);
    expect(fit.lowestWorldY).toBeGreaterThanOrEqual(MIN_WORLD_Y);
    expect(fit.highestWorldY).toBeLessThanOrEqual(MAX_WORLD_Y);
    expect(fit.offsetY + 10).toBe(fit.lowestWorldY);
    expect(() => chooseVerticalOffset(0, WORLD_HEIGHT, 0)).toThrow(SchematicHeightError);
  });

  it('shifts the whole structure by -28 without changing X/Z and without cropping', () => {
    const base = chooseVerticalOffset(0, 40, 66);
    const shifted = applyVerticalShift(base, ANARCHY_SPAWN_Y_SHIFT);
    expect(ANARCHY_SPAWN_Y_SHIFT).toBe(-28);
    expect(shifted.offsetY).toBe(base.offsetY - 28);
    expect(shifted.lowestWorldY).toBe(base.lowestWorldY - 28);
    expect(shifted.highestWorldY).toBe(base.highestWorldY - 28);
    expect(shifted.lowestWorldY).toBeGreaterThanOrEqual(MIN_WORLD_Y);
    expect(shifted.highestWorldY).toBeLessThanOrEqual(MAX_WORLD_Y);
    expect(() => applyVerticalShift(chooseVerticalOffset(0, 2, 10), -28)).toThrow(SchematicHeightError);
  });

  it('places mapped voxels into chunks, dedupes affected chunks and skips entities', async () => {
    const world = new VoxelWorld('import-place');
    const schematic = await parseSchematic(await tinySpawnSchematic());
    const report = importSchematicIntoWorld(world, schematic, 20);
    expect(report.totalCells).toBe(4 * 3 * 4);
    expect(report.unsupportedToDiamond).toBeGreaterThan(0);
    expect(report.replacements['minecraft:completely_unknown_mod:foo']).toBe(1);
    expect(report.jungleToOak).toBe(1);
    expect(report.jungleReplacements['minecraft:jungle_log']).toBe(1);
    expect(report.skippedEntities).toEqual(['minecraft:pig']);
    expect(report.skippedBlockEntities).toEqual(['minecraft:chest']);
    expect(report.lowestImportedY).toBeGreaterThanOrEqual(0);
    expect(report.highestImportedY).toBeLessThanOrEqual(255);
    expect(report.affectedChunks).toBeGreaterThan(0);
    expect(report.offset[0]).toBe(0);
    expect(report.offset[2]).toBe(0);
    expect(world.getBlock(1, report.offset[1], 1)).toBe(BlockId.Stone);
    expect(world.getBlock(2, report.offset[1] + 1, 1)).toBe(BlockId.DiamondBlock);
    expect(world.getBlock(1, report.offset[1] + 1, 1)).toBe(BlockId.Torch);
    expect(world.getBlock(0, report.offset[1], 1)).toBe(BlockId.OakLog);
    expect(world.getBlock(0, report.offset[1], 1)).not.toBe(BlockId.OakPlanks);
    expect(world.getBlockState(1, report.offset[1], 2)).toMatchObject({ facing: 'east', stairHalf: 'top' });
    expect(world.getBlock(2, report.offset[1] + 2, 1)).toBe(BlockId.Lantern);
    expect(world.getBlockState(2, report.offset[1] + 2, 1)).toMatchObject({ attachment: 'ceiling' });
    const chunk = world.getChunk(0, 0, false)!;
    expect(chunk.skyReady).toBe(false);
    expect(chunk.dirty).toBe(true);
  });

  it('applies Anarchy Y-28 on import and shifts the player spawn with the structure', async () => {
    const schematic = await parseSchematic(await tinySpawnSchematic());
    const unshiftedWorld = new VoxelWorld('import-y-shift-compare');
    const shiftedWorld = new VoxelWorld('import-y-shift-compare');
    const unshifted = importSchematicIntoWorld(unshiftedWorld, schematic, 66);
    const shifted = importSchematicIntoWorld(shiftedWorld, schematic, 66, { yShift: ANARCHY_SPAWN_Y_SHIFT });
    expect(shifted.yShift).toBe(-28);
    expect(shifted.baseOffset[1]).toBe(unshifted.offset[1]);
    expect(shifted.offset[0]).toBe(0);
    expect(shifted.offset[2]).toBe(0);
    expect(unshifted.offset[0]).toBe(0);
    expect(unshifted.offset[2]).toBe(0);
    expect(shifted.offset[1]).toBe(unshifted.offset[1] - 28);
    expect(shifted.lowestImportedY).toBe(unshifted.lowestImportedY - 28);
    expect(shifted.highestImportedY).toBe(unshifted.highestImportedY - 28);
    expect(shifted.lowestImportedY).toBeGreaterThanOrEqual(0);
    expect(shifted.highestImportedY).toBeLessThanOrEqual(255);
    expect(shifted.spawn[0]).toBe(unshifted.spawn[0]);
    expect(shifted.spawn[2]).toBe(unshifted.spawn[2]);
    expect(shifted.spawn[1]).toBeCloseTo(unshifted.spawn[1] - 28, 5);
    expect(shiftedWorld.getBlock(1, shifted.offset[1], 1)).toBe(BlockId.Stone);
    expect(shiftedWorld.getBlock(0, shifted.offset[1], 1)).toBe(BlockId.OakLog);
  });

  it('preserves imported high blocks across save/load', async () => {
    const world = new VoxelWorld('import-persist');
    const schematic = await parseSchematic(await tinySpawnSchematic());
    const report = importSchematicIntoWorld(world, schematic, 66, { yShift: ANARCHY_SPAWN_Y_SHIFT });
    const snapshot = {
      timeOfDay: world.timeOfDay,
      modifications: world.serializeModifications(),
      chests: {},
      furnaces: {},
      blockStates: world.serializeBlockStates(),
    };
    const restored = new VoxelWorld('import-persist');
    restored.restore(snapshot);
    expect(report.offset[1]).toBe(report.baseOffset[1] - 28);
    expect(restored.getBlock(1, report.offset[1], 1)).toBe(BlockId.Stone);
    expect(restored.getBlock(2, report.offset[1] + 1, 1)).toBe(BlockId.DiamondBlock);
    expect(restored.getBlock(0, report.offset[1], 1)).toBe(BlockId.OakLog);
    expect(restored.getBlockState(1, report.offset[1], 2)?.facing).toBe('east');
  });
});
