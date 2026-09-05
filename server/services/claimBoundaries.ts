import { CLAIM_BOUNDARY_DURATION_MS, type ServerMessage } from '../../shared/protocol';
import type { Claim } from './claims';

export { CLAIM_BOUNDARY_DURATION_MS };

export class ClaimBoundaryNetwork {
  constructor(
    private readonly sendToPlayer: (playerId: string, message: ServerMessage) => void,
  ) {}

  /** Show the denying claim's AABB to that player only. Never broadcast. */
  show(playerId: string, claim: Claim): void {
    this.sendToPlayer(playerId, {
      type: 'claim_boundary',
      claimId: claim.id,
      name: claim.name,
      worldId: claim.worldId,
      minX: claim.volume.minX,
      minY: claim.volume.minY,
      minZ: claim.volume.minZ,
      maxX: claim.volume.maxX,
      maxY: claim.volume.maxY,
      maxZ: claim.volume.maxZ,
      durationMs: CLAIM_BOUNDARY_DURATION_MS,
    });
  }
}
