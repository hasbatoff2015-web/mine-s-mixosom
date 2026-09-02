import { BlockId, getBlockDefinition, type BlockRenderShape, type BlockRenderState } from '../blocks';
import { attachmentNormal, type BlockNeighborView } from './blockGeometry';
import { blockCollisionBoxes } from './collision';

export interface PlacementFace { readonly x: number; readonly y: number; readonly z: number }

const UP: PlacementFace = { x: 0, y: 1, z: 0 };

/** Existing attachment state is authoritative; signs match rendering and placement. */
const SUPPORT_RULES: Partial<Record<BlockRenderShape, { attachment: 'floor' | 'wall'; facing: 'north' | 'south'; oriented?: boolean }>> = {
  torch: { attachment: 'floor', facing: 'north', oriented: true },
  lever: { attachment: 'floor', facing: 'north', oriented: true },
  button: { attachment: 'wall', facing: 'south', oriented: true },
  ladder: { attachment: 'wall', facing: 'north' },
  wire: { attachment: 'floor', facing: 'north' },
  pressure_plate: { attachment: 'floor', facing: 'north' },
  rail: { attachment: 'floor', facing: 'north' },
};

const GRASS_PLANT_SUBSTRATES: ReadonlySet<BlockId> = new Set([BlockId.GrassBlock, BlockId.Dirt]);
const DEAD_BUSH_SUBSTRATES: ReadonlySet<BlockId> = new Set([BlockId.Sand]);

const VEGETATION_SUBSTRATES: ReadonlyMap<BlockId, ReadonlySet<BlockId>> = new Map([
  [BlockId.TallGrass, GRASS_PLANT_SUBSTRATES],
  [BlockId.Fern, GRASS_PLANT_SUBSTRATES],
  [BlockId.Dandelion, GRASS_PLANT_SUBSTRATES],
  [BlockId.Poppy, GRASS_PLANT_SUBSTRATES],
  [BlockId.OxeyeDaisy, GRASS_PLANT_SUBSTRATES],
  [BlockId.DeadBush, DEAD_BUSH_SUBSTRATES],
]);

export function isVegetationBlock(block: BlockId): boolean {
  return VEGETATION_SUBSTRATES.has(block);
}

export function isLanternBlock(block: BlockId): boolean {
  return block === BlockId.Lantern;
}

export function isChainBlock(block: BlockId): boolean {
  return block === BlockId.Chain;
}

/** Chain and lantern can hang from / stand on each other as a vertical column. */
export function isVerticalHangerBlock(block: BlockId): boolean {
  return block === BlockId.Chain || block === BlockId.Lantern;
}

export function vegetationSubstrates(block: BlockId): ReadonlySet<BlockId> | undefined {
  return VEGETATION_SUBSTRATES.get(block);
}

export function needsBlockSupport(block: BlockId): boolean {
  return SUPPORT_RULES[getBlockDefinition(block).renderShape] !== undefined
    || isVegetationBlock(block)
    || isLanternBlock(block)
    || isChainBlock(block);
}

const DOWN: PlacementFace = { x: 0, y: -1, z: 0 };

/**
 * Sturdy cube/slab/stair face, or another chain/lantern in the vertical column.
 * `face` is the support block's face the decoration attaches to.
 */
export function canSupportHanger(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
  face: 'up' | 'down',
): boolean {
  const block = world.getBlock(x, y, z, false);
  if (isVerticalHangerBlock(block)) return true;
  return canAttachToFace(world, x, y, z, face === 'up' ? UP : DOWN);
}

export function supportCellForBlock(block: BlockId, state: BlockRenderState | undefined, x: number, y: number, z: number) {
  if (isVegetationBlock(block)) return { x, y: y - 1, z, normal: UP };
  if (isLanternBlock(block) || isChainBlock(block)) {
    return state?.attachment === 'ceiling'
      ? { x, y: y + 1, z, normal: DOWN }
      : { x, y: y - 1, z, normal: UP };
  }
  const rule = SUPPORT_RULES[getBlockDefinition(block).renderShape];
  if (!rule) return undefined;
  const attachment = rule.oriented ? state?.attachment ?? rule.attachment : rule.attachment;
  const normal = attachmentNormal(attachment, state?.facing ?? rule.facing);
  return { x: x - normal.x, y: y - normal.y, z: z - normal.z, normal };
}

export function isBlockStillSupported(world: BlockNeighborView, x: number, y: number, z: number): boolean {
  const block = world.getBlock(x, y, z, false);
  const substrates = vegetationSubstrates(block);
  if (substrates) return substrates.has(world.getBlock(x, y - 1, z, false));
  if (isLanternBlock(block) || isChainBlock(block)) {
    const hanging = world.getBlockState?.(x, y, z)?.attachment === 'ceiling';
    return hanging
      ? canSupportHanger(world, x, y + 1, z, 'down')
      : canSupportHanger(world, x, y - 1, z, 'up');
  }
  const support = supportCellForBlock(block, world.getBlockState?.(x, y, z), x, y, z);
  return !support || canAttachToFace(world, support.x, support.y, support.z, support.normal);
}

/** A clicked solid shape may anchor a neighboring block, even if not full-cube.
 * Replaceable cells are handled separately (same-cell replacement, not support).
 */
export function canUseAsPlacementAnchor(block: BlockId): boolean {
  const definition = getBlockDefinition(block);
  return definition.solid && !definition.liquid && !definition.replaceable;
}

/** Full, sturdy boundary face. A solid flag or a union bounding box is insufficient.
 * Slabs/stairs use actual collision rectangles; inset chests/doors/fences never
 * become full-cube supports just because the ray hit their bounding box.
 */
export function canAttachToFace(
  world: BlockNeighborView, x: number, y: number, z: number, normal: PlacementFace,
): boolean {
  const block = world.getBlock(x, y, z, false);
  if (!canUseAsPlacementAnchor(block)) return false;
  const shape = getBlockDefinition(block).renderShape;
  if (shape !== 'cube' && shape !== 'slab' && shape !== 'stairs') return false;
  const axis = normal.x ? 'X' : normal.y ? 'Y' : 'Z';
  const sign = normal.x || normal.y || normal.z;
  if (Math.abs(sign) !== 1 || Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z) !== 1) return false;
  const [u, v] = axis === 'X' ? ['Y', 'Z'] as const : axis === 'Y' ? ['X', 'Z'] as const : ['X', 'Y'] as const;
  const origin = { X: x, Y: y, Z: z };
  const boundary = origin[axis] + (sign > 0 ? 1 : 0);
  const faces = blockCollisionBoxes(world, x, y, z).filter((box) =>
    Math.abs(box[`${sign > 0 ? 'max' : 'min'}${axis}`] - boundary) < 1e-6,
  ).map((box) => [box[`min${u}`] - origin[u], box[`max${u}`] - origin[u],
    box[`min${v}`] - origin[v], box[`max${v}`] - origin[v]] as const);
  const us = [...new Set([0, 1, ...faces.flatMap((f) => [f[0], f[1]])])].filter((n) => n >= 0 && n <= 1).sort((a, b) => a - b);
  const vs = [...new Set([0, 1, ...faces.flatMap((f) => [f[2], f[3]])])].filter((n) => n >= 0 && n <= 1).sort((a, b) => a - b);
  for (let i = 1; i < us.length; i++) for (let j = 1; j < vs.length; j++) {
    const a = (us[i - 1]! + us[i]!) / 2, b = (vs[j - 1]! + vs[j]!) / 2;
    if (!faces.some((f) => a >= f[0] && a <= f[1] && b >= f[2] && b <= f[3])) return false;
  }
  return faces.length > 0;
}
