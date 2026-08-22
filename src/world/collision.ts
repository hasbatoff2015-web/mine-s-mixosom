import { BlockId, getBlockDefinition, occupiedDoorFacing, type BlockRenderState, type HorizontalFacing } from '../blocks';

export interface CollisionBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

const DOOR_THICKNESS = 3 / 16;

export function blockCollisionBox(
  world: {
    getBlock(x: number, y: number, z: number, generate?: boolean): BlockId;
    getBlockState?(x: number, y: number, z: number): BlockRenderState | undefined;
  },
  x: number,
  y: number,
  z: number,
): CollisionBox | undefined {
  const block = world.getBlock(x, y, z, false);
  const definition = getBlockDefinition(block);
  if (!definition.solid) return undefined;
  if (block === BlockId.OakSlab || block === BlockId.StoneSlab || block === BlockId.CobblestoneSlab) {
    return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 0.5, maxZ: z + 1 };
  }
  if (block === BlockId.Cactus) {
    return {
      minX: x + 1 / 16, minY: y, minZ: z + 1 / 16,
      maxX: x + 15 / 16, maxY: y + 1, maxZ: z + 15 / 16,
    };
  }
  if (block === BlockId.OakDoor) {
    return doorCollisionBox(x, y, z, world.getBlockState?.(x, y, z));
  }
  return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
}

export function doorCollisionBox(
  x: number,
  y: number,
  z: number,
  state: BlockRenderState | undefined,
): CollisionBox {
  const facing = state?.facing ?? 'north';
  const open = state?.open === true;
  const hinge = state?.hinge ?? 'left';
  const occupied = occupiedDoorFacing(facing, open, hinge);
  return slabOnFace(x, y, z, occupied);
}

function slabOnFace(x: number, y: number, z: number, facing: HorizontalFacing): CollisionBox {
  switch (facing) {
    case 'north':
      return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + DOOR_THICKNESS };
    case 'south':
      return { minX: x, minY: y, minZ: z + 1 - DOOR_THICKNESS, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
    case 'west':
      return { minX: x, minY: y, minZ: z, maxX: x + DOOR_THICKNESS, maxY: y + 1, maxZ: z + 1 };
    case 'east':
      return { minX: x + 1 - DOOR_THICKNESS, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
  }
}
