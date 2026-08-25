import {
  BlockId,
  getBlockDefinition,
  isFenceBlock,
  isSlabBlock,
  isStairBlock,
  occupiedDoorFacing,
  type BlockRenderState,
  type HorizontalFacing,
} from '../blocks';
import {
  defaultSlabType,
  defaultStairFacing,
  defaultStairHalf,
  fenceConnections,
  fenceLocalBoxes,
  resolveStairShape,
  slabLocalBoxes,
  stairLocalBoxes,
  type BlockNeighborView,
  type LocalBox,
} from '../rendering/specialBlockGeometry';

export interface CollisionBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

const DOOR_THICKNESS = 3 / 16;

export function blockCollisionBoxes(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
): CollisionBox[] {
  const block = world.getBlock(x, y, z, false);
  const definition = getBlockDefinition(block);
  if (!definition.solid) return [];
  const state = world.getBlockState?.(x, y, z);
  if (isSlabBlock(block)) {
    return offsetLocalBoxes(x, y, z, slabLocalBoxes(defaultSlabType(state)));
  }
  if (isStairBlock(block)) {
    return offsetLocalBoxes(
      x, y, z,
      stairLocalBoxes(
        defaultStairFacing(state),
        defaultStairHalf(state),
        resolveStairShape(world, x, y, z, state),
      ),
    );
  }
  if (isFenceBlock(block)) {
    return offsetLocalBoxes(x, y, z, fenceLocalBoxes(fenceConnections(world, x, y, z), 1.5));
  }
  if (block === BlockId.Cactus) {
    return [{
      minX: x + 1 / 16, minY: y, minZ: z + 1 / 16,
      maxX: x + 15 / 16, maxY: y + 1, maxZ: z + 15 / 16,
    }];
  }
  if (block === BlockId.OakDoor) {
    return [doorCollisionBox(x, y, z, state)];
  }
  if (block === BlockId.Chest) {
    return [{
      minX: x + 1 / 16, minY: y, minZ: z + 1 / 16,
      maxX: x + 15 / 16, maxY: y + 14 / 16, maxZ: z + 15 / 16,
    }];
  }
  return [{ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 }];
}

/** Union AABB, or undefined when the cell has no solid collision. */
export function blockCollisionBox(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
): CollisionBox | undefined {
  const boxes = blockCollisionBoxes(world, x, y, z);
  if (boxes.length === 0) return undefined;
  if (boxes.length === 1) return boxes[0];
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    minZ: Math.min(...boxes.map((box) => box.minZ)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
    maxZ: Math.max(...boxes.map((box) => box.maxZ)),
  };
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

export function offsetLocalBoxes(x: number, y: number, z: number, locals: readonly LocalBox[]): CollisionBox[] {
  return locals.map((box) => ({
    minX: x + box.minX,
    minY: y + box.minY,
    minZ: z + box.minZ,
    maxX: x + box.maxX,
    maxY: y + box.maxY,
    maxZ: z + box.maxZ,
  }));
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

export function movementMultiplier(
  world: BlockNeighborView,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number {
  const x0 = Math.floor(minX);
  const x1 = Math.floor(maxX - 1e-7);
  const y0 = Math.floor(minY);
  const y1 = Math.floor(maxY - 1e-7);
  const z0 = Math.floor(minZ);
  const z1 = Math.floor(maxZ - 1e-7);
  for (let y = y0; y <= y1; y += 1) {
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (world.getBlock(x, y, z, false) === BlockId.Cobweb) return 0.15;
      }
    }
  }
  return 1;
}

export function rayAabbDistance(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  box: CollisionBox,
): { distance: number; nx: number; ny: number; nz: number } | undefined {
  const invX = dir.x === 0 ? Infinity : 1 / dir.x;
  const invY = dir.y === 0 ? Infinity : 1 / dir.y;
  const invZ = dir.z === 0 ? Infinity : 1 / dir.z;
  let tMinX = (box.minX - origin.x) * invX;
  let tMaxX = (box.maxX - origin.x) * invX;
  if (tMinX > tMaxX) [tMinX, tMaxX] = [tMaxX, tMinX];
  let tMinY = (box.minY - origin.y) * invY;
  let tMaxY = (box.maxY - origin.y) * invY;
  if (tMinY > tMaxY) [tMinY, tMaxY] = [tMaxY, tMinY];
  let tMinZ = (box.minZ - origin.z) * invZ;
  let tMaxZ = (box.maxZ - origin.z) * invZ;
  if (tMinZ > tMaxZ) [tMinZ, tMaxZ] = [tMaxZ, tMinZ];
  const tEnter = Math.max(tMinX, tMinY, tMinZ);
  const tExit = Math.min(tMaxX, tMaxY, tMaxZ);
  if (tExit < 0 || tEnter > tExit) return undefined;
  const distance = tEnter >= 0 ? tEnter : tExit;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const epsilon = 1e-8;
  if (Math.abs(tEnter - tMinX) <= epsilon) nx = dir.x >= 0 ? -1 : 1;
  else if (Math.abs(tEnter - tMinY) <= epsilon) ny = dir.y >= 0 ? -1 : 1;
  else nz = dir.z >= 0 ? -1 : 1;
  return { distance, nx, ny, nz };
}
