import { BlockId } from '../../src/blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y } from '../../src/core/constants';
import type { Claim, ClaimAnchorBlock, ClaimStore } from './claims';
import type { SelectionVolume } from './selection';

export const CLAIM_ANCHOR_RADIUS: Readonly<Record<ClaimAnchorBlock, number>> = {
  iron_block: 10,
  gold_block: 20,
  diamond_block: 30,
};

export const BLOCK_CLAIM_OVERLAP_MESSAGE =
  'Нельзя установить блок-приват: его зона пересекается с другим блоком-приватом.';

const ANCHOR_BY_BLOCK_ID: Readonly<Partial<Record<BlockId, ClaimAnchorBlock>>> = {
  [BlockId.IronBlock]: 'iron_block',
  [BlockId.GoldBlock]: 'gold_block',
  [BlockId.DiamondBlock]: 'diamond_block',
};

export function claimAnchorKey(blockId: number): ClaimAnchorBlock | undefined {
  return ANCHOR_BY_BLOCK_ID[blockId as BlockId];
}

export function isClaimAnchorBlock(blockId: number): boolean {
  return claimAnchorKey(blockId) !== undefined;
}

export function claimAnchorVolume(
  x: number,
  y: number,
  z: number,
  block: ClaimAnchorBlock,
): SelectionVolume {
  const radius = CLAIM_ANCHOR_RADIUS[block];
  return {
    minX: x - radius,
    minY: Math.max(MIN_WORLD_Y, y - radius),
    minZ: z - radius,
    maxX: x + radius,
    maxY: Math.min(MAX_WORLD_Y, y + radius),
    maxZ: z + radius,
  };
}

/** Inclusive AABB overlap. Touching on a shared plane counts. */
export function volumesOverlap(a: SelectionVolume, b: SelectionVolume): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX
    && a.minY <= b.maxY && a.maxY >= b.minY
    && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function overlappingAnchorClaims(
  claims: readonly Claim[],
  worldId: string,
  volume: SelectionVolume,
  exceptId?: string,
): Claim[] {
  return claims.filter((claim) => (
    claim.worldId === worldId
    && claim.anchor
    && claim.id !== exceptId
    && volumesOverlap(claim.volume, volume)
  ));
}

export function findClaimByAnchor(
  claims: readonly Claim[],
  worldId: string,
  x: number,
  y: number,
  z: number,
): Claim | undefined {
  return claims.find((claim) => (
    claim.worldId === worldId
    && claim.anchor
    && claim.anchor.x === x
    && claim.anchor.y === y
    && claim.anchor.z === z
  ));
}

/**
 * Per-owner sequential names `"1"`, `"2"`, … Deleted numbers are not reused.
 * Names already taken by that owner (including regular `/claim create`) are skipped.
 */
export function allocateBlockClaimName(store: ClaimStore, ownerKey: string): string {
  const key = ownerKey.toLowerCase();
  const seq = store.blockClaimSeq ?? {};
  let next = (seq[key] ?? 0) + 1;
  while (store.claims.some((claim) => claim.owner === key && claim.name === String(next))) {
    next += 1;
  }
  seq[key] = next;
  store.blockClaimSeq = seq;
  return String(next);
}
