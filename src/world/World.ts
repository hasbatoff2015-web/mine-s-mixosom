import * as THREE from 'three';
import { BlockId, getBlockDefinition, torchBlockEmission, type BlockRenderState } from '../blocks';
import { blockCollisionBoxes, rayAabbDistance } from './collision';
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
  lightEngineStats,
  lightFrameStats,
  processChunkLighting,
  relightAround,
  relightRegion,
  addBlockLightEmitters,
  resetLightFrameStats,
  skyOcclusionClass,
  type LightRegion,
  type PendingLightJob,
} from './LightEngine';
import { neighborMeshOffsets, sortedLoadedChunksByDistance } from './worldJobs';

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  block: BlockId;
  normal: THREE.Vector3;
  distance: number;
  point: THREE.Vector3;
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
  readonly pendingMesh = new Set<string>();
  private pendingLight?: PendingLightJob;
  meshRadius = 32;
  generationRadius = 32 + LIGHTING_HALO_CHUNKS;
  viewChunkX = 0;
  viewChunkZ = 0;
  private readonly scheduled: ScheduledBlockTick[] = [];
  private readonly scheduledKeys = new Set<string>();
  private readonly pendingFalls: FallingBlockSpawn[] = [];

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
    for (const [key, value] of Object.entries(state.chests)) this.chests.set(key, value as ChestState);
    for (const [key, value] of Object.entries(state.furnaces)) this.furnaces.set(key, value as FurnaceState);
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

  getBlockState(x: number, y: number, z: number): BlockRenderState | undefined {
    return this.blockStates.get(blockKey(x, y, z));
  }

  setBlockState(x: number, y: number, z: number, state: BlockRenderState): void {
    this.blockStates.set(blockKey(x, y, z), state);
    this.markBlockDirty(x, z);
    this.markBlockDirty(x + 1, z);
    this.markBlockDirty(x - 1, z);
    this.markBlockDirty(x, z + 1);
    this.markBlockDirty(x, z - 1);
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
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let emissionChanged = false;
    let skyChanged = false;
    let lightRadius = 0;
    const addedEmitters: Array<readonly [number, number, number]> = [];

    const unique = new Map<string, BlockMutation>();
    for (const mutation of mutations) {
      unique.set(blockKey(mutation.x, mutation.y, mutation.z), mutation);
    }
    this.mutationMarks += unique.size;

    let hadBlockLight = false;
    for (const mutation of unique.values()) {
      if (this.cellTransmitsBlockLight(mutation.x, mutation.y, mutation.z)) hadBlockLight = true;
      const wrote = this.writeBlockRaw(mutation.x, mutation.y, mutation.z, mutation.block, record, dirtyChunks);
      if (!wrote) continue;
      applied += 1;
      minX = Math.min(minX, mutation.x);
      minY = Math.min(minY, mutation.y);
      minZ = Math.min(minZ, mutation.z);
      maxX = Math.max(maxX, mutation.x);
      maxY = Math.max(maxY, mutation.y);
      maxZ = Math.max(maxZ, mutation.z);
      if (wrote.emissionChanged) emissionChanged = true;
      if (wrote.skyChanged) skyChanged = true;
      lightRadius = Math.max(lightRadius, wrote.lightRadius);
      if (wrote.emissionChanged && (getBlockDefinition(mutation.block).emission ?? 0) > 0) {
        addedEmitters.push([mutation.x, mutation.y, mutation.z]);
      }
      if (scheduleNeighbors) {
        this.schedule(mutation.x, mutation.y, mutation.z, 1);
        this.schedule(mutation.x, mutation.y + 1, mutation.z, 1);
      }
    }

    const mutationMs = performance.now() - mutationStart;
    let relightMs = 0;
    const skyBefore = this.skyRecomputeSnapshot();
    const needsSky = skyChanged;
    const needsBlock = emissionChanged || hadBlockLight;
    if (applied > 0 && updateLighting && (needsSky || needsBlock)) {
      const skyRadius = needsSky ? 4 : 0;
      const blockRadius = needsBlock ? lightRadius : 0;
      const radius = Math.max(skyRadius, blockRadius);
      const region: LightRegion = {
        minX: minX - radius,
        minY: minY - (needsBlock ? blockRadius : 0),
        minZ: minZ - radius,
        maxX: maxX + radius,
        maxY: maxY + (needsBlock ? blockRadius : 0),
        maxZ: maxZ + radius,
      };
      if (options.deferLighting) {
        this.queueLight(region, needsSky, needsBlock);
      } else {
        const relightStart = performance.now();
        if (needsSky) {
          relightRegion(this, {
            minX: minX - skyRadius,
            minY: 0,
            minZ: minZ - skyRadius,
            maxX: maxX + skyRadius,
            maxY: WORLD_HEIGHT - 1,
            maxZ: maxZ + skyRadius,
          }, true, false);
        }
        if (needsBlock) {
          const addedOnly = !needsSky && !hadBlockLight && addedEmitters.length > 0;
          if (addedOnly) addBlockLightEmitters(this, addedEmitters);
          else {
            relightRegion(this, {
              minX: minX - blockRadius,
              minY: minY - blockRadius,
              minZ: minZ - blockRadius,
              maxX: maxX + blockRadius,
              maxY: maxY + blockRadius,
              maxZ: maxZ + blockRadius,
            }, false, true);
          }
        }
        relightMs = performance.now() - relightStart;
      }
      if (emissionChanged) {
        this.markLightRegionDirty(
          minX - lightRadius,
          minZ - lightRadius,
          maxX + lightRadius,
          maxZ + lightRadius,
        );
      }
      if (!options.deferLighting) this.bumpDirtyLightVersions(this.pendingMesh);
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

  /** Stored block light only — does not seed unlit chunks. */
  peekBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const chunk = this.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), false);
    if (!chunk?.blockLightReady) return 0;
    return chunk.blockLight[Chunk.index(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))] ?? 0;
  }

  private cellTransmitsBlockLight(x: number, y: number, z: number): boolean {
    if (this.peekBlockLight(x, y, z) > 0) return true;
    return this.peekBlockLight(x + 1, y, z) > 0
      || this.peekBlockLight(x - 1, y, z) > 0
      || this.peekBlockLight(x, y + 1, z) > 0
      || this.peekBlockLight(x, y - 1, z) > 0
      || this.peekBlockLight(x, y, z + 1) > 0
      || this.peekBlockLight(x, y, z - 1) > 0;
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
  ): { occlusionChanged: boolean; emissionChanged: boolean; skyChanged: boolean; lightRadius: number } | undefined {
    if (y < 0 || y >= WORLD_HEIGHT) return undefined;
    const chunkX = floorDiv(x, CHUNK_SIZE);
    const chunkZ = floorDiv(z, CHUNK_SIZE);
    const localX = positiveMod(x, CHUNK_SIZE);
    const localZ = positiveMod(z, CHUNK_SIZE);
    const chunk = this.getChunk(chunkX, chunkZ)!;
    const previous = chunk.get(localX, y, localZ) as BlockId;
    if (previous === block) return undefined;
    const previousDefinition = getBlockDefinition(previous);
    chunk.set(localX, y, localZ, block);
    if (block === BlockId.Air) this.blockStates.delete(blockKey(x, y, z));
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
    for (const [dx, dz] of neighborMeshOffsets(localX, localZ)) {
      this.dirtyNeighbor(chunkX + dx, chunkZ + dz, dirtyChunks);
    }
    const nextDefinition = getBlockDefinition(block);
    const occlusionChanged = previousDefinition.occludesFaces !== nextDefinition.occludesFaces;
    const emissionChanged = (previousDefinition.emission ?? 0) !== (nextDefinition.emission ?? 0);
    const skyChanged = skyOcclusionClass(previousDefinition) !== skyOcclusionClass(nextDefinition);
    const lightRadius = Math.min(15, Math.max(
      previousDefinition.emission ?? 0,
      nextDefinition.emission ?? 0,
      occlusionChanged || skyChanged ? 8 : 0,
    ));
    return { occlusionChanged, emissionChanged, skyChanged, lightRadius };
  }

  private dirtyNeighbor(chunkX: number, chunkZ: number, dirtyChunks: Set<string>): void {
    const neighbor = this.getChunk(chunkX, chunkZ, false);
    if (!neighbor) return;
    this.markMeshDirty(neighbor);
    dirtyChunks.add(chunkKey(chunkX, chunkZ));
  }

  markMeshDirty(chunk: Chunk): void {
    this.meshDirtyMarks += 1;
    chunk.dirty = true;
    this.pendingMesh.add(chunkKey(chunk.x, chunk.z));
    if (chunk.lightingReady && chunk.readyToMeshAt === 0) chunk.readyToMeshAt = performance.now();
  }

  acknowledgeMeshed(chunk: Chunk): void {
    if (chunk.dirty) return;
    this.pendingMesh.delete(chunkKey(chunk.x, chunk.z));
    chunk.readyToMeshAt = 0;
  }

  queueLight(region: LightRegion, sky: boolean, block: boolean): void {
    this.lightQueueMarks += 1;
    if (!this.pendingLight) {
      this.pendingLight = { region: { ...region }, sky, block };
      return;
    }
    const current = this.pendingLight.region;
    this.pendingLight = {
      sky: this.pendingLight.sky || sky,
      block: this.pendingLight.block || block,
      region: {
        minX: Math.min(current.minX, region.minX),
        minY: Math.min(current.minY, region.minY),
        minZ: Math.min(current.minZ, region.minZ),
        maxX: Math.max(current.maxX, region.maxX),
        maxY: Math.max(current.maxY, region.maxY),
        maxZ: Math.max(current.maxZ, region.maxZ),
      },
    };
  }

  flushLighting(): number {
    const pending = this.pendingLight;
    if (!pending) return 0;
    this.pendingLight = undefined;
    const start = performance.now();
    relightRegion(this, pending.region, pending.sky, pending.block);
    this.bumpDirtyInRegion(pending.region);
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
    const owner = lightingFloodOwner();

    if (this.pendingLight && (owner === '' || owner === 'region')) {
      const region = this.pendingLight.region;
      const done = continuePendingLight(this, this.pendingLight, deadline);
      if (done) {
        this.pendingLight = undefined;
        this.bumpDirtyInRegion(region);
      }
    }

    if (performance.now() < deadline && (lightingFloodOwner() === '' || lightingFloodOwner() !== 'region')) {
      const unlit = sortedLoadedChunksByDistance(
        this,
        originX,
        originZ,
        (chunk) => !chunk.lightingReady,
      );
      lightFrameStats.jobsPending = unlit.length + (this.pendingLight ? 1 : 0);
      for (const job of unlit) {
        if (performance.now() >= deadline) break;
        const key = chunkKey(job.chunk.x, job.chunk.z);
        const floodOwner = lightingFloodOwner();
        if (floodOwner !== '' && floodOwner !== key && floodOwner !== 'region') {
          if (counters) counters.blocked += 1;
          break;
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
    } else {
      lightFrameStats.jobsPending = this.unlitChunkCount + (this.pendingLight ? 1 : 0);
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

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): VoxelHit | undefined {
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
    const normal = new THREE.Vector3();
    while (distance <= maxDistance) {
      const block = this.getBlock(x, y, z);
      const definition = getBlockDefinition(block);
      if (block !== BlockId.Air && !definition.liquid) {
        if (definition.solid) {
          const hit = this.hitSolidBoxes(origin, dir, x, y, z, block, maxDistance);
          if (hit) return hit;
        } else {
          const point = origin.clone().addScaledVector(dir, distance);
          return { x, y, z, block, normal: normal.clone(), distance, point };
        }
      }
      if (maxX < maxY && maxX < maxZ) {
        x += stepX;
        distance = maxX;
        maxX += deltaX;
        normal.set(-stepX, 0, 0);
      } else if (maxY < maxZ) {
        y += stepY;
        distance = maxY;
        maxY += deltaY;
        normal.set(0, -stepY, 0);
      } else {
        z += stepZ;
        distance = maxZ;
        maxZ += deltaZ;
        normal.set(0, 0, -stepZ);
      }
    }
    return undefined;
  }

  private hitSolidBoxes(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    x: number,
    y: number,
    z: number,
    block: BlockId,
    maxDistance: number,
  ): VoxelHit | undefined {
    let best: ReturnType<typeof rayAabbDistance>;
    for (const box of blockCollisionBoxes(this, x, y, z)) {
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
    this.tickFurnaces();
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
      if ((block === BlockId.Water || block === BlockId.Lava) && this.tickNumber % (block === BlockId.Water ? 4 : 10) === 0) {
        const below = this.getBlock(scheduled.x, scheduled.y - 1, scheduled.z);
        if (below === BlockId.Air) {
          this.setBlock(scheduled.x, scheduled.y - 1, scheduled.z, block);
          this.schedule(scheduled.x, scheduled.y - 1, scheduled.z, 4);
        }
      }
    }
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
