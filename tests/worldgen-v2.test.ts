import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT, floorDiv, positiveMod } from '../src/core/constants';
import { biomeGrassTint } from '../src/rendering/ChunkMesher';
import { Chunk } from '../src/world/Chunk';
import {
  BIOME_CODES,
  CAVE_DEPOSIT_MAX_Y,
  CAVE_DEPOSIT_MIN_Y,
  DESERT_THRESHOLD,
  FOREST_THRESHOLD,
  SNOWY_THRESHOLD,
  TREE_BLOCKS,
  TerrainGenerator,
  biomeCode,
  spawnColumnScore,
  type Biome,
  type TreeKind,
} from '../src/world/Generator';

const SAMPLE_SEEDS = ['alpha', 'bravo', 'charlie', 'delta'];
const DIRECTIONS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

function generateChunk(generator: TerrainGenerator, cx: number, cz: number): Chunk {
  const chunk = new Chunk(cx, cz);
  generator.generate(chunk);
  return chunk;
}

function findColumn(
  generator: TerrainGenerator,
  predicate: (column: ReturnType<TerrainGenerator['columnAt']>, x: number, z: number) => boolean,
): { x: number; z: number; column: ReturnType<TerrainGenerator['columnAt']> } {
  for (let z = -1024; z < 1024; z += 8) {
    for (let x = -1024; x < 1024; x += 8) {
      const column = generator.columnAt(x, z);
      if (predicate(column, x, z)) return { x, z, column };
    }
  }
  throw new Error('fixed worldgen sample column not found');
}

function findBiomeChunk(generator: TerrainGenerator, biome: Biome): { cx: number; cz: number } {
  let best = { cx: 0, cz: 0, score: -1 };
  for (let cz = -64; cz <= 64; cz += 1) {
    for (let cx = -64; cx <= 64; cx += 1) {
      let score = 0;
      for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (generator.columnAt((cx + dx) * CHUNK_SIZE + 8, (cz + dz) * CHUNK_SIZE + 8).biome === biome) score += 1;
      }
      if (score > best.score) best = { cx, cz, score };
      if (score === 9) return best;
    }
  }
  if (best.score < 5) throw new Error(`contiguous ${biome} sample not found`);
  return best;
}

function generateGrid(generator: TerrainGenerator, center: { cx: number; cz: number }, radius: number): Map<string, Chunk> {
  const chunks = new Map<string, Chunk>();
  for (let dz = -radius; dz <= radius; dz += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const cx = center.cx + dx;
    const cz = center.cz + dz;
    chunks.set(`${cx},${cz}`, generateChunk(generator, cx, cz));
  }
  return chunks;
}

function blockAt(chunks: ReadonlyMap<string, Chunk>, x: number, y: number, z: number): number | undefined {
  const chunk = chunks.get(`${floorDiv(x, CHUNK_SIZE)},${floorDiv(z, CHUNK_SIZE)}`);
  return chunk?.get(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE));
}

function largestComponent(cells: ReadonlySet<string>): number {
  const seen = new Set<string>();
  let largest = 0;
  for (const start of cells) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let size = 0;
    while (stack.length > 0) {
      const [x, z] = stack.pop()!.split(',').map(Number) as [number, number];
      size += 1;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const key = `${x + dx},${z + dz}`;
        if (!cells.has(key) || seen.has(key)) continue;
        seen.add(key);
        stack.push(key);
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

describe('Worldgen V2 snowy regions, mixed forest and cave deposits', () => {
  it('uses exhaustive biome codes and statistically calibrated contiguous snowy regions', () => {
    expect(BIOME_CODES).toEqual({ plains: 0, forest: 1, desert: 2, snowy_plains: 3 });
    expect((Object.keys(BIOME_CODES) as Biome[]).map(biomeCode)).toEqual([0, 1, 2, 3]);
    expect({ desert: DESERT_THRESHOLD, forest: FOREST_THRESHOLD, snowy: SNOWY_THRESHOLD })
      .toEqual({ desert: 0.24, forest: -0.14, snowy: -0.36 });
    const counts: Record<Biome, number> = { plains: 0, forest: 0, desert: 0, snowy_plains: 0 };
    let land = 0;
    let largestSnow = 0;
    for (const seed of SAMPLE_SEEDS) {
      const generator = new TerrainGenerator(seed);
      const snowy = new Set<string>();
      for (let z = -1024; z < 1024; z += 16) for (let x = -1024; x < 1024; x += 16) {
        const column = generator.columnAt(x, z);
        if (column.height <= SEA_LEVEL) continue;
        land += 1;
        counts[column.biome] += 1;
        if (column.biome === 'snowy_plains') snowy.add(`${x / 16},${z / 16}`);
      }
      largestSnow = Math.max(largestSnow, largestComponent(snowy));
    }
    for (const biome of Object.keys(counts) as Biome[]) expect(counts[biome], biome).toBeGreaterThan(0);
    const snowyShare = counts.snowy_plains / land;
    expect(snowyShare).toBeGreaterThanOrEqual(0.08);
    expect(snowyShare).toBeLessThanOrEqual(0.15);
    expect(largestSnow).toBeGreaterThan(80);
  });

  it('builds SnowBlock over Dirt and freezes only exposed sea-level water', () => {
    const generator = new TerrainGenerator('alpha');
    const land = findColumn(generator, (column) => column.biome === 'snowy_plains' && column.height > SEA_LEVEL);
    const landChunk = generateChunk(generator, floorDiv(land.x, CHUNK_SIZE), floorDiv(land.z, CHUNK_SIZE));
    const lx = positiveMod(land.x, CHUNK_SIZE);
    const lz = positiveMod(land.z, CHUNK_SIZE);
    expect(landChunk.get(lx, land.column.height, lz)).toBe(BlockId.SnowBlock);
    expect(landChunk.biomeCodes[lz * CHUNK_SIZE + lx]).toBe(BIOME_CODES.snowy_plains);
    expect(landChunk.get(lx, land.column.height - 1, lz)).toBe(BlockId.Dirt);
    expect(landChunk.get(lx, land.column.height - 2, lz)).toBe(BlockId.Dirt);
    expect(landChunk.get(lx, land.column.height - 3, lz)).toBe(BlockId.Dirt);
    expect(landChunk.get(lx, land.column.height - 4, lz)).not.toBe(BlockId.SnowBlock);

    const water = { x: 2624, z: -2996, column: generator.columnAt(2624, -2996) };
    expect(water.column.biome).toBe('snowy_plains');
    expect(water.column.height).toBeLessThanOrEqual(SEA_LEVEL - 2);
    const waterChunk = generateChunk(generator, floorDiv(water.x, CHUNK_SIZE), floorDiv(water.z, CHUNK_SIZE));
    const wx = positiveMod(water.x, CHUNK_SIZE);
    const wz = positiveMod(water.z, CHUNK_SIZE);
    expect(waterChunk.get(wx, SEA_LEVEL, wz)).toBe(BlockId.Ice);
    expect(waterChunk.get(wx, SEA_LEVEL - 1, wz)).toBe(BlockId.Water);
    expect(waterChunk.get(wx, water.column.height, wz)).toBe(BlockId.SnowBlock);
  });

  it('mixes all forest trees, keeps snowy spruce sparse, and preserves plains oak', () => {
    const forest = { oak: 0, birch: 0, spruce: 0 };
    let forestColumns = 0;
    let snowyColumns = 0;
    let snowyTrees = 0;
    let plainsTrees = 0;
    let checkedTreeShapes = 0;
    const perSeedForestSignatures = new Set<string>();
    for (const seed of SAMPLE_SEEDS) {
      const generator = new TerrainGenerator(seed);
      const before = { ...forest };
      for (const biome of ['forest', 'snowy_plains', 'plains'] as const) {
        const chunks = generateGrid(generator, findBiomeChunk(generator, biome), biome === 'plains' ? 1 : 2);
        for (const chunk of chunks.values()) for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const worldX = chunk.x * CHUNK_SIZE + x;
          const worldZ = chunk.z * CHUNK_SIZE + z;
          const column = generator.columnAt(worldX, worldZ);
          const root = chunk.get(x, column.height + 1, z);
          if (column.biome === 'forest') {
            forestColumns += 1;
            const kind = treeKindForLog(root);
            if (!kind) continue;
            forest[kind] += 1;
            expectTreeIdentity(chunk, x, column.height + 1, z, kind);
            checkedTreeShapes += 1;
          } else if (column.biome === 'snowy_plains') {
            snowyColumns += 1;
            expect(root === BlockId.OakLog || root === BlockId.BirchLog).toBe(false);
            if (root === BlockId.SpruceLog) {
              snowyTrees += 1;
              expectTreeIdentity(chunk, x, column.height + 1, z, 'spruce');
              checkedTreeShapes += 1;
            }
          } else if (column.biome === 'plains') {
            expect(root === BlockId.BirchLog || root === BlockId.SpruceLog).toBe(false);
            if (root === BlockId.OakLog) plainsTrees += 1;
          }
        }
      }
      perSeedForestSignatures.add(`${forest.oak - before.oak},${forest.birch - before.birch},${forest.spruce - before.spruce}`);
    }
    const totalForest = forest.oak + forest.birch + forest.spruce;
    expect(totalForest).toBeGreaterThan(80);
    for (const count of Object.values(forest)) {
      expect(count / totalForest).toBeGreaterThan(0.25);
      expect(count / totalForest).toBeLessThan(0.40);
    }
    const forestPerChunk = totalForest * CHUNK_SIZE * CHUNK_SIZE / forestColumns;
    const snowyPerChunk = snowyTrees * CHUNK_SIZE * CHUNK_SIZE / snowyColumns;
    expect(forestPerChunk).toBeGreaterThan(2);
    expect(snowyPerChunk).toBeGreaterThanOrEqual(0.1);
    expect(snowyPerChunk).toBeLessThanOrEqual(0.3);
    expect(snowyPerChunk).toBeLessThan(forestPerChunk / 5);
    expect(plainsTrees).toBeGreaterThan(0);
    expect(checkedTreeShapes).toBeGreaterThan(80);
    expect(perSeedForestSignatures.size).toBeGreaterThan(1);
  }, 60_000);

  it('places bounded connected cave patches without fluid, ore, cap, surface, gravity or seam regressions', () => {
    let gravel = 0;
    let clay = 0;
    let gravelChunks = 0;
    let clayChunks = 0;
    let crossChunkContinuation = 0;
    for (const seed of SAMPLE_SEEDS) {
      const generator = new TerrainGenerator(seed);
      const chunks = generateGrid(generator, { cx: 0, cz: 0 }, 3);
      for (const chunk of chunks.values()) {
        let hasGravel = false;
        let hasClay = false;
        for (let y = CAVE_DEPOSIT_MIN_Y; y <= CAVE_DEPOSIT_MAX_Y; y += 1) {
          for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
            const block = chunk.get(x, y, z);
            if (block !== BlockId.Gravel && block !== BlockId.Clay) continue;
            const worldX = chunk.x * CHUNK_SIZE + x;
            const worldZ = chunk.z * CHUNK_SIZE + z;
            if (block === BlockId.Gravel) { gravel += 1; hasGravel = true; }
            else { clay += 1; hasClay = true; }
            expect(y).toBeGreaterThan(3);
            expect(y).toBeLessThan(generator.columnAt(worldX, worldZ).height - 3);
            expect(DIRECTIONS.some(([dx, dy, dz]) => generator.isNaturalCaveAir(worldX + dx, y + dy, worldZ + dz))).toBe(true);
            for (const [dx, dy, dz] of DIRECTIONS) {
              const neighbor = blockAt(chunks, worldX + dx, y + dy, worldZ + dz);
              if (neighbor !== undefined) expect([BlockId.Water, BlockId.Lava]).not.toContain(neighbor);
            }
            if (block === BlockId.Gravel) {
              const below = blockAt(chunks, worldX, y - 1, worldZ);
              expect(below).not.toBeUndefined();
              expect(getBlockDefinition(below as BlockId).solid).toBe(true);
              expect([BlockId.Air, BlockId.Water, BlockId.Lava]).not.toContain(below);
            }
            if (x === CHUNK_SIZE - 1 && blockAt(chunks, worldX + 1, y, worldZ) === block) crossChunkContinuation += 1;
            if (z === CHUNK_SIZE - 1 && blockAt(chunks, worldX, y, worldZ + 1) === block) crossChunkContinuation += 1;
          }
        }
        if (hasGravel) gravelChunks += 1;
        if (hasClay) clayChunks += 1;
        for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
          expect([BlockId.Gravel, BlockId.Clay]).not.toContain(chunk.get(x, 3, z));
          const surface = chunk.surfaceHeights[z * CHUNK_SIZE + x]!;
          expect([BlockId.Gravel, BlockId.Clay]).not.toContain(chunk.get(x, surface, z));
        }
      }
    }
    expect(gravel).toBeGreaterThan(100);
    expect(clay).toBeGreaterThan(50);
    expect(gravelChunks).toBeGreaterThan(10);
    expect(clayChunks).toBeGreaterThan(10);
    expect(crossChunkContinuation).toBeGreaterThan(0);
  }, 60_000);

  it('is chunk-order independent and keeps spawn ranking explicit', () => {
    const coordinates = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
    const forward = new TerrainGenerator('worldgen-v2-order');
    const reverse = new TerrainGenerator('worldgen-v2-order');
    const a = new Map<string, Uint16Array>();
    const b = new Map<string, Uint16Array>();
    for (const [cx, cz] of coordinates) a.set(`${cx},${cz}`, generateChunk(forward, cx, cz).blocks.slice());
    for (const [cx, cz] of [...coordinates].reverse()) b.set(`${cx},${cz}`, generateChunk(reverse, cx, cz).blocks.slice());
    for (const [key, blocks] of a) expect([...blocks]).toEqual([...b.get(key)!]);

    const score = (biome: Biome) => spawnColumnScore({ x: 0, z: 0, height: 70, mountain: 0, biome });
    expect(score('plains')).toBeLessThan(score('forest'));
    expect(score('forest')).toBeLessThan(score('snowy_plains'));
    expect(score('snowy_plains')).toBeLessThan(score('desert'));
    expect(biomeGrassTint(3)).not.toEqual(biomeGrassTint(0));
    expect(biomeGrassTint(3).every(Number.isFinite)).toBe(true);
  }, 30_000);
});

function treeKindForLog(block: number): TreeKind | undefined {
  if (block === BlockId.OakLog) return 'oak';
  if (block === BlockId.BirchLog) return 'birch';
  if (block === BlockId.SpruceLog) return 'spruce';
  return undefined;
}

function expectTreeIdentity(chunk: Chunk, x: number, y: number, z: number, kind: TreeKind): void {
  const expected = TREE_BLOCKS[kind];
  let logs = 0;
  let leaves = 0;
  let top = y;
  for (let py = y; py < Math.min(WORLD_HEIGHT, y + 12); py += 1) {
    if (chunk.get(x, py, z) === expected.log) { logs += 1; top = py; }
    for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) {
      if (chunk.get(x + dx, py, z + dz) === expected.leaves) leaves += 1;
    }
  }
  expect(logs).toBeGreaterThanOrEqual(kind === 'oak' ? 4 : kind === 'birch' ? 5 : 6);
  expect(leaves).toBeGreaterThan(0);
  expect(top).toBeLessThan(WORLD_HEIGHT);
}
