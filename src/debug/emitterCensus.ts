import { BLOCKS, BlockId, type BlockDefinition } from '../blocks';
import { CHUNK_SIZE } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelWorld } from '../world/World';

export interface EmitterCensusTotals {
  torch: number;
  lantern: number;
  glowstone: number;
  lava: number;
  fire: number;
  redstoneTorch: number;
  furnaceBurning: number;
  other: number;
  total: number;
  scannedChunks: number;
  loadedChunks: number;
  /** True after one full pass of the loaded set. Until then the counts are not a census. */
  passComplete: boolean;
}

const NAMED = new Set<number>([
  BlockId.Torch,
  BlockId.Lantern,
  BlockId.Glowstone,
  BlockId.Lava,
  BlockId.Fire,
  BlockId.RedstoneTorch,
  BlockId.Furnace,
]);

const OTHER_EMISSION = new Uint8Array(65536);
let emissionReady = false;

function prepareEmission(): void {
  if (emissionReady) return;
  for (const definition of BLOCKS as readonly BlockDefinition[]) {
    if ((definition.emission ?? 0) > 0 && !NAMED.has(definition.id)) OTHER_EMISSION[definition.id] = 1;
  }
  emissionReady = true;
}

export function emptyEmitterCensus(loadedChunks = 0): EmitterCensusTotals {
  return {
    torch: 0,
    lantern: 0,
    glowstone: 0,
    lava: 0,
    fire: 0,
    redstoneTorch: 0,
    furnaceBurning: 0,
    other: 0,
    total: 0,
    scannedChunks: 0,
    loadedChunks,
    passComplete: false,
  };
}

function addChunk(totals: EmitterCensusTotals, world: VoxelWorld, chunk: Chunk): void {
  prepareEmission();
  const columns = CHUNK_SIZE * CHUNK_SIZE;
  const blocks = chunk.blocks;
  const limit = Math.min(blocks.length, (chunk.scanMaxY() + 1) * columns);
  for (let index = 0; index < limit; index += 1) {
    const id = blocks[index]!;
    if (id === BlockId.Air) continue;
    switch (id) {
      case BlockId.Torch: totals.torch += 1; break;
      case BlockId.Lantern: totals.lantern += 1; break;
      case BlockId.Glowstone: totals.glowstone += 1; break;
      case BlockId.Lava: totals.lava += 1; break;
      case BlockId.Fire: totals.fire += 1; break;
      case BlockId.RedstoneTorch: totals.redstoneTorch += 1; break;
      case BlockId.Furnace: {
        const local = index % columns;
        const y = Math.floor(index / columns);
        const x = chunk.x * CHUNK_SIZE + (local % CHUNK_SIZE);
        const z = chunk.z * CHUNK_SIZE + Math.floor(local / CHUNK_SIZE);
        if (world.isFurnaceBurning(x, y, z)) totals.furnaceBurning += 1;
        break;
      }
      default:
        if (OTHER_EMISSION[id]) totals.other += 1;
        break;
    }
  }
  totals.total = totals.torch + totals.lantern + totals.glowstone + totals.lava
    + totals.fire + totals.redstoneTorch + totals.furnaceBurning + totals.other;
}

/** Gap between incremental chunk walks while a pass is open. Not an animation frame. */
export const EMITTER_CENSUS_INTERVAL_MS = 400;
/** How long a finished pass stays on screen before another pass may start. */
export const EMITTER_CENSUS_HOLD_MS = 4000;

/**
 * DEV census of loaded emitters. A pass walks a few chunks per step, only
 * through occupied height. Steps are at least `EMITTER_CENSUS_INTERVAL_MS`
 * apart. A finished pass is kept for `EMITTER_CENSUS_HOLD_MS`, unless the
 * loaded chunk set changes, which starts a new pass immediately. Frames in
 * between do not touch voxel arrays.
 */
export class EmitterCensusScanner {
  private world?: VoxelWorld;
  private keys: string[] = [];
  private cursor = 0;
  private partial = emptyEmitterCensus();
  private published = emptyEmitterCensus();
  private holding = false;
  private nextStepAt = 0;
  private holdUntil = 0;
  /** Chunks whose blocks were actually read. Frames inside the hold do not increase this. */
  chunkWalks = 0;

  /** Drop every total and the previous world. The next `advance` starts clean. */
  reset(): void {
    this.world = undefined;
    this.keys = [];
    this.cursor = 0;
    this.partial = emptyEmitterCensus();
    this.published = emptyEmitterCensus();
    this.holding = false;
    this.nextStepAt = 0;
    this.holdUntil = 0;
    this.chunkWalks = 0;
  }

  advance(world: VoxelWorld, chunkBudget = 1, nowMs = performance.now()): EmitterCensusTotals {
    if (this.world !== world) {
      this.reset();
      this.world = world;
      this.nextStepAt = nowMs;
    }
    const chunkSetChanged = this.keys.length > 0 && this.loadedSetChanged(world);
    if (this.holding) {
      if (nowMs < this.holdUntil && !chunkSetChanged) return this.view();
      this.holding = false;
      this.keys = [];
    }
    if (chunkSetChanged) this.nextStepAt = Math.min(this.nextStepAt, nowMs);
    if (nowMs < this.nextStepAt) return this.view();
    if (this.keys.length === 0 || this.loadedSetChanged(world)) this.startPass(world, nowMs);
    if (!this.holding) {
      this.scanStep(world, chunkBudget, nowMs);
      this.nextStepAt = nowMs + EMITTER_CENSUS_INTERVAL_MS;
    }
    return this.view();
  }

  private startPass(world: VoxelWorld, nowMs: number): void {
    this.holding = false;
    this.keys = [...world.chunks.keys()];
    this.cursor = 0;
    this.partial = emptyEmitterCensus(world.chunks.size);
    if (this.keys.length === 0) this.finishPass(world, nowMs);
  }

  private scanStep(world: VoxelWorld, chunkBudget: number, nowMs: number): void {
    const budget = Math.max(0, chunkBudget);
    const end = Math.min(this.keys.length, this.cursor + budget);
    for (; this.cursor < end; this.cursor += 1) {
      const chunk = world.chunks.get(this.keys[this.cursor]!);
      if (!chunk) continue;
      addChunk(this.partial, world, chunk);
      this.chunkWalks += 1;
    }
    if (this.cursor >= this.keys.length) this.finishPass(world, nowMs);
  }

  private finishPass(world: VoxelWorld, nowMs: number): void {
    this.partial.scannedChunks = this.keys.length;
    this.partial.loadedChunks = world.chunks.size;
    this.partial.passComplete = true;
    this.published = this.partial;
    this.partial = emptyEmitterCensus(world.chunks.size);
    this.holding = true;
    this.holdUntil = nowMs + EMITTER_CENSUS_HOLD_MS;
  }

  private loadedSetChanged(world: VoxelWorld): boolean {
    if (world.chunks.size !== this.keys.length) return true;
    let index = 0;
    for (const key of world.chunks.keys()) {
      if (this.keys[index] !== key) return true;
      index += 1;
    }
    return index !== this.keys.length;
  }

  private view(): EmitterCensusTotals {
    if (!this.published.passComplete) {
      return {
        ...emptyEmitterCensus(this.world?.chunks.size ?? 0),
        scannedChunks: this.cursor,
        loadedChunks: this.world?.chunks.size ?? 0,
        passComplete: false,
      };
    }
    return this.published;
  }
}

export function formatEmitterCensus(totals: EmitterCensusTotals): string {
  if (!totals.passComplete) {
    return `EMIT scanning ${totals.scannedChunks}/${totals.loadedChunks} (not a final count)`;
  }
  return `EMIT torch ${totals.torch} lantern ${totals.lantern} glow ${totals.glowstone} lava ${totals.lava} fire ${totals.fire} rtorch ${totals.redstoneTorch} furnace ${totals.furnaceBurning} other ${totals.other} total ${totals.total} scan ${totals.scannedChunks}/${totals.loadedChunks}`;
}

export function formatLightOwner(owner: string, regionOwner: string, addOwner: string): string {
  if (!owner) return 'idle';
  if (owner === regionOwner) return 'region';
  if (owner === addOwner) return 'add-emitter';
  return owner;
}
