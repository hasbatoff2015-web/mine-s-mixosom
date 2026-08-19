import { lightEngineStats } from './LightEngine';
import {
  destroyedToMutations,
  resolveExplosion,
  type ChainedTnt,
  type DestroyedBlock,
  type ExplosionJob,
  type ExplosionResolution,
} from './Explosion';
import type { VoxelWorld } from './World';

export interface ExplosionQueueTickStats {
  pending: number;
  processed: number;
  scanned: number;
  destroyed: number;
  chainedTnt: number;
  cpuMs: number;
  mutationMs: number;
  relightMs: number;
  skyRecomputes: number;
}

export interface ExplosionQueueProcessOptions {
  readonly budgetMs: number;
  readonly maxJobs: number;
  readonly maxVoxels: number;
  readonly remainingPrimedCapacity: number;
  readonly random?: () => number;
  readonly onResolved?: (job: ExplosionJob, result: ExplosionResolution) => void;
  readonly onContents?: (block: DestroyedBlock) => void;
  readonly onChainedTnt?: (tnt: ChainedTnt) => void;
}

const emptyStats = (): ExplosionQueueTickStats => ({
  pending: 0,
  processed: 0,
  scanned: 0,
  destroyed: 0,
  chainedTnt: 0,
  cpuMs: 0,
  mutationMs: 0,
  relightMs: 0,
  skyRecomputes: 0,
});

export class ExplosionQueue {
  private readonly pending: ExplosionJob[] = [];
  lastTick = emptyStats();

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(job: ExplosionJob): void {
    this.pending.push(job);
  }

  clear(): void {
    this.pending.length = 0;
    this.lastTick = emptyStats();
  }

  process(world: VoxelWorld, options: ExplosionQueueProcessOptions): ExplosionQueueTickStats {
    const started = performance.now();
    const skyBefore = lightEngineStats.skyRecomputes;
    const destroyed: DestroyedBlock[] = [];
    const chained: ChainedTnt[] = [];
    const seen = new Set<string>();
    let processed = 0;
    let scanned = 0;
    let remainingCapacity = options.remainingPrimedCapacity;
    const budgetEnd = started + Math.max(0.25, options.budgetMs);

    while (
      this.pending.length > 0
      && processed < options.maxJobs
      && destroyed.length < options.maxVoxels
    ) {
      if (processed > 0 && performance.now() >= budgetEnd) break;
      const job = this.pending.shift()!;
      const result = resolveExplosion(world, job, {
        random: options.random,
        remainingPrimedCapacity: remainingCapacity,
        ignore: seen,
      });
      options.onResolved?.(job, result);
      scanned += result.scanned;
      remainingCapacity = Math.max(0, remainingCapacity - result.chainedTnt.length);
      for (const tnt of result.chainedTnt) chained.push(tnt);
      for (const entry of result.destroyed) {
        const key = `${entry.x},${entry.y},${entry.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        destroyed.push(entry);
      }
      processed += 1;
    }

    for (const entry of destroyed) options.onContents?.(entry);
    const batch = destroyed.length > 0
      ? world.applyBlockBatch(destroyedToMutations(destroyed))
      : undefined;
    for (const tnt of chained) options.onChainedTnt?.(tnt);

    this.lastTick = {
      pending: this.pending.length,
      processed,
      scanned,
      destroyed: destroyed.length,
      chainedTnt: chained.length,
      cpuMs: performance.now() - started,
      mutationMs: batch?.mutationMs ?? 0,
      relightMs: batch?.relightMs ?? 0,
      skyRecomputes: lightEngineStats.skyRecomputes - skyBefore,
    };
    return this.lastTick;
  }
}
