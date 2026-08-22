import * as THREE from 'three';
import { BlockId, getBlockDefinition, type BlockRenderState } from '../blocks';
import { blockCollisionBoxes, rayAabbDistance } from './collision';
import { CHUNK_SIZE, WORLD_HEIGHT, blockKey, chunkKey, floorDiv, positiveMod } from '../core/constants';
import { findSmeltingRecipe, getFuelBurnTicks } from '../crafting';
import type { ItemStack } from '../inventory';
import { getItemDefinition } from '../items';
import type { SerializedWorldState } from '../save/types';
import { Chunk } from './Chunk';
import { TerrainGenerator, type Biome } from './Generator';
import {
  ensureChunkSky,
  getBlockLight,
  getSkyLight,
  relightRegion,
  seedChunkBlockLight,
  lightEngineStats,
} from './LightEngine';

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
      ensureChunkSky(this, chunk);
      seedChunkBlockLight(this, chunk);
      const generationMilliseconds = performance.now() - generationStart;
      this.generationSamples += 1;
      this.generationTotalMs += generationMilliseconds;
      this.generationMaximumMs = Math.max(this.generationMaximumMs, generationMilliseconds);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const neighbor = this.chunks.get(chunkKey(chunkX + dx, chunkZ + dz));
        if (neighbor) neighbor.dirty = true;
      }
    }
    if (chunk) chunk.lastTouched = performance.now();
    if (chunk && !chunk.skyReady) ensureChunkSky(this, chunk);
    if (chunk && !chunk.blockLightReady) seedChunkBlockLight(this, chunk);
    return chunk;
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
    let occlusionChanged = false;
    let emissionChanged = false;
    let lightRadius = 8;

    const unique = new Map<string, BlockMutation>();
    for (const mutation of mutations) {
      unique.set(blockKey(mutation.x, mutation.y, mutation.z), mutation);
    }

    for (const mutation of unique.values()) {
      const wrote = this.writeBlockRaw(mutation.x, mutation.y, mutation.z, mutation.block, record, dirtyChunks);
      if (!wrote) continue;
      applied += 1;
      minX = Math.min(minX, mutation.x);
      minY = Math.min(minY, mutation.y);
      minZ = Math.min(minZ, mutation.z);
      maxX = Math.max(maxX, mutation.x);
      maxY = Math.max(maxY, mutation.y);
      maxZ = Math.max(maxZ, mutation.z);
      if (wrote.occlusionChanged) occlusionChanged = true;
      if (wrote.emissionChanged) emissionChanged = true;
      lightRadius = Math.max(lightRadius, wrote.lightRadius);
      if (scheduleNeighbors) {
        this.schedule(mutation.x, mutation.y, mutation.z, 1);
        this.schedule(mutation.x, mutation.y + 1, mutation.z, 1);
      }
    }

    const mutationMs = performance.now() - mutationStart;
    let relightMs = 0;
    const skyBefore = this.skyRecomputeSnapshot();
    if (applied > 0 && updateLighting && (occlusionChanged || emissionChanged)) {
      const relightStart = performance.now();
      relightRegion(this, {
        minX: minX - lightRadius,
        minY: minY - lightRadius,
        minZ: minZ - lightRadius,
        maxX: maxX + lightRadius,
        maxY: maxY + lightRadius,
        maxZ: maxZ + lightRadius,
      }, occlusionChanged);
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

  private writeBlockRaw(
    x: number,
    y: number,
    z: number,
    block: BlockId,
    record: boolean,
    dirtyChunks: Set<string>,
  ): { occlusionChanged: boolean; emissionChanged: boolean; lightRadius: number } | undefined {
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
    chunk.dirty = true;
    dirtyChunks.add(chunkKey(chunkX, chunkZ));
    if (localX === 0) this.dirtyNeighbor(chunkX - 1, chunkZ, dirtyChunks);
    if (localX === CHUNK_SIZE - 1) this.dirtyNeighbor(chunkX + 1, chunkZ, dirtyChunks);
    if (localZ === 0) this.dirtyNeighbor(chunkX, chunkZ - 1, dirtyChunks);
    if (localZ === CHUNK_SIZE - 1) this.dirtyNeighbor(chunkX, chunkZ + 1, dirtyChunks);
    const nextDefinition = getBlockDefinition(block);
    const occlusionChanged = previousDefinition.occludesFaces !== nextDefinition.occludesFaces;
    const emissionChanged = (previousDefinition.emission ?? 0) !== (nextDefinition.emission ?? 0);
    const lightRadius = Math.min(15, Math.max(
      previousDefinition.emission ?? 0,
      nextDefinition.emission ?? 0,
      occlusionChanged ? 8 : 0,
    ));
    return { occlusionChanged, emissionChanged, lightRadius };
  }

  private dirtyNeighbor(chunkX: number, chunkZ: number, dirtyChunks: Set<string>): void {
    const neighbor = this.getChunk(chunkX, chunkZ, false);
    if (!neighbor) return;
    neighbor.dirty = true;
    dirtyChunks.add(chunkKey(chunkX, chunkZ));
  }

  /** Invalidates geometry when runtime visual state changes without changing BlockId. */
  markBlockDirty(x: number, z: number): void {
    const chunk = this.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), false);
    if (chunk) chunk.dirty = true;
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
    for (const furnace of this.furnaces.values()) {
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
    }
  }
}
