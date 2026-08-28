import { BlockId, getBlockDefinition, type BlockRenderState } from '../../blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y, SEA_LEVEL } from '../../core/constants';
import type { VoxelWorld } from '../World';
import { STONE_CAP_TOP_Y } from '../Generator';
import { mapPalette, type MappedFrontierBlock } from './blockMapper';
import { schematicIndex, type ParsedSchematic } from './schematic';

export interface ImportedVoxel {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockId;
  readonly state?: BlockRenderState;
}

export interface VerticalFit {
  readonly offsetY: number;
  readonly lowestWorldY: number;
  readonly highestWorldY: number;
}

export interface ImportReport {
  readonly width: number;
  readonly height: number;
  readonly length: number;
  readonly totalCells: number;
  readonly nonAirBlocks: number;
  readonly mappedBlocks: number;
  readonly unsupportedToDiamond: number;
  readonly jungleToOak: number;
  readonly jungleReplacements: Record<string, number>;
  readonly cocoaToAir: number;
  readonly cocoaReplacements: Record<string, number>;
  readonly replacements: Record<string, number>;
  readonly skippedEntities: readonly string[];
  readonly skippedBlockEntities: readonly string[];
  /** Placement before `yShift` (Anarchy spawn is then moved by `ANARCHY_SPAWN_Y_SHIFT`). */
  readonly baseOffset: readonly [number, number, number];
  readonly yShift: number;
  readonly offset: readonly [number, number, number];
  readonly lowestImportedY: number;
  readonly highestImportedY: number;
  readonly affectedChunks: number;
  readonly applied: number;
}

export interface ImportPlacementOptions {
  readonly yShift?: number;
}

export class SchematicHeightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchematicHeightError';
  }
}

export function extentOfNonAir(schematic: ParsedSchematic): {
  lowest: number;
  highest: number;
  nonAir: number;
} {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  let nonAir = 0;
  const airIndexes = new Set<number>();
  for (let i = 0; i < schematic.palette.length; i += 1) {
    const name = schematic.palette[i] ?? '';
    if (name === 'minecraft:air' || name === 'air' || name.endsWith(':cave_air') || name.endsWith(':void_air')) {
      airIndexes.add(i);
    }
  }
  for (let y = 0; y < schematic.height; y += 1) {
    for (let z = 0; z < schematic.length; z += 1) {
      for (let x = 0; x < schematic.width; x += 1) {
        const paletteIndex = schematic.blocks[schematicIndex(x, y, z, schematic.width, schematic.length)] ?? 0;
        if (airIndexes.has(paletteIndex)) continue;
        nonAir += 1;
        if (y < lowest) lowest = y;
        if (y > highest) highest = y;
      }
    }
  }
  if (!Number.isFinite(lowest)) return { lowest: 0, highest: 0, nonAir: 0 };
  return { lowest, highest, nonAir };
}

export function chooseVerticalOffset(
  lowestSchemY: number,
  highestSchemY: number,
  preferredSurfaceY: number,
): VerticalFit {
  const span = highestSchemY - lowestSchemY;
  if (span > MAX_WORLD_Y - MIN_WORLD_Y) {
    throw new SchematicHeightError(
      `Structure height ${span + 1} does not fit in world Y ${MIN_WORLD_Y}..${MAX_WORLD_Y}`,
    );
  }
  const minClear = STONE_CAP_TOP_Y + 1;
  let offsetY = Math.max(minClear, preferredSurfaceY) - lowestSchemY;
  let lowest = lowestSchemY + offsetY;
  let highest = highestSchemY + offsetY;
  if (highest > MAX_WORLD_Y) {
    offsetY = MAX_WORLD_Y - highestSchemY;
    lowest = lowestSchemY + offsetY;
    highest = highestSchemY + offsetY;
  }
  if (lowest < MIN_WORLD_Y) {
    offsetY = MIN_WORLD_Y - lowestSchemY;
    lowest = lowestSchemY + offsetY;
    highest = highestSchemY + offsetY;
  }
  if (lowest < MIN_WORLD_Y || highest > MAX_WORLD_Y) {
    throw new SchematicHeightError(
      `Cannot place schematic Y ${lowestSchemY}..${highestSchemY} into world ${MIN_WORLD_Y}..${MAX_WORLD_Y}`,
    );
  }
  return { offsetY, lowestWorldY: lowest, highestWorldY: highest };
}

/** Apply an extra world Y translation. Does not crop; throws if the result leaves 0..255. */
export function applyVerticalShift(fit: VerticalFit, yShift: number): VerticalFit {
  if (yShift === 0) return fit;
  const offsetY = fit.offsetY + yShift;
  const lowestWorldY = fit.lowestWorldY + yShift;
  const highestWorldY = fit.highestWorldY + yShift;
  if (lowestWorldY < MIN_WORLD_Y || highestWorldY > MAX_WORLD_Y) {
    throw new SchematicHeightError(
      `Y shift ${yShift} places structure at Y ${lowestWorldY}..${highestWorldY}, outside ${MIN_WORLD_Y}..${MAX_WORLD_Y}`,
    );
  }
  return { offsetY, lowestWorldY, highestWorldY };
}

export function mappedVoxels(
  schematic: ParsedSchematic,
  offset: readonly [number, number, number],
  mappedPalette: readonly MappedFrontierBlock[],
): {
  voxels: ImportedVoxel[];
  replacements: Record<string, number>;
  jungleReplacements: Record<string, number>;
  cocoaReplacements: Record<string, number>;
  mapped: number;
  diamond: number;
  jungleToOak: number;
  cocoaToAir: number;
  nonAir: number;
} {
  const voxels: ImportedVoxel[] = [];
  const replacements: Record<string, number> = {};
  const jungleReplacements: Record<string, number> = {};
  const cocoaReplacements: Record<string, number> = {};
  let mapped = 0;
  let diamond = 0;
  let jungleToOak = 0;
  let cocoaToAir = 0;
  let nonAir = 0;
  for (let y = 0; y < schematic.height; y += 1) {
    for (let z = 0; z < schematic.length; z += 1) {
      for (let x = 0; x < schematic.width; x += 1) {
        const paletteIndex = schematic.blocks[schematicIndex(x, y, z, schematic.width, schematic.length)] ?? 0;
        const cell = mappedPalette[paletteIndex];
        if (!cell) continue;
        const worldX = x + offset[0];
        const worldY = y + offset[1];
        const worldZ = z + offset[2];
        if (cell.block !== BlockId.Air) nonAir += 1;
        if (!cell.supported) {
          diamond += 1;
          replacements[cell.namespaced] = (replacements[cell.namespaced] ?? 0) + 1;
        } else if (cell.cocoaToAir) {
          cocoaToAir += 1;
          cocoaReplacements[cell.namespaced] = (cocoaReplacements[cell.namespaced] ?? 0) + 1;
        } else if (cell.block !== BlockId.Air) {
          mapped += 1;
          if (cell.jungleToOak) {
            jungleToOak += 1;
            jungleReplacements[cell.namespaced] = (jungleReplacements[cell.namespaced] ?? 0) + 1;
          }
        }
        voxels.push({ x: worldX, y: worldY, z: worldZ, block: cell.block, state: cell.state });
      }
    }
  }
  return { voxels, replacements, jungleReplacements, cocoaReplacements, mapped, diamond, jungleToOak, cocoaToAir, nonAir };
}

export function importVoxelsIntoWorld(world: VoxelWorld, voxels: readonly ImportedVoxel[]): {
  applied: number;
  affectedChunks: number;
} {
  const BATCH = 8_192;
  let applied = 0;
  for (let start = 0; start < voxels.length; start += BATCH) {
    const slice = voxels.slice(start, start + BATCH).map((voxel) => ({
      x: voxel.x, y: voxel.y, z: voxel.z, block: voxel.block,
    }));
    const stats = world.applyBlockBatch(slice, {
      record: true,
      updateLighting: false,
      scheduleNeighbors: false,
      skipSupport: true,
      deferChunkLighting: true,
    });
    applied += stats.applied;
  }
  for (const voxel of voxels) {
    if (voxel.state) world.replaceBlockState(voxel.x, voxel.y, voxel.z, voxel.state);
  }
  return { applied, affectedChunks: world.modifications.size };
}

export function findOpenSpawn(world: VoxelWorld, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): [number, number, number] {
  const midX = Math.floor((minX + maxX) / 2);
  const midZ = Math.floor((minZ + maxZ) / 2);
  const maxRadius = Math.max(maxX - minX, maxZ - minZ, 8);
  const tryColumn = (x: number, z: number): [number, number, number] | undefined => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return undefined;
    for (let y = Math.min(maxY, MAX_WORLD_Y - 2); y >= Math.max(minY, STONE_CAP_TOP_Y + 1); y -= 1) {
      const floor = world.getBlock(x, y, z, false);
      const definition = getBlockDefinition(floor);
      if (!definition.solid || definition.liquid || floor === BlockId.Fire || floor === BlockId.Cactus || floor === BlockId.Cobweb) {
        continue;
      }
      const head = world.getBlock(x, y + 1, z, false);
      const above = world.getBlock(x, y + 2, z, false);
      if (getBlockDefinition(head).solid || getBlockDefinition(above).solid) continue;
      if (head === BlockId.Lava || head === BlockId.Fire || above === BlockId.Lava || above === BlockId.Fire) continue;
      return [x + 0.5, y + 1.01, z + 0.5];
    }
    return undefined;
  };
  const origin = tryColumn(midX, midZ);
  if (origin) return origin;
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (Math.abs(x) !== radius && Math.abs(z) !== radius) continue;
        const found = tryColumn(midX + x, midZ + z);
        if (found) return found;
      }
    }
  }
  return [midX + 0.5, Math.max(SEA_LEVEL + 2, minY + 1), midZ + 0.5];
}

export function importSchematicIntoWorld(
  world: VoxelWorld,
  schematic: ParsedSchematic,
  preferredSurfaceY = world.generator.columnAt(0, 0).height,
  options?: ImportPlacementOptions,
): ImportReport & { spawn: [number, number, number] } {
  const mappedPalette = mapPalette(schematic.palette);
  const extent = extentOfNonAir(schematic);
  const yShift = options?.yShift ?? 0;
  const baseVertical = chooseVerticalOffset(extent.lowest, extent.highest, preferredSurfaceY);
  const vertical = applyVerticalShift(baseVertical, yShift);
  const baseOffset: [number, number, number] = [0, baseVertical.offsetY, 0];
  const offset: [number, number, number] = [0, vertical.offsetY, 0];
  const packed = mappedVoxels(schematic, offset, mappedPalette);
  const placed = importVoxelsIntoWorld(world, packed.voxels);
  const skippedEntities = schematic.entities.map((entity) => entity.id);
  const skippedBlockEntities = schematic.blockEntities.map((entity) => entity.id);
  const spawn = findOpenSpawn(
    world,
    offset[0],
    vertical.lowestWorldY,
    offset[2],
    offset[0] + schematic.width - 1,
    vertical.highestWorldY,
    offset[2] + schematic.length - 1,
  );
  return {
    width: schematic.width,
    height: schematic.height,
    length: schematic.length,
    totalCells: schematic.width * schematic.height * schematic.length,
    nonAirBlocks: packed.nonAir,
    mappedBlocks: packed.mapped,
    unsupportedToDiamond: packed.diamond,
    jungleToOak: packed.jungleToOak,
    jungleReplacements: packed.jungleReplacements,
    cocoaToAir: packed.cocoaToAir,
    cocoaReplacements: packed.cocoaReplacements,
    replacements: packed.replacements,
    skippedEntities,
    skippedBlockEntities,
    baseOffset,
    yShift,
    offset,
    lowestImportedY: vertical.lowestWorldY,
    highestImportedY: vertical.highestWorldY,
    affectedChunks: placed.affectedChunks,
    applied: placed.applied,
    spawn,
  };
}
