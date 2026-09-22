import { BlockId, getBlockDefinition } from '../blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y } from '../core/constants';
import type { Vec3Like } from '../math/vec3';
import type { VoxelWorld } from '../world/World';
import { PET_TELEPORT_OFFSETS } from './petConstants';

export interface PetTeleportSearchStats {
  candidateChecks: number;
  accepted: boolean;
}

export interface PetTeleportDestination {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const stats: PetTeleportSearchStats = { candidateChecks: 0, accepted: false };

export function lastPetTeleportSearchStats(): Readonly<PetTeleportSearchStats> {
  return stats;
}

export function resetPetTeleportSearchStats(): void {
  stats.candidateChecks = 0;
  stats.accepted = false;
}

export function petTeleportCandidateCount(): number {
  return PET_TELEPORT_OFFSETS.length;
}

function isUnsafeFloor(block: BlockId): boolean {
  if (block === BlockId.Air || block === BlockId.Fire || block === BlockId.Water || block === BlockId.Lava) {
    return true;
  }
  const definition = getBlockDefinition(block);
  return !definition.solid || definition.liquid === true;
}

function isBlockedBody(block: BlockId): boolean {
  if (block === BlockId.Air) return false;
  if (block === BlockId.Water || block === BlockId.Lava || block === BlockId.Fire) return true;
  return getBlockDefinition(block).solid;
}

/**
 * Cheap catch-up teleport. Only already-loaded chunks (`getBlock(..., false)`),
 * 24 XZ candidates around the owner, first safe floor wins. Never generates world.
 */
export function findSafePetTeleport(
  world: VoxelWorld,
  owner: Vec3Like,
): PetTeleportDestination | undefined {
  stats.candidateChecks = 0;
  stats.accepted = false;
  const ownerX = Math.floor(owner.x);
  const ownerY = Math.floor(owner.y);
  const ownerZ = Math.floor(owner.z);
  const feetY = Math.max(MIN_WORLD_Y + 1, Math.min(MAX_WORLD_Y - 2, ownerY));

  for (const [offsetX, offsetZ] of PET_TELEPORT_OFFSETS) {
    stats.candidateChecks += 1;
    const x = ownerX + offsetX;
    const z = ownerZ + offsetZ;
    const y = feetY;
    const floor = world.getBlock(x, y - 1, z, false);
    if (isUnsafeFloor(floor)) continue;
    if (isBlockedBody(world.getBlock(x, y, z, false))) continue;
    if (isBlockedBody(world.getBlock(x, y + 1, z, false))) continue;
    stats.accepted = true;
    return { x: x + 0.5, y, z: z + 0.5 };
  }
  return undefined;
}
