import { BlockId, getBlockDefinition } from '../blocks';
import { selectionLocalBoxes, type BlockNeighborView } from '../rendering/specialBlockGeometry';
import { offsetLocalBoxes, type CollisionBox } from './collision';

/** World-space interaction AABBs. Empty = air/liquid (not selectable). */
export function blockSelectionBoxes(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
): CollisionBox[] {
  const block = world.getBlock(x, y, z, false);
  if (block === BlockId.Air) return [];
  const definition = getBlockDefinition(block);
  if (definition.liquid) return [];
  return offsetLocalBoxes(
    x, y, z,
    selectionLocalBoxes(block, world.getBlockState?.(x, y, z), world, x, y, z),
  );
}
