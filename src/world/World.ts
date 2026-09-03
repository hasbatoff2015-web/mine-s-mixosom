import { Vec3, type Vec3Like } from '../math/vec3';
import { migrateLegacyStack } from '../inventory/legacyItems';
import { BlockId, getBlockDefinition, torchBlockEmission, type BlockRenderState } from '../blocks';
import { rayAabbDistance, blockCollisionBoxes } from './collision';
import { blockSelectionBoxes } from './selection';
import { needsBlockSupport, supportCellForBlock, isBlockStillSupported } from './placement';
import { CHUNK_SIZE, LATERAL_SKY_RADIUS, LIGHTING_HALO_CHUNKS, MAX_GENERATED_SURFACE, WORLD_HEIGHT, blockKey, chunkKey, floorDiv, parseBlockKey, positiveMod } from '../core/constants';
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
  restartLightingAfterImport,
  skyOcclusionClass,
  lightingInvalidation,
  LIGHT_FLOOD_ADD_EMITTER,
  LIGHT_FLOOD_REGION,
  MAX_LIGHT_COLUMNS_PER_SLICE,
  MAX_LIGHT_NODES_PER_SLICE,
  type LightJobOrigin,
  type LightRegion,
  type PendingLightJob,
} from './LightEngine';
import { chebyshevChunkDistance, MESH_LIGHT_NEIGHBORS, neighborFluidMeshOffsets } from './worldJobs';
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

export interface VoxelRaycastOptions {
  readonly stopOnLiquids?: boolean;
  /** Selection is player targeting; collision is projectile/physics blocking. */
  readonly geometry?: 'selection' | 'collision';
}

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  block: BlockId;
  normal: Vec3;
  distance: number;
  point: Vec3;
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
  /** Import/structure writes: do not enqueue support checks for each cell. */
  readonly skipSupport?: boolean;
  /**
   * After a large import, leave chunks unlit so the ordinary scheduler lights
   * them. Skips per-edit sky/region floods.
   */
  readonly deferChunkLighting?: boolean;
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
  /**
   * Host lighting mode (see `LightingAdapter`).
   * Client `Game` sets true (budgeted `processDeferredLighting`).
   * Server/tests leave false so `setBlock` relights before returning.
   */
  deferredLighting = false;
  /**
   * Authoritative servers subscribe here to batch/dedupe resulting voxel writes
   * (fluids, TNT, support, furnaces) without a second world representation.
   */
  onCommittedBlocks?: (changes: readonly {
    x: number;
    y: number;
    z: number;
    previous: BlockId;
    block: BlockId;
  }[]) => void;
  /**
   * State-only writes (fluid level, door open, button powered) never go through
   * `applyBlockBatch`. Servers subscribe here so live packets include full state.
   */
  onCommittedBlockState?: (change: {
    x: number;
    y: number;
    z: number;
    block: BlockId;
  }) => void;
  private pendingEmitters: Array<readonly [number, number, number]> = [];
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
      if (delta) for (const [index, block] of delta) chunk.writeIndex(index, block);
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

  /** Commit actual light differences once, including boundary vertices read by neighbors. */
  applyInitialLightingVersions(chunk: Chunk): void {
    this.commitLightChanges(chunk);
    if (chunk.readyToMeshAt === 0) chunk.readyToMeshAt = performance.now();
  }

  private commitLightChanges(initial?: Chunk): void {
    const dirty = new Set<Chunk>();
    if (initial) dirty.add(initial);
    for (const chunk of consumeLightTouched(this)) {
      if (chunk.lightingReady) dirty.add(chunk);
      MESH_LIGHT_NEIGHBORS.forEach(({ dx, dz }, bit) => {
        if (!(chunk.changedLightBorders & (1 << bit))) return;
        const neighbor = this.chunks.get(chunkKey(chunk.x + dx, chunk.z + dz));
        if (neighbor?.lightingReady) dirty.add(neighbor);
      });
    }
    for (const chunk of dirty) this.noteLightDataChanged(chunk);
  }

  hasPendingLighting(chunk: Chunk): boolean {
    if (chunk.lightPending) return true;
    const r = this.pendingLight?.region;
    if (r && chunk.x * CHUNK_SIZE <= r.maxX && (chunk.x + 1) * CHUNK_SIZE > r.minX
      && chunk.z * CHUNK_SIZE <= r.maxZ && (chunk.z + 1) * CHUNK_SIZE > r.minZ) return true;
    return this.pendingEmitters.some(([x, , z]) =>
      chunk.x * CHUNK_SIZE <= x + 15 && (chunk.x + 1) * CHUNK_SIZE > x - 15
      && chunk.z * CHUNK_SIZE <= z + 15 && (chunk.z + 1) * CHUNK_SIZE > z - 15);
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
    this.onCommittedBlockState?.({
      x, y, z,
      block: this.getBlock(x, y, z, false),
    });
    return true;
  }

  /**
   * Import-only: store authored state without support/fluid side effects.
   * Mesh dirty is still required so stairs/doors/rails appear correctly.
   */
  replaceBlockState(x: number, y: number, z: number, state: BlockRenderState): void {
    this.blockStates.set(blockKey(x, y, z), state);
    this.markBlockDirty(x, z);
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
   * one coalesced sky/block job for the bounded union region.
   */
  applyBlockBatch(mutations: readonly BlockMutation[], options: BlockBatchOptions = {}): BlockBatchStats {
    const record = options.record !== false;
    const updateLighting = options.updateLighting !== false && !options.deferChunkLighting;
    const deferLighting = options.deferLighting ?? this.deferredLighting;
    const scheduleNeighbors = options.scheduleNeighbors !== false;
    const mutationStart = performance.now();
    const dirtyChunks = new Set<string>();
    let applied = 0;

    const unique = new Map<string, BlockMutation>();
    for (const mutation of mutations) {
      unique.set(blockKey(mutation.x, mutation.y, mutation.z), mutation);
    }
    this.mutationMarks += unique.size;
    const committed: Array<{ x: number; y: number; z: number; previous: BlockId; block: BlockId }> = [];

    const addedEmitters: Array<readonly [number, number, number]> = [];
    let regionSky = false;
    let regionBlock = false;
    let rMinX = Infinity;
    let rMinY = Infinity;
    let rMinZ = Infinity;
    let rMaxX = -Infinity;
    let rMaxY = -Infinity;
    let rMaxZ = -Infinity;
    let regionRadius = 0;

    for (const mutation of unique.values()) {
      const wrote = this.writeBlockRaw(
        mutation.x,
        mutation.y,
        mutation.z,
        mutation.block,
        record,
        dirtyChunks,
        options.skipSupport === true,
      );
      if (!wrote) continue;
      applied += 1;
      committed.push({
        x: mutation.x,
        y: mutation.y,
        z: mutation.z,
        previous: wrote.previous,
        block: mutation.block,
      });
      const signatureAction = lightingInvalidation(wrote.previous, mutation.block);
      const action = signatureAction === 'none' && wrote.emissionChanged ? 'region' : signatureAction;
      if (action === 'addEmitter' && (getBlockDefinition(mutation.block).emission ?? 0) > 0) {
        addedEmitters.push([mutation.x, mutation.y, mutation.z]);
      }
      if (action === 'region' || action === 'addEmitter') {
        regionSky = regionSky || wrote.skyChanged;
        regionBlock = regionBlock || (action === 'region' && (wrote.emissionChanged || wrote.occlusionChanged));
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
      if (addedEmitters.length > 0 && !hasRegion) {
        if (deferLighting) this.pendingEmitters.push(...addedEmitters);
        else addBlockLightEmitters(this, addedEmitters);
      }
      if (hasRegion) {
        const radius = Math.max(regionSky ? LATERAL_SKY_RADIUS : 0, regionBlock ? regionRadius : 0);
        const region: LightRegion = {
          minX: rMinX - radius, minY: rMinY - regionRadius, minZ: rMinZ - radius,
          maxX: rMaxX + radius, maxY: rMaxY + regionRadius, maxZ: rMaxZ + radius,
        };
        // Mixed batches must also include add-only emitters in the regional reset.
        const block = regionBlock || addedEmitters.length > 0;
        if (deferLighting) this.queueLight(region, regionSky, block, options.lightOrigin ?? 'edit');
        else relightRegion(this, region, regionSky, block);
      }
      if (!deferLighting) this.commitLightChanges();
      relightMs = performance.now() - relightStart;
    }

    if (applied > 0 && options.deferChunkLighting) {
      this.invalidateImportedChunkLighting(dirtyChunks);
    }

    if (committed.length > 0) this.onCommittedBlocks?.(committed);

    return {
      applied,
      chunksDirtied: dirtyChunks.size,
      skyRecomputes: lightEngineStats.skyRecomputes - skyBefore,
      mutationMs,
      relightMs,
    };
  }

  private invalidateImportedChunkLighting(dirtyChunks: Set<string>): void {
    for (const emitter of restartLightingAfterImport(this)) this.pendingEmitters.push(emitter);
    const keys = new Set(dirtyChunks);
    for (const key of dirtyChunks) {
      const [chunkX, chunkZ] = key.split(',').map(Number);
      for (const { dx, dz } of MESH_LIGHT_NEIGHBORS) {
        keys.add(chunkKey((chunkX ?? 0) + dx, (chunkZ ?? 0) + dz));
      }
    }
    for (const key of keys) {
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      chunk.skyReady = false;
      chunk.skyLateralReady = false;
      chunk.blockLightReady = false;
      chunk.skyFillCursor = 0;
      chunk.blockScanCursor = 0;
      chunk.meshedLightVersion = -1;
      this.markMeshDirty(chunk);
    }
    this.commitLightChanges();
  }

  private skyRecomputeSnapshot(): number {
    return lightEngineStats.skyRecomputes;
  }

  private writeBlockRaw(
    x: number,
    y: number,
    z: number,
    block: BlockId,
    record: boolean,
    dirtyChunks: Set<string>,
    skipSupport = false,
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
    const previousEmission = previous === BlockId.Furnace ? this.blockEmissionAt(x, y, z) : previousDefinition.emission ?? 0;
    chunk.set(localX, y, localZ, block);
    this.blockStates.delete(blockKey(x, y, z));
    if (!skipSupport) this.queueSupportAround(x, y, z);
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
    const offsets = neighborFluidMeshOffsets(localX, localZ);
    for (const [dx, dz] of offsets) {
      this.dirtyNeighbor(chunkX + dx, chunkZ + dz, dirtyChunks);
    }
    const occlusionChanged = previousDefinition.occludesFaces !== nextDefinition.occludesFaces;
    const emissionChanged = previousEmission !== (nextDefinition.emission ?? 0);
    const skyChanged = skyOcclusionClass(previousDefinition) !== skyOcclusionClass(nextDefinition);
    const lightRadius = Math.min(15, Math.max(
      previousEmission,
      nextDefinition.emission ?? 0,
      occlusionChanged ? 14 : skyChanged ? LATERAL_SKY_RADIUS : 0,
    ));
    return { previous, occlusionChanged, emissionChanged, skyChanged, lightRadius };
  }

  private dirtyNeighbor(chunkX: number, chunkZ: number, dirtyChunks: Set<string>): void {
    const neighbor = this.getChunk(chunkX, chunkZ, false);
    if (!neighbor) return;
    this.markMeshDirty(neighbor);
    dirtyChunks.add(chunkKey(chunkX, chunkZ));
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
      this.pendingLight = { region: { ...region }, sky, block, origin };
      return;
    }
    const current = this.pendingLight.region;
    const mergedOrigin: LightJobOrigin = this.pendingLight.origin === origin
      ? origin
      : (this.pendingLight.origin === 'edit' || origin === 'edit' ? 'edit' : origin);
    this.pendingLight = {
      sky: this.pendingLight.sky || sky,
      block: this.pendingLight.block || block,
      origin: mergedOrigin,
      region: {
        minX: Math.min(current.minX, region.minX),
        minY: Math.min(current.minY, region.minY),
        minZ: Math.min(current.minZ, region.minZ),
        maxX: Math.max(current.maxX, region.maxX),
        maxY: Math.max(current.maxY, region.maxY),
        maxZ: Math.max(current.maxZ, region.maxZ),
      },
    };
    // An edit inside unchanged bounds can invalidate already-scanned columns too.
    resetRegionLightFlood(this);
  }

  flushLighting(): number {
    const pending = this.pendingLight;
    const emitters = this.pendingEmitters;
    this.pendingLight = undefined;
    this.pendingEmitters = [];
    const start = performance.now();
    if (emitters.length > 0) addBlockLightEmitters(this, emitters);

    if (pending) {
      relightRegion(this, pending.region, pending.sky, pending.block);
    }
    this.commitLightChanges();
    return performance.now() - start;
  }

  /**
   * Time-sliced lighting with deadline checks and hard work caps. Cursors
   * resume on the next frame; small check intervals may overshoot the deadline.
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
    const previousOwner = lightingFloodOwner(this);
    const keepFlood = (key: string): boolean => {
      const chunk = this.chunks.get(key);
      if (!chunk) return false;
      if (chebyshevChunkDistance(chunk.x, chunk.z, originCx, originCz) > generateRadius) return false;
      const critical = criticalUnlitKeys(this, originCx, originCz, this.meshRadius, generateRadius);
      return !shouldPreemptDistantLightingFlood(key, originCx, originCz, unlock, critical.length);
    };
    if (abandonLightingFloodIfOrphaned(keepFlood, this)) {
      const leftover = this.chunks.get(previousOwner);
      if (leftover) resetIncompleteBlockLighting(leftover);
      this.commitLightChanges();
    }

    const unlit = collectUnlitLightJobs(this, originX, originZ, generateRadius, unlock);
    const emitterWork = this.pendingEmitters.length > 0 || lightingFloodOwner(this) === LIGHT_FLOOD_ADD_EMITTER;
    lightFrameStats.jobsPending = unlit.length + (this.pendingLight ? 1 : 0) + Number(emitterWork);
    this.lightOriginCounts = {
      stream: unlit.length,
      fluid: this.pendingLight?.origin === 'fluid' ? 1 : 0,
      edit: this.pendingLight?.origin === 'edit' ? 1 : 0,
      other: this.pendingLight?.origin === 'other' ? 1 : 0,
    };
    const liveOwner = lightingFloodOwner(this);
    const resumeSharedFlood = liveOwner === LIGHT_FLOOD_REGION || liveOwner === LIGHT_FLOOD_ADD_EMITTER
      || (liveOwner === '' && (this.pendingLight !== undefined || this.pendingEmitters.length > 0));
    if (!resumeSharedFlood) {
      for (const job of unlit) {
        if (performance.now() >= deadline || lightFrameStats.columns >= MAX_LIGHT_COLUMNS_PER_SLICE
          || lightFrameStats.nodes >= MAX_LIGHT_NODES_PER_SLICE) break;
        const key = chunkKey(job.chunk.x, job.chunk.z);
        const floodOwner = lightingFloodOwner(this);
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

    if (performance.now() < deadline && lightingFloodOwner(this) === LIGHT_FLOOD_ADD_EMITTER) {
      addBlockLightEmitters(this, this.pendingEmitters, deadline);
      this.pendingEmitters = [];
      if (lightingFloodOwner(this) === '') this.commitLightChanges();
    } else if (performance.now() < deadline && this.pendingLight && (lightingFloodOwner(this) === '' || lightingFloodOwner(this) === LIGHT_FLOOD_REGION)) {
      const done = continuePendingLight(this, this.pendingLight, deadline);
      if (done) {
        this.pendingLight = undefined;
        this.commitLightChanges();
      }
    } else if (performance.now() < deadline && this.pendingEmitters.length > 0 && lightingFloodOwner(this) === '') {
      const emitters = this.pendingEmitters;
      this.pendingEmitters = [];
      addBlockLightEmitters(this, emitters, deadline);
      if (lightingFloodOwner(this) === '') this.commitLightChanges();
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
    return (this.pendingLight ? 1 : 0) + this.unlitChunkCount
      + (this.pendingEmitters.length > 0 || lightingFloodOwner(this) === LIGHT_FLOOD_ADD_EMITTER ? 1 : 0);
  }

  /** In-radius dirty/stale keys after `discardObsoletePendingMesh`. Not a historical leak. */
  get pendingMeshJobs(): number {
    return this.pendingMesh.size;
  }

  get unlitChunkCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      if (!chunk.lightingReady) count += 1;
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
    abandonLightingFloodIfOrphaned((key) => this.chunks.has(key), this);
    return removed;
  }

  surfaceY(x: number, z: number): number {
    const chunk = this.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    const localX = positiveMod(x, CHUNK_SIZE);
    const localZ = positiveMod(z, CHUNK_SIZE);
    const start = chunk
      ? Math.max(chunk.scanMaxY(), chunk.surfaceHeights[localZ * CHUNK_SIZE + localX] ?? 0)
      : MAX_GENERATED_SURFACE;
    for (let y = start; y >= 0; y -= 1) {
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
    origin: Vec3Like,
    direction: Vec3Like,
    maxDistance: number,
    options: VoxelRaycastOptions = {},
  ): VoxelHit | undefined {
    const dir = new Vec3(direction.x, direction.y, direction.z).normalize();
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
    const geometry = options.geometry ?? 'selection';
    while (distance <= maxDistance) {
      const block = this.getBlock(x, y, z);
      const definition = getBlockDefinition(block);
      if (block !== BlockId.Air && (!definition.liquid || options.stopOnLiquids)) {
        const hit = this.hitVoxelBoxes(origin, dir, x, y, z, block, maxDistance, definition.liquid === true, geometry);
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

  private hitVoxelBoxes(
    origin: Vec3Like,
    dir: Vec3Like,
    x: number,
    y: number,
    z: number,
    block: BlockId,
    maxDistance: number,
    liquid = false,
    geometry: 'selection' | 'collision' = 'selection',
  ): VoxelHit | undefined {
    let best: ReturnType<typeof rayAabbDistance>;
    const boxes = liquid
      ? [{ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 }]
      : geometry === 'collision'
        ? blockCollisionBoxes(this, x, y, z)
        : blockSelectionBoxes(this, x, y, z);
    for (const box of boxes) {
      const hit = rayAabbDistance(origin, dir, box);
      if (!hit || hit.distance < 0 || hit.distance > maxDistance) continue;
      if (!best || hit.distance < best.distance) best = hit;
    }
    if (!best) return undefined;
    return {
      x, y, z, block,
      normal: new Vec3(best.nx, best.ny, best.nz),
      distance: best.distance,
      point: new Vec3(origin.x, origin.y, origin.z).addScaledVector(dir, best.distance),
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

  /** One chunk's modification delta. Do not call `serializeModifications()` per streamed chunk. */
  serializeChunkModifications(cx: number, cz: number): Record<string, number> {
    const delta = this.modifications.get(chunkKey(cx, cz));
    if (!delta || delta.size === 0) return {};
    const result: Record<string, number> = {};
    for (const [index, block] of delta) result[String(index)] = block;
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
    const radius = torchBlockEmission();
    this.markBlockDirty(x, z);
    if (this.deferredLighting) {
      this.queueLight({ minX: x - radius, minY: y - radius, minZ: z - radius,
        maxX: x + radius, maxY: y + radius, maxZ: z + radius }, false, true);
    } else {
      relightAround(this, x, y, z, radius, false);
      this.commitLightChanges();
    }
  }
}
