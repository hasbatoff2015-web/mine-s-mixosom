import { BlockId, type BlockRenderState, type HorizontalFacing, type RailShape } from '../../src/blocks';
import { isValidWorldY } from '../../src/core/constants';
import { isSharedWorldChestBlock } from '../../src/inventory/portalChest';
import type { VoxelWorld } from '../../src/world/World';
import {
  cuboidSizeOf,
  type BlockPos,
  type SelectionVolume,
} from './selection';

export type TemplateYaw = 0 | 90 | 180 | 270;

export interface TemplateBlock {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly blockId: number;
  readonly state?: BlockRenderState;
}

export interface EventTemplate {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly anchor: { readonly dx: number; readonly dy: number; readonly dz: number };
  readonly blocks: readonly TemplateBlock[];
}

export const DEFAULT_EVENT_TEMPLATE_NAME = 'chest_shrine';
export const EVENT_TEMPLATE_NAME_MAX = 24;
export const EVENT_TEMPLATE_MAX_EDGE = 16;
export const EVENT_TEMPLATE_MAX_VOLUME = 16 * 16 * 12;

const FACING_ORDER: readonly HorizontalFacing[] = ['north', 'east', 'south', 'west'];

const RAIL_90: Record<RailShape, RailShape> = {
  north_south: 'east_west',
  east_west: 'north_south',
  north_east: 'south_east',
  south_east: 'south_west',
  south_west: 'north_west',
  north_west: 'north_east',
  ascending_north: 'ascending_east',
  ascending_east: 'ascending_south',
  ascending_south: 'ascending_west',
  ascending_west: 'ascending_north',
};

export function parseEventTemplateName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.trim().toLowerCase();
  if (!new RegExp(`^[a-z0-9_]{1,${EVENT_TEMPLATE_NAME_MAX}}$`).test(name)) return undefined;
  return name;
}

export function yawTurns(yaw: TemplateYaw): 0 | 1 | 2 | 3 {
  return ((yaw / 90) | 0) as 0 | 1 | 2 | 3;
}

export function rotateOffset(dx: number, dy: number, dz: number, yaw: TemplateYaw): BlockPos {
  let x = dx;
  let z = dz;
  const turns = yawTurns(yaw);
  for (let i = 0; i < turns; i += 1) {
    const nextX = -z;
    const nextZ = x;
    x = nextX;
    z = nextZ;
  }
  return { x, y: dy, z };
}

export function rotateFacing(facing: HorizontalFacing, yaw: TemplateYaw): HorizontalFacing {
  const index = FACING_ORDER.indexOf(facing);
  if (index < 0) return facing;
  return FACING_ORDER[(index + yawTurns(yaw)) % 4]!;
}

export function rotateRailShape(shape: RailShape, yaw: TemplateYaw): RailShape {
  let current = shape;
  for (let i = 0; i < yawTurns(yaw); i += 1) current = RAIL_90[current];
  return current;
}

export function rotateBlockState(state: BlockRenderState | undefined, yaw: TemplateYaw): BlockRenderState | undefined {
  if (!state || yaw === 0) return state;
  return {
    ...state,
    ...(state.facing ? { facing: rotateFacing(state.facing, yaw) } : {}),
    ...(state.railShape ? { railShape: rotateRailShape(state.railShape, yaw) } : {}),
    ...(typeof state.signRotation === 'number'
      ? { signRotation: (state.signRotation + yawTurns(yaw) * 4) % 16 }
      : {}),
  };
}

export function templateFootprint(template: EventTemplate, yaw: TemplateYaw): SelectionVolume {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const cell of template.blocks) {
    const rotated = rotateOffset(cell.dx, cell.dy, cell.dz, yaw);
    if (rotated.x < minX) minX = rotated.x;
    if (rotated.y < minY) minY = rotated.y;
    if (rotated.z < minZ) minZ = rotated.z;
    if (rotated.x > maxX) maxX = rotated.x;
    if (rotated.y > maxY) maxY = rotated.y;
    if (rotated.z > maxZ) maxZ = rotated.z;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function placedVolume(template: EventTemplate, chest: BlockPos, yaw: TemplateYaw): SelectionVolume {
  const footprint = templateFootprint(template, yaw);
  return {
    minX: chest.x + footprint.minX,
    minY: chest.y + footprint.minY,
    minZ: chest.z + footprint.minZ,
    maxX: chest.x + footprint.maxX,
    maxY: chest.y + footprint.maxY,
    maxZ: chest.z + footprint.maxZ,
  };
}

export function collectChestsInVolume(world: VoxelWorld, volume: SelectionVolume): BlockPos[] {
  const chests: BlockPos[] = [];
  for (let y = volume.minY; y <= volume.maxY; y += 1) {
    for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
      for (let x = volume.minX; x <= volume.maxX; x += 1) {
        if (isSharedWorldChestBlock(world.getBlock(x, y, z))) chests.push({ x, y, z });
      }
    }
  }
  return chests;
}

export function captureTemplateFromWorld(
  world: VoxelWorld,
  volume: SelectionVolume,
  name: string,
): { ok: true; template: EventTemplate } | { ok: false; error: string } {
  const parsed = parseEventTemplateName(name);
  if (!parsed) {
    return { ok: false, error: `Некорректное имя шаблона. Используйте 1–${EVENT_TEMPLATE_NAME_MAX} символов: a-z, 0-9, _.` };
  }
  if (![volume.minX, volume.minY, volume.minZ, volume.maxX, volume.maxY, volume.maxZ].every(Number.isInteger)) {
    return { ok: false, error: 'Координаты выделения должны быть целыми.' };
  }
  if (!isValidWorldY(volume.minY) || !isValidWorldY(volume.maxY)) {
    return { ok: false, error: 'Выделение выходит за границы мира по Y.' };
  }
  const size = cuboidSizeOf(volume);
  if (size.width < 1 || size.height < 1 || size.depth < 1) {
    return { ok: false, error: 'Некорректный размер выделения.' };
  }
  if (size.width > EVENT_TEMPLATE_MAX_EDGE || size.height > EVENT_TEMPLATE_MAX_EDGE || size.depth > EVENT_TEMPLATE_MAX_EDGE) {
    return { ok: false, error: `Сторона шаблона не может быть больше ${EVENT_TEMPLATE_MAX_EDGE}.` };
  }
  if (size.blocks > EVENT_TEMPLATE_MAX_VOLUME) {
    return { ok: false, error: `Шаблон слишком большой (${size.blocks} блоков, максимум ${EVENT_TEMPLATE_MAX_VOLUME}).` };
  }
  const chests = collectChestsInVolume(world, volume);
  if (chests.length === 0) return { ok: false, error: 'В выделении должен быть ровно один сундук — он станет якорем шаблона.' };
  if (chests.length > 1) return { ok: false, error: `В выделении ${chests.length} сундука. Нужен ровно один.` };
  const anchor = chests[0]!;
  const blocks: TemplateBlock[] = [];
  for (let y = volume.minY; y <= volume.maxY; y += 1) {
    for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
      for (let x = volume.minX; x <= volume.maxX; x += 1) {
        const blockId = world.getBlock(x, y, z);
        const state = world.getBlockState(x, y, z);
        blocks.push({
          dx: x - anchor.x,
          dy: y - anchor.y,
          dz: z - anchor.z,
          blockId,
          ...(state ? { state } : {}),
        });
      }
    }
  }
  return {
    ok: true,
    template: {
      name: parsed,
      width: size.width,
      height: size.height,
      depth: size.depth,
      anchor: { dx: 0, dy: 0, dz: 0 },
      blocks,
    },
  };
}

function cell(dx: number, dy: number, dz: number, blockId: BlockId, state?: BlockRenderState): TemplateBlock {
  return state ? { dx, dy, dz, blockId, state } : { dx, dy, dz, blockId };
}

/** Built-in 5×5 shrine anchored on the center chest. Lower layer sits in the ground. */
export function createDefaultChestShrineTemplate(name = DEFAULT_EVENT_TEMPLATE_NAME): EventTemplate {
  const blocks: TemplateBlock[] = [];
  for (let dz = -2; dz <= 2; dz += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
      blocks.push(cell(dx, -1, dz, corner ? BlockId.Obsidian : BlockId.StoneBricks));
      if (dx === 0 && dz === 0) {
        blocks.push(cell(0, 0, 0, BlockId.EventChest, { facing: 'north' }));
      } else if (corner) {
        blocks.push(cell(dx, 0, dz, BlockId.RedWool));
      } else if (edge && dz === -2) {
        blocks.push(cell(dx, 0, dz, BlockId.StoneBrickStairs, { facing: 'north', stairHalf: 'bottom' }));
      } else if (edge && dz === 2) {
        blocks.push(cell(dx, 0, dz, BlockId.StoneBrickStairs, { facing: 'south', stairHalf: 'bottom' }));
      } else if (edge && dx === -2) {
        blocks.push(cell(dx, 0, dz, BlockId.StoneBrickStairs, { facing: 'west', stairHalf: 'bottom' }));
      } else if (edge && dx === 2) {
        blocks.push(cell(dx, 0, dz, BlockId.StoneBrickStairs, { facing: 'east', stairHalf: 'bottom' }));
      } else {
        blocks.push(cell(dx, 0, dz, BlockId.StoneBricks));
      }
      if (corner) blocks.push(cell(dx, 1, dz, BlockId.OakFence));
      else blocks.push(cell(dx, 1, dz, BlockId.Air));
    }
  }
  return {
    name,
    width: 5,
    height: 3,
    depth: 5,
    anchor: { dx: 0, dy: 0, dz: 0 },
    blocks,
  };
}

export function parseStoredTemplate(raw: unknown): EventTemplate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const name = parseEventTemplateName(typeof value.name === 'string' ? value.name : undefined);
  if (!name) return undefined;
  if (![value.width, value.height, value.depth].every((entry) => Number.isInteger(entry) && (entry as number) > 0)) {
    return undefined;
  }
  if (!value.anchor || typeof value.anchor !== 'object') return undefined;
  const anchor = value.anchor as Record<string, unknown>;
  if (![anchor.dx, anchor.dy, anchor.dz].every((entry) => Number.isInteger(entry))) return undefined;
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) return undefined;
  const blocks: TemplateBlock[] = [];
  for (const entry of value.blocks) {
    if (!entry || typeof entry !== 'object') continue;
    const cell = entry as Record<string, unknown>;
    if (![cell.dx, cell.dy, cell.dz, cell.blockId].every((coord) => Number.isInteger(coord))) continue;
    blocks.push({
      dx: cell.dx as number,
      dy: cell.dy as number,
      dz: cell.dz as number,
      blockId: cell.blockId as number,
      ...(cell.state && typeof cell.state === 'object' ? { state: cell.state as BlockRenderState } : {}),
    });
  }
  if (blocks.length === 0) return undefined;
  return {
    name,
    width: value.width as number,
    height: value.height as number,
    depth: value.depth as number,
    anchor: { dx: anchor.dx as number, dy: anchor.dy as number, dz: anchor.dz as number },
    blocks,
  };
}
