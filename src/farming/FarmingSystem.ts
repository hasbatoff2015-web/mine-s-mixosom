import { BlockId, getBlockDefinition } from '../blocks';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../core/constants';
import { systemRandomFn, type RandomFn } from '../gameplay/random';
import { Chunk } from '../world/Chunk';
import type { CommittedBlockChange, VoxelWorld } from '../world/World';
import {
  FARMING_BLOCKS,
  FARMING_DIRECTIONS,
  FARMING_FRUIT_CHANCE,
  FARMING_GROWTH_PULSE_TICKS,
  FARMING_HYDRATION_PULSE_TICKS,
  MAX_CROP_AGE,
  cropAge,
  growthChance,
  isCropBlock,
  isStemBlock,
} from './definitions';

export interface FarmingPosition { readonly x: number; readonly y: number; readonly z: number }
export interface FarmingActiveCenter { readonly x: number; readonly z: number }
export interface FarmingTickStats {
  readonly indexed: number;
  readonly visited: number;
  readonly stateWrites: number;
  readonly fruitWrites: number;
}

function positionKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class FarmingSystem {
  private readonly positionsByChunk = new Map<string, Map<string, FarmingPosition>>();
  private readonly scannedChunks = new Set<string>();
  private readonly waterByChunk = new Map<string, Map<string, FarmingPosition>>();
  private readonly scannedWaterChunks = new Set<string>();
  private readonly stopObserving: () => void;
  private readonly random: RandomFn;
  private indexedCount = 0;
  lastTickStats: FarmingTickStats = { indexed: 0, visited: 0, stateWrites: 0, fruitWrites: 0 };

  constructor(private readonly world: VoxelWorld, options: { random?: RandomFn } = {}) {
    this.random = options.random ?? systemRandomFn;
    this.stopObserving = world.observeCommittedBlocks((changes) => this.onBlocksChanged(changes));
  }

  dispose(): void {
    this.stopObserving();
    this.positionsByChunk.clear();
    this.scannedChunks.clear();
    this.waterByChunk.clear();
    this.scannedWaterChunks.clear();
    this.indexedCount = 0;
  }

  get size(): number { return this.indexedCount; }

  tick(activeCenters?: readonly FarmingActiveCenter[]): FarmingTickStats {
    this.syncLoadedChunks();
    let visited = 0;
    let stateWrites = 0;
    let fruitWrites = 0;
    const hydrationPulse = this.world.tickNumber % FARMING_HYDRATION_PULSE_TICKS === 0;
    const growthPulse = this.world.tickNumber % FARMING_GROWTH_PULSE_TICKS === 0;
    if (!hydrationPulse && !growthPulse) {
      return this.lastTickStats = { indexed: this.indexedCount, visited, stateWrites, fruitWrites };
    }

    const active: Array<{ position: FarmingPosition; block: BlockId }> = [];
    for (const [key, positions] of [...this.positionsByChunk.entries()]) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      if (!this.isActiveChunk(cx, cz, activeCenters)) continue;
      for (const position of [...positions.values()]) {
        visited += 1;
        const block = this.world.getBlock(position.x, position.y, position.z, false);
        if (!FARMING_BLOCKS.has(block)) {
          this.remove(position.x, position.y, position.z);
          continue;
        }
        active.push({ position, block });
      }
    }
    // Hydration is a distinct phase so crops observe the current pulse even if
    // restored modification insertion order placed a crop before its farmland.
    if (hydrationPulse) for (const { position, block } of active) {
      if (block !== BlockId.Farmland) continue;
      const hydrated = this.hasNearbyWater(position.x, position.y, position.z);
      if ((this.world.getBlockState(position.x, position.y, position.z)?.hydrated === true) !== hydrated) {
        this.world.setBlockState(position.x, position.y, position.z, { hydrated });
        stateWrites += 1;
      }
    }
    if (growthPulse) for (const { position, block } of active) {
      if (!isCropBlock(block)) continue;
      if (this.world.getBlock(position.x, position.y - 1, position.z, false) !== BlockId.Farmland) continue;
      if (this.world.getBlockState(position.x, position.y - 1, position.z)?.hydrated !== true) continue;
      const age = cropAge(this.world.getBlockState(position.x, position.y, position.z));
      if (age < MAX_CROP_AGE) {
        if (this.random() < growthChance(block)) {
          this.world.setBlockState(position.x, position.y, position.z, { age: age + 1 });
          stateWrites += 1;
        }
      } else if (isStemBlock(block) && this.random() < FARMING_FRUIT_CHANCE && this.tryGrowFruit(position, block)) {
        fruitWrites += 1;
      }
    }
    return this.lastTickStats = { indexed: this.indexedCount, visited, stateWrites, fruitWrites };
  }

  private syncLoadedChunks(): void {
    for (const key of [...this.scannedChunks]) {
      if (this.world.chunks.has(key)) continue;
      this.scannedChunks.delete(key);
      this.scannedWaterChunks.delete(key);
      this.waterByChunk.delete(key);
      const positions = this.positionsByChunk.get(key);
      if (positions) this.indexedCount -= positions.size;
      this.positionsByChunk.delete(key);
    }
    for (const [key, chunk] of this.world.chunks) {
      if (this.scannedChunks.has(key)) continue;
      this.scannedChunks.add(key);
      this.scanChunk(key, chunk);
    }
  }

  private scanChunk(key: string, chunk: Chunk): void {
    // Farming never occurs in generation: restored edits are already sparse.
    // Reading the chunk delta avoids a one-time full scan of every active chunk.
    for (const [index] of this.world.modifications.get(key) ?? []) {
      const y = Chunk.yFromIndex(index);
      const local = index % (CHUNK_SIZE * CHUNK_SIZE);
      const z = Math.floor(local / CHUNK_SIZE);
      const x = local % CHUNK_SIZE;
      const block = chunk.get(x, y, z) as BlockId;
      if (FARMING_BLOCKS.has(block)) this.add(chunk.x * CHUNK_SIZE + x, y, chunk.z * CHUNK_SIZE + z, key);
    }
  }

  private onBlocksChanged(changes: readonly CommittedBlockChange[]): void {
    for (const change of changes) {
      if (FARMING_BLOCKS.has(change.previous)) this.remove(change.x, change.y, change.z);
      if (FARMING_BLOCKS.has(change.block)) this.add(change.x, change.y, change.z);
      if (change.previous === BlockId.Water) this.removeWater(change.x, change.y, change.z);
      if (change.block === BlockId.Water) this.addWater(change.x, change.y, change.z);
    }
  }

  private add(x: number, y: number, z: number, knownChunkKey?: string): void {
    const key = knownChunkKey ?? chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    let positions = this.positionsByChunk.get(key);
    if (!positions) this.positionsByChunk.set(key, positions = new Map());
    const keyInChunk = positionKey(x, y, z);
    if (positions.has(keyInChunk)) return;
    positions.set(keyInChunk, { x, y, z });
    this.indexedCount += 1;
  }

  private remove(x: number, y: number, z: number): void {
    const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    const positions = this.positionsByChunk.get(key);
    if (!positions?.delete(positionKey(x, y, z))) return;
    this.indexedCount -= 1;
    if (positions.size === 0) this.positionsByChunk.delete(key);
  }

  private isActiveChunk(cx: number, cz: number, centers?: readonly FarmingActiveCenter[]): boolean {
    if (centers === undefined) return this.world.inMeshRadius(cx, cz);
    if (centers.length === 0) return false;
    return centers.some((center) => Math.max(
      Math.abs(cx - floorDiv(center.x, CHUNK_SIZE)),
      Math.abs(cz - floorDiv(center.z, CHUNK_SIZE)),
    ) <= this.world.meshRadius);
  }

  private hasNearbyWater(x: number, y: number, z: number): boolean {
    const minCx = floorDiv(x - 4, CHUNK_SIZE), maxCx = floorDiv(x + 4, CHUNK_SIZE);
    const minCz = floorDiv(z - 4, CHUNK_SIZE), maxCz = floorDiv(z + 4, CHUNK_SIZE);
    for (let cz = minCz; cz <= maxCz; cz += 1) for (let cx = minCx; cx <= maxCx; cx += 1) {
      const key = chunkKey(cx, cz);
      this.ensureWaterIndex(key);
      for (const water of this.waterByChunk.get(key)?.values() ?? []) {
        if ((water.y === y || water.y === y + 1)
          && Math.max(Math.abs(water.x - x), Math.abs(water.z - z)) <= 4) return true;
      }
    }
    return false;
  }

  private ensureWaterIndex(key: string): void {
    if (this.scannedWaterChunks.has(key)) return;
    const chunk = this.world.chunks.get(key);
    if (!chunk) return;
    this.scannedWaterChunks.add(key);
    for (let y = 0; y <= chunk.scanMaxY(); y += 1) for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) if (chunk.get(x, y, z) === BlockId.Water) {
        this.addWater(chunk.x * CHUNK_SIZE + x, y, chunk.z * CHUNK_SIZE + z, key);
      }
    }
  }

  private addWater(x: number, y: number, z: number, knownChunkKey?: string): void {
    const key = knownChunkKey ?? chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    let positions = this.waterByChunk.get(key);
    if (!positions) this.waterByChunk.set(key, positions = new Map());
    positions.set(positionKey(x, y, z), { x, y, z });
  }

  private removeWater(x: number, y: number, z: number): void {
    const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    const positions = this.waterByChunk.get(key);
    positions?.delete(positionKey(x, y, z));
    if (positions?.size === 0) this.waterByChunk.delete(key);
  }

  private tryGrowFruit(position: FarmingPosition, stem: BlockId): boolean {
    const fruit = stem === BlockId.MelonStem ? BlockId.Melon : BlockId.Pumpkin;
    if (FARMING_DIRECTIONS.some(({ dx, dz }) =>
      this.world.getBlock(position.x + dx, position.y, position.z + dz, false) === fruit)) return false;
    const valid = FARMING_DIRECTIONS.filter(({ dx, dz }) => {
      const x = position.x + dx, z = position.z + dz;
      const target = this.world.getBlock(x, position.y, z, false);
      const below = this.world.getBlock(x, position.y - 1, z, false);
      return (target === BlockId.Air || getBlockDefinition(target).replaceable === true)
        && (below === BlockId.Dirt || below === BlockId.GrassBlock || below === BlockId.Farmland);
    });
    if (valid.length === 0) return false;
    const direction = valid[Math.min(valid.length - 1, Math.floor(this.random() * valid.length))]!;
    return this.world.setBlock(position.x + direction.dx, position.y, position.z + direction.dz, fruit);
  }
}
