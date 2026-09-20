import { BlockId } from '../../src/blocks';
import { isValidWorldY } from '../../src/core/constants';
import {
  CLAN_BASE_ANCHOR_ERROR,
  CLAN_BASE_POSITION_ERROR,
} from '../../shared/clans';
import { claimAnchorVolume } from './claimAnchors';
import { CLAIM_PRIORITY_DEFAULT, type Claim } from './claims';
import type { SelectionVolume } from './selection';

export const CLAN_BASE_ANCHOR_BLOCK = 'diamond_block' as const;

export interface ClanBaseAnchor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function clanClaimOwnerKey(clanId: string): string {
  return `clan:${clanId}`.toLowerCase();
}

export function clanBaseClaimId(clanId: string): string {
  return `clan:${clanId}:base`;
}

export function clanBaseVolume(x: number, y: number, z: number): SelectionVolume {
  return claimAnchorVolume(x, y, z, CLAN_BASE_ANCHOR_BLOCK);
}

export function clanBaseTeleportDest(anchor: ClanBaseAnchor): { x: number; y: number; z: number } {
  return { x: anchor.x + 0.5, y: anchor.y + 1, z: anchor.z + 0.5 };
}

/**
 * Block the player is standing on. Bedrock is never replaced: try one block above.
 */
export function resolveClanBaseAnchor(
  pos: { readonly x: number; readonly y: number; readonly z: number },
  getBlock: (x: number, y: number, z: number) => number,
): { ok: true; anchor: ClanBaseAnchor } | { ok: false; error: string } {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
    return { ok: false, error: CLAN_BASE_POSITION_ERROR };
  }
  const x = Math.floor(pos.x);
  const z = Math.floor(pos.z);
  if (!Number.isInteger(x) || !Number.isInteger(z)) {
    return { ok: false, error: CLAN_BASE_POSITION_ERROR };
  }
  let y = Math.floor(pos.y - 0.001);
  if (!isValidWorldY(y)) return { ok: false, error: CLAN_BASE_POSITION_ERROR };

  let block = getBlock(x, y, z);
  if (block === BlockId.Air && isValidWorldY(y - 1)) {
    const below = getBlock(x, y - 1, z);
    if (below !== BlockId.Air) {
      y -= 1;
      block = below;
    }
  }

  if (block === BlockId.Bedrock) {
    const aboveY = y + 1;
    if (!isValidWorldY(aboveY)) return { ok: false, error: CLAN_BASE_ANCHOR_ERROR };
    if (getBlock(x, aboveY, z) === BlockId.Bedrock) {
      return { ok: false, error: CLAN_BASE_ANCHOR_ERROR };
    }
    return { ok: true, anchor: { x, y: aboveY, z } };
  }

  if (block === BlockId.Air) return { ok: false, error: CLAN_BASE_POSITION_ERROR };
  return { ok: true, anchor: { x, y, z } };
}

export function createClanBaseClaim(
  clanId: string,
  clanName: string,
  worldId: string,
  anchor: ClanBaseAnchor,
): Claim {
  return {
    id: clanBaseClaimId(clanId),
    name: clanName,
    owner: clanClaimOwnerKey(clanId),
    worldId,
    volume: clanBaseVolume(anchor.x, anchor.y, anchor.z),
    members: [],
    priority: CLAIM_PRIORITY_DEFAULT,
    flags: {},
    anchor: { x: anchor.x, y: anchor.y, z: anchor.z, block: CLAN_BASE_ANCHOR_BLOCK },
    clanId,
  };
}
