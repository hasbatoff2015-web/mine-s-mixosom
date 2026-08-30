import { BlockId, getBlockDefinition } from '../blocks';
import { WORLD_HEIGHT } from '../core/constants';
import { systemRandomFn, type RandomFn } from '../gameplay/random';
import type { VoxelWorld, BlockMutation } from './World';

export interface ExplosionJob {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly power: number;
}

export interface ChainedTnt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly fuseSeconds: number;
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
        const distance = Math.sqrt(distanceSq);
        const block = world.getBlock(x, y, z);
        const definition = getBlockDefinition(block);
        if (block === BlockId.Air || definition.breakable === false || definition.hardness > job.power * 3) continue;
        if (distance + definition.hardness * 0.3 > job.radius * (0.75 + random() * 0.35)) continue;
        if (block === BlockId.Tnt) {
          if (remainingCapacity <= 0) continue;
          remainingCapacity -= 1;
          chainedTnt.push({ x, y, z, fuseSeconds: 0.5 + random() });
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
