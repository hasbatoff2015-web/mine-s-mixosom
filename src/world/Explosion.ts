import { BlockId, getBlockDefinition } from '../blocks';
import { isBlockClaimAnchorId, isTntBlock } from '../blocks/tnt';
import { WORLD_HEIGHT } from '../core/constants';
import { systemRandomFn, type RandomFn } from '../gameplay/random';
import type { VoxelWorld, BlockMutation } from './World';
import { ORDINARY_TNT_PROFILE, type TntProfile } from './tnt';

export interface ExplosionJob {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly power: number;
  /** Defaults to ordinary TNT flags when omitted (legacy enqueue). */
  readonly profile?: TntProfile;
  /** Server adapter: skip voxels inside regular /claim volumes. */
  readonly canDestroy?: (x: number, y: number, z: number, blockId: BlockId) => boolean;
}

export interface ChainedTnt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly fuseSeconds: number;
  readonly blockId: BlockId;
}

export interface DestroyedBlock {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly previous: BlockId;
}

export interface ExplosionResolution {
  readonly destroyed: DestroyedBlock[];
  readonly chainedTnt: ChainedTnt[];
  readonly scanned: number;
}

/**
 * True when a solid obsidian cell lies on the voxel ray from the blast origin
 * to `tx,ty,tz`, not including the destination itself. Used so obsidian is a
 * local blast shield rather than cancelling the whole explosion.
 */
export function obsidianOccludesCell(
  world: VoxelWorld,
  originX: number,
  originY: number,
  originZ: number,
  tx: number,
  ty: number,
  tz: number,
): boolean {
  const destX = Math.floor(tx);
  const destY = Math.floor(ty);
  const destZ = Math.floor(tz);
  const x1 = destX + 0.5;
  const y1 = destY + 0.5;
  const z1 = destZ + 0.5;
  const dx = x1 - originX;
  const dy = y1 - originY;
  const dz = z1 - originZ;
  let x = Math.floor(originX);
  let y = Math.floor(originY);
  let z = Math.floor(originZ);
  if (x === destX && y === destY && z === destZ) return false;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Number.POSITIVE_INFINITY;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Number.POSITIVE_INFINITY;
  let tMaxX = stepX > 0
    ? (Math.floor(originX) + 1 - originX) * tDeltaX
    : stepX < 0
      ? (originX - Math.floor(originX)) * tDeltaX
      : Number.POSITIVE_INFINITY;
  let tMaxY = stepY > 0
    ? (Math.floor(originY) + 1 - originY) * tDeltaY
    : stepY < 0
      ? (originY - Math.floor(originY)) * tDeltaY
      : Number.POSITIVE_INFINITY;
  let tMaxZ = stepZ > 0
    ? (Math.floor(originZ) + 1 - originZ) * tDeltaZ
    : stepZ < 0
      ? (originZ - Math.floor(originZ)) * tDeltaZ
      : Number.POSITIVE_INFINITY;

  const maxSteps = Math.abs(destX - x) + Math.abs(destY - y) + Math.abs(destZ - z) + 2;
  for (let step = 0; step < maxSteps; step += 1) {
    if (x === destX && y === destY && z === destZ) return false;
    if (world.getBlock(x, y, z) === BlockId.Obsidian) return true;
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        tMaxX += tDeltaX;
      } else {
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      tMaxZ += tDeltaZ;
    }
  }
  return false;
}

export function resolveExplosion(
  world: VoxelWorld,
  job: ExplosionJob,
  options: {
    readonly random?: RandomFn;
    remainingPrimedCapacity?: number;
    readonly ignore?: ReadonlySet<string>;
  } = {},
): ExplosionResolution {
  const random = options.random ?? systemRandomFn;
  let remainingCapacity = options.remainingPrimedCapacity ?? Number.POSITIVE_INFINITY;
  const ignore = options.ignore;
  const profile = job.profile ?? ORDINARY_TNT_PROFILE;
  const radius = Math.ceil(job.radius);
  const radiusSq = job.radius * job.radius;
  const destroyed: DestroyedBlock[] = [];
  const chainedTnt: ChainedTnt[] = [];
  let scanned = 0;
  const minY = Math.max(0, Math.floor(job.y) - radius);
  const maxY = Math.min(WORLD_HEIGHT - 1, Math.floor(job.y) + radius);
  const centerX = Math.floor(job.x);
  const centerZ = Math.floor(job.z);

  for (let y = minY; y <= maxY; y += 1) {
    for (let z = centerZ - radius; z <= centerZ + radius; z += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        scanned += 1;
        if (ignore?.has(`${x},${y},${z}`)) continue;
        const dx = x + 0.5 - job.x;
        const dy = y + 0.5 - job.y;
        const dz = z + 0.5 - job.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq > radiusSq) continue;
        const block = world.getBlock(x, y, z);
        const definition = getBlockDefinition(block);
        if (block === BlockId.Air || definition.breakable === false) continue;
        if (!profile.canBreakObsidian && obsidianOccludesCell(world, job.x, job.y, job.z, x, y, z)) {
          continue;
        }
        const isObsidian = block === BlockId.Obsidian;
        if (isObsidian && !profile.canBreakObsidian) continue;
        if (isBlockClaimAnchorId(block) && !profile.canBreakBlockClaims) continue;
        if (job.canDestroy && !job.canDestroy(x, y, z, block)) continue;
        if (!isObsidian || !profile.canBreakObsidian) {
          if (definition.hardness > job.power * 3) continue;
          const distance = Math.sqrt(distanceSq);
          if (distance + definition.hardness * 0.3 > job.radius * (0.75 + random() * 0.35)) continue;
        }
        if (isTntBlock(block)) {
          if (remainingCapacity <= 0) continue;
          remainingCapacity -= 1;
          chainedTnt.push({ x, y, z, fuseSeconds: 0.5 + random(), blockId: block });
        }
        destroyed.push({ x, y, z, previous: block });
      }
    }
  }

  return { destroyed, chainedTnt, scanned };
}

export function destroyedToMutations(destroyed: readonly DestroyedBlock[]): BlockMutation[] {
  return destroyed.map((entry) => ({ x: entry.x, y: entry.y, z: entry.z, block: BlockId.Air }));
}
