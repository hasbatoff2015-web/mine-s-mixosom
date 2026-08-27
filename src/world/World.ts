import * as THREE from 'three';
import { migrateLegacyStack } from '../inventory/legacyItems';
import { BlockId, getBlockDefinition, torchBlockEmission, type BlockRenderState } from '../blocks';
import { rayAabbDistance } from './collision';
import { blockSelectionBoxes } from './selection';
import { needsBlockSupport, supportCellForBlock, isBlockStillSupported } from './placement';
import { CHUNK_SIZE, LIGHTING_HALO_CHUNKS, WORLD_HEIGHT, blockKey, chunkKey, floorDiv, parseBlockKey, positiveMod } from '../core/constants';
import { findSmeltingRecipe, getFuelBurnTicks } from '../crafting';
import type { ItemStack } from '../inventory';
import { getItemDefinition } from '../items';
import type { SerializedWorldState } from '../save/types';
import { Chunk } from './Chunk';
import { TerrainGenerator, type Biome } from './Generator';
import {
  consumeLightTouched,
  continuePendingLight,
  getBlockLight,
  getSkyLight,
  lightingFloodOwner,
  abandonLightingFloodIfOrphaned,
  resetIncompleteBlockLighting,
  resetRegionLightFlood,
  lightEngineStats,
  lightFrameStats,
  processChunkLighting,
  relightAround,
  relightRegion,
  addBlockLightEmitters,
  resetLightFrameStats,
  skyOcclusionClass,
  lightingInvalidation,
  recomputeSkyColumnAt,
  LIGHT_FLOOD_ADD_EMITTER,
  LIGHT_FLOOD_REGION,
  type LightJobOrigin,
  type LightRegion,
  type PendingLightJob,
} from './LightEngine';
import { chebyshevChunkDistance, neighborFluidMeshOffsets, neighborMeshOffsets } from './worldJobs';
import {
  FLUID_QUEUE_CAP,
  activateGeneratedFluidBoundaries,
  fluidTickDelay,
  isFluidBlock,
  processFluidQueue,
} from './fluids';
import {
  collectUnlitLightJobs,
  criticalUnlitKeys,
  isLightJobBlockedByFlood,
  lightingUnlockNeighborKeys,
  shouldPreemptDistantLightingFlood,
} from './streamingScheduler';

const SUPPORT_NEIGHBORS = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0],
  [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  block: BlockId;
  normal: THREE.Vector3;
  distance: number;
  point: THREE.Vector3;
}

export interface DetachedBlockEvent {
  x: number; y: number; z: number; block: BlockId;
  reason: 'support' | 'water' | 'lava';
}

export interface FallingBlockSpawn {
  x: number;
  y: number;
  z: number;
  block: BlockId;
}

export interface BlockMutation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockId;
}

export interface BlockBatchOptions {
  readonly record?: boolean;
  readonly updateLighting?: boolean;
  readonly scheduleNeighbors?: boolean;
  /** Queue lighting instead of flushing immediately. Gameplay flushes once per frame. */
  readonly deferLighting?: boolean;
  readonly lightOrigin?: LightJobOrigin;
}

export interface BlockBatchStats {
  readonly applied: number;
  readonly chunksDirtied: number;
  readonly skyRecomputes: number;
  readonly mutationMs: number;
  readonly relightMs: number;
}

export interface ChestState {
  slots: Array<ItemStack | null>;
}

export interface FurnaceState {
  slots: [ItemStack | null, ItemStack | null, ItemStack | null];
  burnTime: number;
  burnTotal: number;
  cookTime: number;
}

interface ScheduledBlockTick {
  x: number;
  y: number;
  z: number;
  due: number;
}

export interface ScheduledFluidTick {
  x: number;
  y: number;
  z: number;
  due: number;
  readonly block: BlockId;
}

export interface FluidHudStats {
  readonly q: number;
  readonly active: number;
  readonly updates: number;
  readonly writes: number;
  readonly noop: number;
  readonly dedupe: number;
  readonly meshDirtyChunks: number;
  readonly lightDirtyChunks: number;
  readonly pausedDistant: number;
  readonly oldest: number;
}

export interface LightOriginHudCounts {
  readonly stream: number;
  readonly fluid: number;
  readonly edit: number;
  readonly other: number;
}

export class VoxelWorld {
  readonly chunks = new Map<string, Chunk>();
  readonly modifications = new Map<string, Map<number, BlockId>>();
  readonly chests = new Map<string, ChestState>();
  readonly furnaces = new Map<string, FurnaceState>();
  readonly blockStates = new Map<string, BlockRenderState>();
  readonly generator: TerrainGenerator;
  timeOfDay = 1_000;
  tickNumber = 0;
  generationSamples = 0;
  generationTotalMs = 0;
  generationMaximumMs = 0;
  meshDirtyMarks = 0;
  lightQueueMarks = 0;
  mutationMarks = 0;
  fluidUpdates = 0;
  fluidWrites = 0;
  fluidQueuePeak = 0;
  fluidNoops = 0;
  fluidDedupe = 0;
  fluidPausedDistant = 0;
  fluidOldestDueTicks = 0;
  fluidMeshDirtyChunks = 0;
  fluidLightDirtyChunks = 0;
  lightOriginCounts: LightOriginHudCounts = { stream: 0, fluid: 0, edit: 0, other: 0 };
  readonly pendingMesh = new Set<string>();
  private pendingLight?: PendingLightJob;
  private pendingEmitters: Array<readonly [number, number, number]> = [];
  private readonly pendingEmitterLightKeys = new Set<string>();
  meshRadius = 32;
  generationRadius = 32 + LIGHTING_HALO_CHUNKS;
  viewChunkX = 0;
  viewChunkZ = 0;
  private readonly scheduled: ScheduledBlockTick[] = [];
  private readonly scheduledKeys = new Set<string>();
  private readonly pendingFalls: FallingBlockSpawn[] = [];
  private readonly supportQueue = new Map<string, readonly [number, number, number]>();
  private readonly detachedBlocks: DetachedBlockEvent[] = [];
  private fluidScheduled: ScheduledFluidTick[] = [];
  private readonly fluidKeys = new Map<string, ScheduledFluidTick>();
  private trackFluidDirty = false;
  private readonly fluidMeshDirtyKeys = new Set<string>();
  private readonly fluidLightDirtyKeys = new Set<string>();

  constructor(readonly seed: string) {
    this.generator = new TerrainGenerator(seed);
  }

  restore(state: Pick<SerializedWorldState, 'timeOfDay' | 'modifications' | 'chests' | 'furnaces' | 'blockStates'>): void {
    this.timeOfDay = state.timeOfDay;
    for (const [key, entries] of Object.entries(state.modifications)) {
      const delta = new Map<number, BlockId>();
      for (const [index, block] of Object.entries(entries)) delta.set(Number(index), block as BlockId);
      this.modifications.set(key, delta);
    }
    for (const [key, value] of Object.entries(state.chests)) {
      const chest = value as ChestState;
      this.chests.set(key, { ...chest, slots: chest.slots.map(migrateLegacyStack) });
    }
    for (const [key, value] of Object.entries(state.furnaces)) {
      const furnace = value as FurnaceState;
      this.furnaces.set(key, { ...furnace, slots: furnace.slots.map(migrateLegacyStack) as FurnaceState['slots'] });
    }
    if (state.blockStates) {
      for (const [key, value] of Object.entries(state.blockStates)) {
        this.blockStates.set(key, value as BlockRenderState);
      }
    }
  }

  getChunk(chunkX: number, chunkZ: number, generate = true): Chunk | undefined {
    const key = chunkKey(chunkX, chunkZ);
    let chunk = this.chunks.get(key);
    if (!chunk && generate) {
      const generationStart = performance.now();
      chunk = new Chunk(chunkX, chunkZ);
      this.generator.generate(chunk);
      const delta = this.modifications.get(key);
      if (delta) for (const [index, block] of delta) chunk.blocks[index] = block;
      this.chunks.set(key, chunk);
      activateGeneratedFluidBoundaries(this, chunk);
      const generationMilliseconds = performance.now() - generationStart;
      this.generationSamples += 1;
      this.generationTotalMs += generationMilliseconds;
      this.generationMaximumMs = Math.max(this.generationMaximumMs, generationMilliseconds);
      this.markMeshDirty(chunk);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const neighbor = this.chunks.get(chunkKey(chunkX + dx, chunkZ + dz));
        if (neighbor) this.markMeshDirty(neighbor);
      }
    }
    if (chunk) chunk.lastTouched = performance.now();
    return chunk;
  }

  setViewCenter(blockX: number, blockZ: number, meshRadius: number): void {
    this.viewChunkX = floorDiv(blockX, CHUNK_SIZE);
    this.viewChunkZ = floorDiv(blockZ, CHUNK_SIZE);
    this.meshRadius = Math.max(0, Math.floor(meshRadius));
    this.generationRadius = this.meshRadius + LIGHTING_HALO_CHUNKS;
  }

  inMeshRadius(chunkX: number, chunkZ: number): boolean {
    return Math.max(Math.abs(chunkX - this.viewChunkX), Math.abs(chunkZ - this.viewChunkZ)) <= this.meshRadius;
  }

  inGenerationRadius(chunkX: number, chunkZ: number): boolean {
    return Math.max(Math.abs(chunkX - this.viewChunkX), Math.abs(chunkZ - this.viewChunkZ)) <= this.generationRadius;
  }

  ensureChunkLighting(chunk: Chunk): void {
    processChunkLighting(this, chunk);
    if (chunk.lightingReady) this.applyInitialLightingVersions(chunk);
  }

  noteLightDataChanged(chunk: Chunk): void {
    chunk.bumpLightVersion();
    this.markMeshDirty(chunk);
  }

  /** After a chunk first becomes lit: remesh it and any already-drawn neighbors. */
  applyInitialLightingVersions(chunk: Chunk): void {
    const touched = consumeLightTouched();
    this.noteLightDataChanged(chunk);
    if (chunk.dirty && chunk.readyToMeshAt === 0) chunk.readyToMeshAt = performance.now();
    for (const other of touched) {
      if (other === chunk) continue;
      if (other.meshedLightVersion >= 0) this.noteLightDataChanged(other);
    }
  }

  private bumpDirtyLightVersions(keys: Iterable<string>): void {
    consumeLightTouched();
    for (const key of keys) {
      const chunk = this.chunks.get(key);
      if (chunk?.lightingReady) chunk.bumpLightVersion();
    }
  }

  private bumpDirtyInRegion(region: LightRegion): void {
    consumeLightTouched();
    const minChunkX = floorDiv(region.minX, CHUNK_SIZE);
    const maxChunkX = floorDiv(region.maxX, CHUNK_SIZE);
    const minChunkZ = floorDiv(region.minZ, CHUNK_SIZE);
    const maxChunkZ = floorDiv(region.maxZ, CHUNK_SIZE);
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        const chunk = this.chunks.get(chunkKey(chunkX, chunkZ));
        if (chunk?.dirty && chunk.lightingReady) chunk.bumpLightVersion();
      }
    }
  }

  private collectEmitterLightTouches(): void {
    for (const chunk of consumeLightTouched()) {
      if (chunk.lightingReady) this.pendingEmitterLightKeys.add(chunkKey(chunk.x, chunk.z));
    }
  }

  private commitEmitterLightVersions(): void {
    consumeLightTouched();
    for (const key of this.pendingEmitterLightKeys) {
      const chunk = this.chunks.get(key);
      if (chunk?.lightingReady) chunk.bumpLightVersion();
    }
    this.pendingEmitterLightKeys.clear();
  }

  getBlockState(x: number, y: number, z: number): BlockRenderState | undefined {
    return this.blockStates.get(blockKey(x, y, z));
  }

  setBlockState(x: number, y: number, z: number, state: BlockRenderState): boolean {
    if (this.fluidStateUnchanged(this.getBlockState(x, y, z), state)) {
      this.noteFluidNoop();
      return false;
    }
    this.blockStates.set(blockKey(x, y, z), state);
    if (state.fluidLevel === undefined) this.queueSupportAround(x, y, z);
    const chunkX = floorDiv(x, CHUNK_SIZE);
    const chunkZ = floorDiv(z, CHUNK_SIZE);
    const localX = positiveMod(x, CHUNK_SIZE);
    const localZ = positiveMod(z, CHUNK_SIZE);
    const chunk = this.getChunk(chunkX, chunkZ, false);
    if (chunk) this.markMeshDirty(chunk);
    const dirty = new Set<string>();
    for (const [dx, dz] of neighborFluidMeshOffsets(localX, localZ)) {
      this.dirtyNeighbor(chunkX + dx, chunkZ + dz, dirty);
    }
    return true;
  }

  private fluidStateUnchanged(previous: BlockRenderState | undefined, next: BlockRenderState): boolean {
    const extra = Object.keys(next).filter((key) => key !== 'fluidLevel' && key !== 'fluidFalling');
    if (extra.length > 0) return false;
    const prevFalling = previous?.fluidFalling === true;
    const nextFalling = next.fluidFalling === true;
    const prevLevel = previous?.fluidLevel;
    const nextLevel = next.fluidLevel;
    const prevDefaultSource = previous === undefined || (prevLevel === undefined && !prevFalling);
    const nextDefaultSource = (nextLevel === undefined || nextLevel >= 8) && !nextFalling;
    if (prevDefaultSource && nextDefaultSource) return true;
    return previous !== undefined && prevLevel === nextLevel && prevFalling === nextFalling;
  }

  skyLightAt(x: number, y: number, z: number): number {
    return getSkyLight(this, x, y, z);
  }

  blockLightAt(x: number, y: number, z: number): number {
    return getBlockLight(this, x, y, z);
  }

  consumeFallingBlocks(): FallingBlockSpawn[] {
    return this.pendingFalls.splice(0);
  }

  consumeDetachedBlocks(): DetachedBlockEvent[] {
    return this.detachedBlocks.splice(0);
  }

  private queueSupportAround(x: number, y: number, z: number): void {
    for (const [dx, dy, dz] of SUPPORT_NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (needsBlockSupport(this.getBlock(nx, ny, nz, false))) {
        this.supportQueue.set(blockKey(nx, ny, nz), [nx, ny, nz]);
      }
    }
  }

  /** Deferred to the fixed tick so placement can assign orientation atomically.
   * Local FIFO/dedupe only; cascades retain overflow, never scan the world.
   */
  processSupportIntegrity(budget = 256): number {
    budget = Math.min(budget, this.supportQueue.size);
    let processed = 0;
    const removals: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
    for (const [key, [x, y, z]] of this.supportQueue) {
      if (processed >= budget) break;
      this.supportQueue.delete(key);
      processed++;
      const block = this.getBlock(x, y, z, false);
      const support = supportCellForBlock(block, this.getBlockState(x, y, z), x, y, z);
      if (!support) continue;
      // Unloaded neighbor is unknown, not air. Retain one ticket for later loading.
      if (!this.getChunk(floorDiv(support.x, CHUNK_SIZE), floorDiv(support.z, CHUNK_SIZE), false)) {
        this.supportQueue.set(key, [x, y, z]);
        continue;
      }
      if (!isBlockStillSupported(this, x, y, z)) {
        removals.push({ x, y, z, block: BlockId.Air });
        this.detachedBlocks.push({ x, y, z, block, reason: 'support' });
      }
    }
    if (removals.length) this.applyBlockBatch(removals, { deferLighting: true });
    return processed;
  }

  get dirtyChunkCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) if (chunk.dirty) count += 1;
    return count;
  }

  get generationAverageMs(): number {
    return this.generationTotalMs / Math.max(1, this.generationSamples);
  }

  getBlock(x: number, y: number, z: number, generate = true): BlockId {
    if (y < 0 || y >= WORLD_HEIGHT) return y < 0 ? BlockId.Bedrock : BlockId.Air;
    const chunk = this.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), generate);
    return (chunk?.get(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE)) ?? BlockId.Air) as BlockId;
  }

  setBlock(x: number, y: number, z: number, block: BlockId, record = true): boolean {
    const result = this.applyBlockBatch([{ x, y, z, block }], {
      record,
      updateLighting: true,
      scheduleNeighbors: true,
    });
    return result.applied > 0;
  }

  /**
   * Applies many voxel writes as one logical operation: one dirty per chunk,
   * one sky recompute per affected chunk, one block-light pass for the union region.
   */
  applyBlockBatch(mutations: readonly BlockMutation[], options: BlockBatchOptions = {}): BlockBatchStats {
    const record = options.record !== false;
    const updateLighting = options.updateLighting !== false;
    const scheduleNeighbors = options.scheduleNeighbors !== false;
    const mutationStart = performance.now();
    const dirtyChunks = new Set<string>();
    let applied = 0;

    const unique = new Map<string, BlockMutation>();
    for (const mutation of mutations) {
      unique.set(blockKey(mutation.x, mutation.y, mutation.z), mutation);
    }
    this.mutationMarks += unique.size;

    const skyColumns = new Set<string>();
    const addedEmitters: Array<readonly [number, number, number]> = [];
    let regionSky = false;
    let regionBlock = false;
    let regionEmission = false;
    let rMinX = Infinity;
    let rMinY = Infinity;
    let rMinZ = Infinity;
    let rMaxX = -Infinity;
    let rMaxY = -Infinity;
    let rMaxZ = -Infinity;
    let regionRadius = 0;

    for (const mutation of unique.values()) {
      const wrote = this.writeBlockRaw(mutation.x, mutation.y, mutation.z, mutation.block, record, dirtyChunks);
      if (!wrote) continue;
      applied += 1;
      const action = lightingInvalidation(wrote.previous, mutation.block);
      if (action === 'localSky' || action === 'addEmitter') {
        skyColumns.add(`${mutation.x},${mutation.z}`);
      }
      if (action === 'addEmitter' && (getBlockDefinition(mutation.block).emission ?? 0) > 0) {
        addedEmitters.push([mutation.x, mutation.y, mutation.z]);
      }
      if (action === 'region') {
        regionSky = regionSky || wrote.skyChanged;
        regionBlock = regionBlock || wrote.emissionChanged || wrote.occlusionChanged;
        regionEmission = regionEmission || wrote.emissionChanged;
        regionRadius = Math.max(regionRadius, wrote.lightRadius);
        rMinX = Math.min(rMinX, mutation.x);
        rMinY = Math.min(rMinY, mutation.y);
        rMinZ = Math.min(rMinZ, mutation.z);
        rMaxX = Math.max(rMaxX, mutation.x);
        rMaxY = Math.max(rMaxY, mutation.y);
        rMaxZ = Math.max(rMaxZ, mutation.z);
      }
      if (scheduleNeighbors) {
        this.schedule(mutation.x, mutation.y, mutation.z, 1);
        this.schedule(mutation.x, mutation.y + 1, mutation.z, 1);
        this.scheduleFluidAround(mutation.x, mutation.y, mutation.z);
      }
    }

    const mutationMs = performance.now() - mutationStart;
    let relightMs = 0;
    const skyBefore = this.skyRecomputeSnapshot();
    const hasRegion = Number.isFinite(rMinX) && (regionSky || regionBlock);
    if (applied > 0 && updateLighting) {
      const relightStart = performance.now();
      for (const key of skyColumns) {
        const split = key.split(',');
        const columnX = Number(split[0]);
        const columnZ = Number(split[1]);
        recomputeSkyColumnAt(this, columnX, columnZ);
        this.noteLightDirtyChunk(floorDiv(columnX, CHUNK_SIZE), floorDiv(columnZ, CHUNK_SIZE));
      }
      if (addedEmitters.length > 0 && !hasRegion) {
        if (options.deferLighting) {
          this.pendingEmitters.push(...addedEmitters);
        } else {
          addBlockLightEmitters(this, addedEmitters);
        }
      }
      if (hasRegion) {
        const skyRadius = regionSky ? 4 : 0;
        const blockRadius = regionBlock ? regionRadius : 0;
        const radius = Math.max(skyRadius, blockRadius);
        const region: LightRegion = {
          minX: rMinX - radius,
          minY: rMinY - (regionBlock ? blockRadius : 0),
          minZ: rMinZ - radius,
          maxX: rMaxX + radius,
          maxY: rMaxY + (regionBlock ? blockRadius : 0),
          maxZ: rMaxZ + radius,
        };
        if (options.deferLighting) {
          this.queueLight(region, regionSky, regionBlock, options.lightOrigin ?? 'edit');
        } else {
          if (regionSky) {
            relightRegion(this, {
              minX: rMinX - skyRadius,
              minY: 0,
              minZ: rMinZ - skyRadius,
              maxX: rMaxX + skyRadius,
              maxY: WORLD_HEIGHT - 1,
              maxZ: rMaxZ + skyRadius,
            }, true, false);
          }
          if (regionBlock) {
            relightRegion(this, {
              minX: rMinX - blockRadius,
              minY: rMinY - blockRadius,
              minZ: rMinZ - blockRadius,
              maxX: rMaxX + blockRadius,
              maxY: rMaxY + blockRadius,
              maxZ: rMaxZ + blockRadius,
            }, false, true);
          }
        }
        if (regionEmission) {
          this.markLightRegionDirty(
            rMinX - regionRadius,
            rMinZ - regionRadius,
            rMaxX + regionRadius,
            rMaxZ + regionRadius,
          );
        }
      }
      for (const chunk of consumeLightTouched()) {
        if (chunk.lightingReady) chunk.bumpLightVersion();
      }
      if (!options.deferLighting) this.bumpDirtyLightVersions(this.pendingMesh);
      relightMs = performance.now() - relightStart;
    }

    return {
      applied,
      chunksDirtied: dirtyChunks.size,
      skyRecomputes: lightEngineStats.skyRecomputes - skyBefore,
      mutationMs,
      relightMs,
    };
  }

  private skyRecomputeSnapshot(): number {
    return lightEngineStats.skyRecomputes;
  }

  private markLightRegionDirty(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const minChunkX = floorDiv(minX, CHUNK_SIZE);
    const maxChunkX = floorDiv(maxX, CHUNK_SIZE);
    const minChunkZ = floorDiv(minZ, CHUNK_SIZE);
    const maxChunkZ = floorDiv(maxZ, CHUNK_SIZE);
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        const chunk = this.getChunk(chunkX, chunkZ, false);
        if (chunk) this.markMeshDirty(chunk);
      }
    }
  }

  private writeBlockRaw(
    x: number,
    y: number,
    z: number,
    block: BlockId,
    record: boolean,
    dirtyChunks: Set<string>,
  ): { previous: BlockId; occlusionChanged: boolean; emissionChanged: boolean; skyChanged: boolean; lightRadius: number } | undefined {
    if (y < 0 || y >= WORLD_HEIGHT) return undefined;
    const chunkX = floorDiv(x, CHUNK_SIZE);
    const chunkZ = floorDiv(z, CHUNK_SIZE);
    const localX = positiveMod(x, CHUNK_SIZE);
    const localZ = positiveMod(z, CHUNK_SIZE);
    const chunk = this.getChunk(chunkX, chunkZ)!;
    const previous = chunk.get(localX, y, localZ) as BlockId;
    if (previous === block) return undefined;
    // A new material/lifetime must not inherit an old pending (or in-flight) deadline.
    this.cancelFluidTick(x, y, z);
    const previousDefinition = getBlockDefinition(previous);
    chunk.set(localX, y, localZ, block);
    this.blockStates.delete(blockKey(x, y, z));
    this.queueSupportAround(x, y, z);
    if ((block === BlockId.Water || block === BlockId.Lava)
      && previous !== BlockId.Air && previous !== BlockId.Fire && !previousDefinition.liquid
      && (previousDefinition.fluidDisplaceable || previousDefinition.replaceable)) {
      this.detachedBlocks.push({ x, y, z, block: previous, reason: block === BlockId.Water ? 'water' : 'lava' });
    }
    if (record) {
      const key = chunkKey(chunkX, chunkZ);
      let delta = this.modifications.get(key);
      if (!delta) {
        delta = new Map();
        this.modifications.set(key, delta);
      }
      delta.set(Chunk.index(localX, y, localZ), block);
    }
    this.markMeshDirty(chunk);
    dirtyChunks.add(chunkKey(chunkX, chunkZ));
    const nextDefinition = getBlockDefinition(block);
    const liquidTouch = previousDefinition.liquid === true || nextDefinition.liquid === true;
    const offsets = liquidTouch ? neighborFluidMeshOffsets(localX, localZ) : neighborMeshOffsets(localX, localZ);
    for (const [dx, dz] of offsets) {
      this.dirtyNeighbor(chunkX + dx, chunkZ + dz, dirtyChunks);
    }
    const occlusionChanged = previousDefinition.occludesFaces !== nextDefinition.occludesFaces;
    const emissionChanged = (previousDefinition.emission ?? 0) !== (nextDefinition.emission ?? 0);
    const skyChanged = skyOcclusionClass(previousDefinition) !== skyOcclusionClass(nextDefinition);
    const lightRadius = Math.min(15, Math.max(
      previousDefinition.emission ?? 0,
      nextDefinition.emission ?? 0,
      occlusionChanged || skyChanged ? 8 : 0,
    ));
    return { previous, occlusionChanged, emissionChanged, skyChanged, lightRadius };
  }

  private dirtyNeighbor(chunkX: number, chunkZ: number, dirtyChunks: Set<string>): void {
    const neighbor = this.getChunk(chunkX, chunkZ, false);
    if (!neighbor) return;
    this.markMeshDirty(neighbor);
    dirtyChunks.add(chunkKey(chunkX, chunkZ));
  }

  private noteLightDirtyChunk(chunkX: number, chunkZ: number): void {
    if (!this.trackFluidDirty) return;
    this.fluidLightDirtyKeys.add(chunkKey(chunkX, chunkZ));
  }

  private noteRegionLightDirty(region: LightRegion): void {
    if (!this.trackFluidDirty) return;
    const minChunkX = floorDiv(region.minX, CHUNK_SIZE);
    const maxChunkX = floorDiv(region.maxX, CHUNK_SIZE);
    const minChunkZ = floorDiv(region.minZ, CHUNK_SIZE);
    const maxChunkZ = floorDiv(region.maxZ, CHUNK_SIZE);
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        this.fluidLightDirtyKeys.add(chunkKey(chunkX, chunkZ));
      }
    }
  }

  markMeshDirty(chunk: Chunk): void {
    this.meshDirtyMarks += 1;
    chunk.dirty = true;
    this.pendingMesh.add(chunkKey(chunk.x, chunk.z));
    if (this.trackFluidDirty) this.fluidMeshDirtyKeys.add(chunkKey(chunk.x, chunk.z));
    if (chunk.lightingReady && chunk.readyToMeshAt === 0) chunk.readyToMeshAt = performance.now();
  }

  acknowledgeMeshed(chunk: Chunk): void {
    if (chunk.dirty) return;
    this.pendingMesh.delete(chunkKey(chunk.x, chunk.z));
    chunk.readyToMeshAt = 0;
  }

  queueLight(region: LightRegion, sky: boolean, block: boolean, origin: LightJobOrigin = 'edit'): void {
    this.lightQueueMarks += 1;
    this.noteRegionLightDirty(region);
    if (!this.pendingLight) {
      this.pendingLight = { region: { ...region }, sky, block, origin, skyColumn: 0, blockSeeded: false };
      return;
    }
    const current = this.pendingLight.region;
    const expanded = region.minX < current.minX
      || region.minY < current.minY
      || region.minZ < current.minZ
      || region.maxX > current.maxX
      || region.maxY > current.maxY
      || region.maxZ > current.maxZ;
    const mergedOrigin: LightJobOrigin = this.pendingLight.origin === origin
      ? origin
      : (this.pendingLight.origin === 'edit' || origin === 'edit' ? 'edit' : origin);
    this.pendingLight = {
      sky: this.pendingLight.sky || sky,
      block: this.pendingLight.block || block,
      origin: mergedOrigin,
      skyColumn: expanded ? 0 : (this.pendingLight.skyColumn ?? 0),
      blockSeeded: expanded ? false : this.pendingLight.blockSeeded === true,
      region: {
        minX: Math.min(current.minX, region.minX),
        minY: Math.min(current.minY, region.minY),
        minZ: Math.min(current.minZ, region.minZ),
        maxX: Math.max(current.maxX, region.maxX),
        maxY: Math.max(current.maxY, region.maxY),
        maxZ: Math.max(current.maxZ, region.maxZ),
      },
    };
    if (expanded) resetRegionLightFlood();
  }

  flushLighting(): number {
    const pending = this.pendingLight;
    const emitters = this.pendingEmitters;
    this.pendingLight = undefined;
    this.pendingEmitters = [];
    const start = performance.now();
    if (emitters.length > 0) addBlockLightEmitters(this, emitters);
    this.collectEmitterLightTouches();
    this.commitEmitterLightVersions();
    if (pending) {
      relightRegion(this, pending.region, pending.sky, pending.block);
      this.bumpDirtyInRegion(pending.region);
    }
    return performance.now() - start;
  }

  /**
   * Time-sliced lighting. Never runs a monolithic 30 ms sky job: each call
   * yields at `budgetMs` and resumes cursors on the next frame.
   */
  processLighting(
    budgetMs: number,
    originX: number,
    originZ: number,
    counters?: { attempted: number; completed: number; yielded: number; blocked: number },
  ): number {
    resetLightFrameStats();
    const start = performance.now();
    const deadline = start + Math.max(0.25, budgetMs);
    const originCx = floorDiv(originX, CHUNK_SIZE);
    const originCz = floorDiv(originZ, CHUNK_SIZE);
    const generateRadius = this.generationRadius;
    const unlock = lightingUnlockNeighborKeys(this, originCx, originCz, this.meshRadius, generateRadius);
    const previousOwner = lightingFloodOwner();
    const keepFlood = (key: string): boolean => {
      const chunk = this.chunks.get(key);
      if (!chunk) return false;
      if (chebyshevChunkDistance(chunk.x, chunk.z, originCx, originCz) > generateRadius) return false;
      const critical = criticalUnlitKeys(this, originCx, originCz, this.meshRadius, generateRadius);
      return !shouldPreemptDistantLightingFlood(key, originCx, originCz, unlock, critical.length);
    };
    if (abandonLightingFloodIfOrphaned(keepFlood)) {
      const leftover = this.chunks.get(previousOwner);
      if (leftover) resetIncompleteBlockLighting(leftover);
    }

    const unlit = collectUnlitLightJobs(this, originX, originZ, generateRadius, unlock);
    lightFrameStats.jobsPending = unlit.length + (this.pendingLight ? 1 : 0);
    this.lightOriginCounts = {
      stream: unlit.length,
      fluid: this.pendingLight?.origin === 'fluid' ? 1 : 0,
      edit: this.pendingLight?.origin === 'edit' ? 1 : 0,
      other: this.pendingLight?.origin === 'other' ? 1 : 0,
    };
    const liveOwner = lightingFloodOwner();
    const resumeSharedFlood = liveOwner === LIGHT_FLOOD_REGION || liveOwner === LIGHT_FLOOD_ADD_EMITTER;
    if (!resumeSharedFlood) {
      for (const job of unlit) {
        if (performance.now() >= deadline) break;
        const key = chunkKey(job.chunk.x, job.chunk.z);
        const floodOwner = lightingFloodOwner();
        if (isLightJobBlockedByFlood(floodOwner, key)) {
          if (counters) counters.blocked += 1;
          continue;
        }
        if (counters) counters.attempted += 1;
        const complete = processChunkLighting(this, job.chunk, deadline);
        if (complete) {
          this.applyInitialLightingVersions(job.chunk);
          if (counters) counters.completed += 1;
        } else {
          if (counters) counters.yielded += 1;
          break;
        }
      }
    }

    if (performance.now() < deadline && lightingFloodOwner() === LIGHT_FLOOD_ADD_EMITTER) {
      addBlockLightEmitters(this, this.pendingEmitters, deadline);
      this.pendingEmitters = [];
      this.collectEmitterLightTouches();
      if (lightingFloodOwner() === '') this.commitEmitterLightVersions();
    } else if (performance.now() < deadline && this.pendingLight && (lightingFloodOwner() === '' || lightingFloodOwner() === LIGHT_FLOOD_REGION)) {
      const region = this.pendingLight.region;
      const done = continuePendingLight(this, this.pendingLight, deadline);
      if (done) {
        this.pendingLight = undefined;
        this.bumpDirtyInRegion(region);
      }
    } else if (performance.now() < deadline && this.pendingEmitters.length > 0 && lightingFloodOwner() === '') {
      const emitters = this.pendingEmitters;
      this.pendingEmitters = [];
      addBlockLightEmitters(this, emitters, deadline);
      this.collectEmitterLightTouches();
      if (lightingFloodOwner() === '') this.commitEmitterLightVersions();
    }

    let dirtyLight = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.lightingReady && chunk.lightMeshStale) dirtyLight += 1;
    }
    lightFrameStats.dirtyLightChunks = dirtyLight;
    lightFrameStats.ms = performance.now() - start;
    return lightFrameStats.ms;
  }

  get pendingLightJobs(): number {
    return (this.pendingLight ? 1 : 0) + this.unlitChunkCount;
  }

  /** In-radius dirty/stale keys after `discardObsoletePendingMesh`. Not a historical leak. */
  get pendingMeshJobs(): number {
    return this.pendingMesh.size;
  }

  get unlitChunkCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      if (!chunk.skyReady || !chunk.blockLightReady) count += 1;
    }
    return count;
  }

  /** Invalidates geometry when runtime visual state changes without changing BlockId. */
  markBlockDirty(x: number, z: number): void {
    const chunk = this.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), false);
    if (chunk) this.markMeshDirty(chunk);
  }

  ensureChunks(centerX: number, centerZ: number, radius: number, maxNew = Infinity): Chunk[] {
    const centerChunkX = floorDiv(centerX, CHUNK_SIZE);
    const centerChunkZ = floorDiv(centerZ, CHUNK_SIZE);
    const requested: Array<{ x: number; z: number; distance: number }> = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) requested.push({ x: centerChunkX + dx, z: centerChunkZ + dz, distance: dx * dx + dz * dz });
    }
    requested.sort((a, b) => a.distance - b.distance);
    const created: Chunk[] = [];
    for (const coordinate of requested) {
      const key = chunkKey(coordinate.x, coordinate.z);
      if (this.chunks.has(key)) continue;
      if (created.length >= maxNew) break;
      created.push(this.getChunk(coordinate.x, coordinate.z)!);
    }
    return created;
  }

  pruneChunks(centerX: number, centerZ: number, radius: number): string[] {
    const cx = floorDiv(centerX, CHUNK_SIZE);
    const cz = floorDiv(centerZ, CHUNK_SIZE);
    const removed: string[] = [];
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.x - cx) <= radius + 1 && Math.abs(chunk.z - cz) <= radius + 1) continue;
      this.chunks.delete(key);
      this.pendingMesh.delete(key);
      removed.push(key);
    }
    abandonLightingFloodIfOrphaned((key) => this.chunks.has(key));
    return removed;
  }

  surfaceY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
      const block = this.getBlock(x, y, z);
      if (getBlockDefinition(block).solid && block !== BlockId.OakLeaves) return y;
    }
    return 0;
  }

  biomeAt(x: number, z: number): Biome {
    return this.generator.columnAt(x, z).biome;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }

  isLiquid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).liquid === true;
  }

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    options: { readonly stopOnLiquids?: boolean } = {},
  ): VoxelHit | undefined {
    const dir = direction.clone().normalize();
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x);
    const stepY = Math.sign(dir.y);
    const stepZ = Math.sign(dir.z);
    const deltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x);
    const deltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y);
    const deltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);
    let maxX = dir.x === 0 ? Infinity : ((stepX > 0 ? x + 1 : x) - origin.x) / dir.x;
    let maxY = dir.y === 0 ? Infinity : ((stepY > 0 ? y + 1 : y) - origin.y) / dir.y;
    let maxZ = dir.z === 0 ? Infinity : ((stepZ > 0 ? z + 1 : z) - origin.z) / dir.z;
    let distance = 0;
    while (distance <= maxDistance) {
      const block = this.getBlock(x, y, z);
      const definition = getBlockDefinition(block);
      if (block !== BlockId.Air && (!definition.liquid || options.stopOnLiquids)) {
        const hit = this.hitSelectionBoxes(origin, dir, x, y, z, block, maxDistance, definition.liquid === true);
        if (hit) return hit;
      }
      if (maxX < maxY && maxX < maxZ) {
        x += stepX;
        distance = maxX;
        maxX += deltaX;
      } else if (maxY < maxZ) {
        y += stepY;
        distance = maxY;
        maxY += deltaY;
      } else {
        z += stepZ;
        distance = maxZ;
        maxZ += deltaZ;
      }
    }
    return undefined;
  }

  private hitSelectionBoxes(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    x: number,
    y: number,
    z: number,
    block: BlockId,
    maxDistance: number,
    liquid = false,
  ): VoxelHit | undefined {
    let best: ReturnType<typeof rayAabbDistance>;
    const boxes = liquid
      ? [{ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 }]
      : blockSelectionBoxes(this, x, y, z);
    for (const box of boxes) {
      const hit = rayAabbDistance(origin, dir, box);
      if (!hit || hit.distance < 0 || hit.distance > maxDistance) continue;
      if (!best || hit.distance < best.distance) best = hit;
    }
    if (!best) return undefined;
    return {
      x, y, z, block,
      normal: new THREE.Vector3(best.nx, best.ny, best.nz),
      distance: best.distance,
      point: origin.clone().addScaledVector(dir, best.distance),
    };
  }

  tick(): void {
    this.tickNumber += 1;
    this.timeOfDay = (this.timeOfDay + 1) % 24_000;
    this.processScheduledTicks();
    processFluidQueue(this);
    this.processSupportIntegrity();
    this.tickFurnaces();
  }

  beginFluidTick(): void {
    this.trackFluidDirty = true;
    this.fluidNoops = 0;
    this.fluidDedupe = 0;
    this.fluidMeshDirtyKeys.clear();
    this.fluidLightDirtyKeys.clear();
  }

  endFluidTick(updates: number, writes: number): void {
    this.trackFluidDirty = false;
    this.fluidUpdates = updates;
    this.fluidWrites = writes;
    this.fluidMeshDirtyChunks = this.fluidMeshDirtyKeys.size;
    this.fluidLightDirtyChunks = this.fluidLightDirtyKeys.size;
  }

  noteFluidNoop(): void {
    this.fluidNoops += 1;
  }

  isFluidDistant(x: number, z: number): boolean {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const fluidRadius = Math.min(this.meshRadius, 2);
    return chebyshevChunkDistance(cx, cz, this.viewChunkX, this.viewChunkZ) > fluidRadius;
  }

  /** New work always observes the receiving material's rate, including legacy delay=1 callers. */
  scheduleFluid(x: number, y: number, z: number, delay = 0): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const block = this.getBlock(x, y, z, false);
    if (!isFluidBlock(block)) return;
    this.enqueueFluid(x, y, z, block, this.tickNumber + Math.max(fluidTickDelay(block), delay));
  }

  private cancelFluidTick(x: number, y: number, z: number): void {
    const key = blockKey(x, y, z);
    const entry = this.fluidKeys.get(key);
    if (!entry) return;
    this.fluidKeys.delete(key);
    this.fluidScheduled = this.fluidScheduled.filter((scheduled) => scheduled !== entry);
  }

  /** Promoting existing flow to a placed source starts a new causal lifetime. */
  restartFluidSchedule(x: number, y: number, z: number): void {
    this.cancelFluidTick(x, y, z);
    this.scheduleFluidAround(x, y, z);
  }

  private enqueueFluid(x: number, y: number, z: number, block: BlockId, due: number): void {
    const key = blockKey(x, y, z);
    const existing = this.fluidKeys.get(key);
    if (existing) {
      this.fluidDedupe += 1;
      if (existing.due > due) existing.due = due;
      return;
    }
    if (this.fluidScheduled.length >= FLUID_QUEUE_CAP) return;
    const entry = { x, y, z, block, due };
    this.fluidKeys.set(key, entry);
    this.fluidScheduled.push(entry);
    this.fluidQueuePeak = Math.max(this.fluidQueuePeak, this.fluidScheduled.length);
  }

  scheduleFluidAround(x: number, y: number, z: number, delay = 0): void {
    this.scheduleFluid(x, y, z, delay);
    this.scheduleFluid(x + 1, y, z, delay);
    this.scheduleFluid(x - 1, y, z, delay);
    this.scheduleFluid(x, y + 1, z, delay);
    this.scheduleFluid(x, y - 1, z, delay);
    this.scheduleFluid(x, y, z + 1, delay);
    this.scheduleFluid(x, y, z - 1, delay);
  }

  /** Consume only a still-live due ticket; mutations may invalidate an extracted job. */
  consumeDueFluid(entry: ScheduledFluidTick): boolean {
    const key = blockKey(entry.x, entry.y, entry.z);
    if (entry.due > this.tickNumber || this.fluidKeys.get(key) !== entry) return false;
    this.fluidKeys.delete(key);
    return this.getBlock(entry.x, entry.y, entry.z, false) === entry.block;
  }

  /** Budget retry only: this ticket has already waited its material delay. */
  retryDueFluid(entry: ScheduledFluidTick): void {
    if (!this.consumeDueFluid(entry)) return;
    this.enqueueFluid(entry.x, entry.y, entry.z, entry.block, this.tickNumber + 1);
  }

  takeDueFluids(max: number): ScheduledFluidTick[] {
    const due: ScheduledFluidTick[] = [];
    const kept: ScheduledFluidTick[] = [];
    let paused = 0;
    let oldest = 0;
    for (const scheduled of this.fluidScheduled) {
      if (scheduled.due > this.tickNumber) {
        kept.push(scheduled);
        continue;
      }
      oldest = Math.max(oldest, this.tickNumber - scheduled.due);
      if (this.isFluidDistant(scheduled.x, scheduled.z)) {
        kept.push(scheduled);
        paused += 1;
        continue;
      }
      if (due.length >= max) {
        kept.push(scheduled);
        continue;
      }
      due.push(scheduled);
    }
    this.fluidScheduled = kept;
    this.fluidPausedDistant = paused;
    this.fluidOldestDueTicks = oldest;
    return due;
  }

  fluidHudStats(): FluidHudStats {
    return {
      q: this.fluidScheduled.length,
      active: this.fluidKeys.size,
      updates: this.fluidUpdates,
      writes: this.fluidWrites,
      noop: this.fluidNoops,
      dedupe: this.fluidDedupe,
      meshDirtyChunks: this.fluidMeshDirtyChunks,
      lightDirtyChunks: this.fluidLightDirtyChunks,
      pausedDistant: this.fluidPausedDistant,
      oldest: this.fluidOldestDueTicks,
    };
  }

  get fluidQueueSize(): number {
    return this.fluidScheduled.length;
  }

  getChest(x: number, y: number, z: number): ChestState {
    const key = blockKey(x, y, z);
    let chest = this.chests.get(key);
    if (!chest) {
      chest = { slots: Array.from({ length: 27 }, () => null) };
      this.chests.set(key, chest);
    }
    return chest;
  }

  getFurnace(x: number, y: number, z: number): FurnaceState {
    const key = blockKey(x, y, z);
    let furnace = this.furnaces.get(key);
    if (!furnace) {
      furnace = { slots: [null, null, null], burnTime: 0, burnTotal: 0, cookTime: 0 };
      this.furnaces.set(key, furnace);
    }
    return furnace;
  }

  isFurnaceBurning(x: number, y: number, z: number): boolean {
    if (this.getBlock(x, y, z, false) !== BlockId.Furnace) return false;
    return (this.furnaces.get(blockKey(x, y, z))?.burnTime ?? 0) > 0;
  }

  /** Emission including lit-furnace torch strength. Does not allocate furnace state. */
  blockEmissionAt(x: number, y: number, z: number): number {
    const block = this.getBlock(x, y, z, false);
    if (block === BlockId.Furnace && this.isFurnaceBurning(x, y, z)) return torchBlockEmission();
    return getBlockDefinition(block).emission ?? 0;
  }

  serializeModifications(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [key, values] of this.modifications) {
      result[key] = Object.fromEntries([...values].map(([index, block]) => [String(index), block]));
    }
    return result;
  }

  serializeBlockStates(): Record<string, BlockRenderState> {
    return Object.fromEntries(this.blockStates);
  }

  private schedule(x: number, y: number, z: number, delay: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const key = blockKey(x, y, z);
    if (this.scheduledKeys.has(key) || this.scheduled.length >= 4096) return;
    this.scheduledKeys.add(key);
    this.scheduled.push({ x, y, z, due: this.tickNumber + delay });
  }

  private processScheduledTicks(): void {
    let processed = 0;
    for (let index = 0; index < this.scheduled.length && processed < 64;) {
      const scheduled = this.scheduled[index]!;
      if (scheduled.due > this.tickNumber) {
        index += 1;
        continue;
      }
      this.scheduled.splice(index, 1);
      this.scheduledKeys.delete(blockKey(scheduled.x, scheduled.y, scheduled.z));
      processed += 1;
      const block = this.getBlock(scheduled.x, scheduled.y, scheduled.z);
      const definition = getBlockDefinition(block);
      if (definition.gravity && scheduled.y > 0) {
        const below = this.getBlock(scheduled.x, scheduled.y - 1, scheduled.z);
        const belowDefinition = getBlockDefinition(below);
        if (below === BlockId.Air || belowDefinition.liquid || belowDefinition.replaceable) {
          this.pendingFalls.push({
            x: scheduled.x, y: scheduled.y, z: scheduled.z, block,
          });
          this.setBlock(scheduled.x, scheduled.y, scheduled.z, BlockId.Air);
        }
      }
      if (block === BlockId.Fire) {
        this.tickFire(scheduled.x, scheduled.y, scheduled.z);
      }
    }
  }

  private tickFire(x: number, y: number, z: number): void {
    if (this.getBlock(x, y, z, false) !== BlockId.Fire) return;
    const below = this.getBlock(x, y - 1, z, false);
    const support = getBlockDefinition(below);
    if (below === BlockId.Air || support.liquid || support.replaceable) {
      this.setBlock(x, y, z, BlockId.Air);
      return;
    }
    if ((this.tickNumber + x * 13 + z * 7) % 40 === 0) {
      this.setBlock(x, y, z, BlockId.Air);
      return;
    }
    this.schedule(x, y, z, 20);
  }

  private tickFurnaces(): void {
    for (const [key, furnace] of this.furnaces) {
      const wasBurning = furnace.burnTime > 0;
      const input = furnace.slots[0];
      const recipe = input ? findSmeltingRecipe(input.itemId) : undefined;
      const outputId = recipe?.output.item;
      const outputCount = recipe?.output.count ?? 1;
      if (furnace.burnTime <= 0 && recipe) {
        const fuel = furnace.slots[1];
        const fuelTicks = fuel ? getFuelBurnTicks(fuel.itemId) : 0;
        if (fuel && fuelTicks > 0) {
          furnace.burnTime = fuelTicks;
          furnace.burnTotal = fuelTicks;
          furnace.slots[1] = fuel.count <= 1 ? null : { ...fuel, count: fuel.count - 1 };
        }
      }
      if (furnace.burnTime > 0) furnace.burnTime -= 1;
      const output = furnace.slots[2];
      const maxOutput = outputId ? getItemDefinition(outputId).maxStack : 0;
      const canOutput = outputId !== undefined
        && (!output || (output.itemId === outputId && output.count + outputCount <= maxOutput));
      if (furnace.burnTime > 0 && canOutput) {
        furnace.cookTime += 1;
        if (recipe && furnace.cookTime >= recipe.cookingTimeTicks && input && outputId) {
          furnace.slots[0] = input.count <= 1 ? null : { ...input, count: input.count - 1 };
          furnace.slots[2] = output
            ? { ...output, count: output.count + outputCount }
            : { itemId: outputId, count: outputCount };
          furnace.cookTime = 0;
        }
      } else furnace.cookTime = 0;
      const isBurning = furnace.burnTime > 0;
      if (wasBurning === isBurning) continue;
      const { x, y, z } = parseBlockKey(key);
      if (this.getBlock(x, y, z, false) === BlockId.Furnace) this.syncFurnaceEmission(x, y, z);
    }
  }

  private syncFurnaceEmission(x: number, y: number, z: number): void {
    const radius = Math.max(1, torchBlockEmission());
    const minChunkX = floorDiv(x - radius, CHUNK_SIZE);
    const maxChunkX = floorDiv(x + radius, CHUNK_SIZE);
    const minChunkZ = floorDiv(z - radius, CHUNK_SIZE);
    const maxChunkZ = floorDiv(z + radius, CHUNK_SIZE);
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        this.markBlockDirty(chunkX * CHUNK_SIZE, chunkZ * CHUNK_SIZE);
      }
    }
    relightAround(this, x, y, z, radius, false);
    consumeLightTouched();
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        const chunk = this.chunks.get(chunkKey(chunkX, chunkZ));
        if (chunk?.lightingReady) chunk.bumpLightVersion();
      }
    }
  }
}
