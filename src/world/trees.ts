import { BlockId, getBlockDefinition } from '../blocks';
import { WORLD_HEIGHT } from '../core/constants';
import { gameplayMayMutateBlock } from './worldBorder';

export type TreeKind = 'oak' | 'birch' | 'spruce';

export const TREE_BLOCKS: Readonly<Record<TreeKind, Readonly<{ log: BlockId; leaves: BlockId }>>> = {
  oak: { log: BlockId.OakLog, leaves: BlockId.OakLeaves },
  birch: { log: BlockId.BirchLog, leaves: BlockId.BirchLeaves },
  spruce: { log: BlockId.SpruceLog, leaves: BlockId.SpruceLeaves },
};

export interface TreeCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockId;
}

/**
 * Same canopy the terrain generator writes. Logs are applied after leaves so
 * the trunk wins on overlapping cells.
 */
export function treeCells(kind: TreeKind, x: number, y: number, z: number, height: number): TreeCell[] {
  const blocks = TREE_BLOCKS[kind];
  const shape = new Map<string, TreeCell>();
  const addLeaves = (dy: number, radius: number, rounded = false): void => {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (rounded && radius > 1 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
        const px = x + dx;
        const py = y + height + dy;
        const pz = z + dz;
        shape.set(`${px},${py},${pz}`, { x: px, y: py, z: pz, block: blocks.leaves });
      }
    }
  };
  if (kind === 'oak') {
    for (let dy = -2; dy <= 1; dy += 1) addLeaves(dy, dy >= 1 ? 1 : 2, dy !== 0);
  } else if (kind === 'birch') {
    addLeaves(-2, 1);
    addLeaves(-1, 1);
    addLeaves(0, 1);
    addLeaves(1, 0);
  } else {
    addLeaves(-5, 1);
    addLeaves(-4, 2, true);
    addLeaves(-3, 1);
    addLeaves(-2, 2, true);
    addLeaves(-1, 1);
    addLeaves(0, 0);
  }
  for (let offset = 0; offset < height; offset += 1) {
    shape.set(`${x},${y + offset},${z}`, { x, y: y + offset, z, block: blocks.log });
  }
  return [...shape.values()];
}

/** Worldgen height band: oak 4–5, birch 5–7, spruce 6–8. Stable for a planted column. */
export function grownTreeHeight(kind: TreeKind, x: number, z: number): number {
  const span = kind === 'oak' ? 2 : 3;
  const base = kind === 'oak' ? 4 : kind === 'birch' ? 5 : 6;
  const roll = Math.abs(Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) % span;
  return base + roll;
}

export function treeFits(
  getBlock: (x: number, y: number, z: number) => BlockId,
  cells: readonly TreeCell[],
  sapling: { readonly x: number; readonly y: number; readonly z: number; readonly block: BlockId },
): boolean {
  for (const cell of cells) {
    if (cell.y < 0 || cell.y >= WORLD_HEIGHT) return false;
    if (!gameplayMayMutateBlock(cell.x, cell.z)) return false;
    const existing = getBlock(cell.x, cell.y, cell.z);
    if (cell.x === sapling.x && cell.y === sapling.y && cell.z === sapling.z) {
      if (existing !== sapling.block) return false;
      continue;
    }
    if (existing !== BlockId.Air && getBlockDefinition(existing).replaceable !== true) return false;
  }
  return true;
}
