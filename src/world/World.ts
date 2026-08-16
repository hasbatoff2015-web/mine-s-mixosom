import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, blockKey, chunkKey, floorDiv, positiveMod } from '../core/constants';
import { findSmeltingRecipe, getFuelBurnTicks } from '../crafting';
import type { ItemStack } from '../inventory';
import { getItemDefinition } from '../items';
import type { SerializedWorldState } from '../save/types';
import { Chunk } from './Chunk';
import { TerrainGenerator, type Biome } from './Generator';

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  block: BlockId;
  normal: THREE.Vector3;
  distance: number;
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
  readonly generator: TerrainGenerator;
  timeOfDay = 1_000;
  tickNumber = 0;
  generationSamples = 0;
  generationTotalMs = 0;
  generationMaximumMs = 0;
  private readonly scheduled: ScheduledBlockTick[] = [];

  constructor(readonly seed: string) {
    this.generator = new TerrainGenerator(seed);
  }

  restore(state: Pick<SerializedWorldState, 'timeOfDay' | 'modifications' | 'chests' | 'furnaces'>): void {
    this.timeOfDay = state.timeOfDay;
    for (const [key, entries] of Object.entries(state.modifications)) {
      const delta = new Map<number, BlockId>();
      for (const [index, block] of Object.entries(entries)) delta.set(Number(index), block as BlockId);
      this.modifications.set(key, delta);
    }
    for (const [key, value] of Object.entries(state.chests)) this.chests.set(key, value as ChestState);
    for (const [key, value] of Object.entries(state.furnaces)) this.furnaces.set(key, value as FurnaceState);
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
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const neighbor = this.chunks.get(chunkKey(chunkX + dx, chunkZ + dz));
        if (neighbor) neighbor.dirty = true;
      }
    }
    if (chunk) chunk.lastTouched = performance.now();
    return chunk;
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
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const chunkX = floorDiv(x, CHUNK_SIZE);
    const chunkZ = floorDiv(z, CHUNK_SIZE);
    const localX = positiveMod(x, CHUNK_SIZE);
    const localZ = positiveMod(z, CHUNK_SIZE);
    const chunk = this.getChunk(chunkX, chunkZ)!;
    if (chunk.get(localX, y, localZ) === block) return false;
    chunk.set(localX, y, localZ, block);
    if (record) {
      const key = chunkKey(chunkX, chunkZ);
      let delta = this.modifications.get(key);
      if (!delta) {
        delta = new Map();
        this.modifications.set(key, delta);
      }
      delta.set(Chunk.index(localX, y, localZ), block);
    }
    if (localX === 0) {
      const neighbor = this.getChunk(chunkX - 1, chunkZ, false);
      if (neighbor) neighbor.dirty = true;
    }
    if (localX === CHUNK_SIZE - 1) {
      const neighbor = this.getChunk(chunkX + 1, chunkZ, false);
      if (neighbor) neighbor.dirty = true;
    }
    if (localZ === 0) {
      const neighbor = this.getChunk(chunkX, chunkZ - 1, false);
      if (neighbor) neighbor.dirty = true;
    }
    if (localZ === CHUNK_SIZE - 1) {
      const neighbor = this.getChunk(chunkX, chunkZ + 1, false);
      if (neighbor) neighbor.dirty = true;
    }
    this.schedule(x, y, z, 1);
    this.schedule(x, y + 1, z, 1);
    return true;
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
      if (block !== BlockId.Air && !definition.replaceable && !definition.liquid) return { x, y, z, block, normal: normal.clone(), distance };
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

  private schedule(x: number, y: number, z: number, delay: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.scheduled.push({ x, y, z, due: this.tickNumber + delay });
    if (this.scheduled.length > 4096) this.scheduled.splice(0, this.scheduled.length - 4096);
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
      processed += 1;
      const block = this.getBlock(scheduled.x, scheduled.y, scheduled.z);
      const definition = getBlockDefinition(block);
      if (definition.gravity && scheduled.y > 0) {
        const below = this.getBlock(scheduled.x, scheduled.y - 1, scheduled.z);
        const belowDefinition = getBlockDefinition(below);
        if (below === BlockId.Air || belowDefinition.liquid || belowDefinition.replaceable) {
          this.setBlock(scheduled.x, scheduled.y - 1, scheduled.z, block);
          this.setBlock(scheduled.x, scheduled.y, scheduled.z, BlockId.Air);
          this.schedule(scheduled.x, scheduled.y - 1, scheduled.z, 1);
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
