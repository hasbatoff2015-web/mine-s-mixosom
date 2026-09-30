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

/**
 * DEV census of loaded emitters. One or two chunks per animation frame, only
 * through each chunk's occupied height. The published totals update when a
 * pass finishes, so the overlay does not walk every loaded Y every frame.
 */
export class EmitterCensusScanner {
  private keys: string[] = [];
  private cursor = 0;
  private partial = emptyEmitterCensus();
  private published = emptyEmitterCensus();

  advance(world: VoxelWorld, chunkBudget = 1): EmitterCensusTotals {
    const loaded = world.chunks.size;
    if (this.keys.length !== loaded || this.cursor === 0) {
      const next = [...world.chunks.keys()];
      if (next.length !== this.keys.length || next.some((key, index) => key !== this.keys[index])) {
        this.keys = next;
        this.cursor = 0;
        this.partial = emptyEmitterCensus(loaded);
      }
    }
    const budget = Math.max(0, chunkBudget);
    const end = Math.min(this.keys.length, this.cursor + budget);
    for (; this.cursor < end; this.cursor += 1) {
      const chunk = world.chunks.get(this.keys[this.cursor]!);
      if (chunk) addChunk(this.partial, world, chunk);
    }
    if (this.keys.length === 0) {
      this.published = { ...emptyEmitterCensus(0), passComplete: true, scannedChunks: 0 };
      return this.published;
    }
    if (this.cursor >= this.keys.length) {
      this.partial.scannedChunks = this.keys.length;
      this.partial.loadedChunks = loaded;
      this.partial.passComplete = true;
      this.published = this.partial;
      this.partial = emptyEmitterCensus(loaded);
      this.cursor = 0;
      this.keys = [...world.chunks.keys()];
    }
    if (!this.published.passComplete) {
      return {
        ...emptyEmitterCensus(loaded),
        scannedChunks: this.cursor,
        loadedChunks: loaded,
        passComplete: false,
      };
    }
    return { ...this.published, loadedChunks: loaded };
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
