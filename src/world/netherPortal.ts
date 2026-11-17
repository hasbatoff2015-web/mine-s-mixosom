import { BlockId, getBlockDefinition, type BlockRenderState } from '../blocks';
import type { VoxelWorld } from './World';

export type PortalAxis = 'x' | 'z';

export interface NetherPortalFrame {
  readonly axis: PortalAxis;
  readonly cells: readonly { x: number; y: number; z: number }[];
}

function isInterior(block: BlockId): boolean {
  return block === BlockId.Air
    || block === BlockId.Fire
    || block === BlockId.SoulFire
    || block === BlockId.NetherPortal
    || getBlockDefinition(block).replaceable === true;
}

function interiorOrigin(
  x: number,
  y: number,
  z: number,
  axis: PortalAxis,
  along: 0 | 1,
  up: 0 | 1 | 2,
): { x: number; y: number; z: number } {
  if (axis === 'z') return { x: x - along, y: y - up, z };
  return { x, y: y - up, z: z - along };
}

function frameBlocks(originX: number, originY: number, originZ: number, axis: PortalAxis): Array<[number, number, number]> {
  const blocks: Array<[number, number, number]> = [];
  if (axis === 'z') {
    for (let y = 0; y < 3; y += 1) {
      blocks.push([originX - 1, originY + y, originZ], [originX + 2, originY + y, originZ]);
    }
    for (let x = 0; x < 2; x += 1) {
      blocks.push([originX + x, originY - 1, originZ], [originX + x, originY + 3, originZ]);
    }
  } else {
    for (let y = 0; y < 3; y += 1) {
      blocks.push([originX, originY + y, originZ - 1], [originX, originY + y, originZ + 2]);
    }
    for (let z = 0; z < 2; z += 1) {
      blocks.push([originX, originY - 1, originZ + z], [originX, originY + 3, originZ + z]);
    }
  }
  return blocks;
}

function interiorCells(originX: number, originY: number, originZ: number, axis: PortalAxis): Array<{ x: number; y: number; z: number }> {
  const cells: Array<{ x: number; y: number; z: number }> = [];
  for (let up = 0; up < 3; up += 1) {
    for (let along = 0; along < 2; along += 1) {
      if (axis === 'z') cells.push({ x: originX + along, y: originY + up, z: originZ });
      else cells.push({ x: originX, y: originY + up, z: originZ + along });
    }
  }
  return cells;
}

function matches(world: VoxelWorld, originX: number, originY: number, originZ: number, axis: PortalAxis): NetherPortalFrame | undefined {
  const cells = interiorCells(originX, originY, originZ, axis);
  if (!cells.every((cell) => isInterior(world.getBlock(cell.x, cell.y, cell.z)))) return undefined;
  const frame = frameBlocks(originX, originY, originZ, axis);
  if (frame.length !== 10) return undefined;
  if (!frame.every(([x, y, z]) => world.getBlock(x, y, z) === BlockId.Obsidian)) return undefined;
  return { axis, cells };
}

/** A 2×3 obsidian frame in either vertical plane. Corners are not required. */
export function findNetherPortalFrame(world: VoxelWorld, x: number, y: number, z: number): NetherPortalFrame | undefined {
  if (!isInterior(world.getBlock(x, y, z, false))) return undefined;
  for (const axis of ['z', 'x'] as const) {
    for (const along of [0, 1] as const) {
      for (const up of [0, 1, 2] as const) {
        const origin = interiorOrigin(x, y, z, axis, along, up);
        const frame = matches(world, origin.x, origin.y, origin.z, axis);
        if (frame) return frame;
      }
    }
  }
  return undefined;
}

export function portalState(axis: PortalAxis): BlockRenderState {
  return { facing: axis === 'x' ? 'north' : 'east' };
}

export function portalAxisFromState(state: BlockRenderState | undefined): PortalAxis {
  return state?.facing === 'east' || state?.facing === 'west' ? 'z' : 'x';
}

export function lightNetherPortal(world: VoxelWorld, x: number, y: number, z: number): NetherPortalFrame | undefined {
  const frame = findNetherPortalFrame(world, x, y, z);
  if (!frame) return undefined;
  const state = portalState(frame.axis);
  for (const cell of frame.cells) {
    world.setBlock(cell.x, cell.y, cell.z, BlockId.NetherPortal);
    world.setBlockState(cell.x, cell.y, cell.z, state);
  }
  return frame;
}

/** Remove portal blocks whose obsidian frame is no longer complete. */
export function sweepInvalidPortals(world: VoxelWorld, x: number, y: number, z: number): number {
  let removed = 0;
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dz = -4; dz <= 4; dz += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        const pz = z + dz;
        if (world.getBlock(px, py, pz, false) !== BlockId.NetherPortal) continue;
        if (findNetherPortalFrame(world, px, py, pz)) continue;
        world.setBlock(px, py, pz, BlockId.Air);
        removed += 1;
      }
    }
  }
  return removed;
}

/** True when any block of the body overlaps a lit portal. */
export function bodyOverlapsPortal(
  world: VoxelWorld,
  box: {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly maxZ: number;
  },
): boolean {
  const y0 = Math.floor(box.minY);
  const y1 = Math.floor(box.maxY);
  const z0 = Math.floor(box.minZ);
  const z1 = Math.floor(box.maxZ);
  const x0 = Math.floor(box.minX);
  const x1 = Math.floor(box.maxX);
  for (let y = y0; y <= y1; y += 1) {
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (world.getBlock(x, y, z, false) === BlockId.NetherPortal) return true;
      }
    }
  }
  return false;
}
