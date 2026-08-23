import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, SEA_LEVEL, TERRAIN_HEADROOM, WORLD_HEIGHT } from '../src/core/constants';
import { Chunk } from '../src/world/Chunk';
import { collectSpawnColumns, CAVE_ROOF_DEPTH, ORE_RULES, TerrainGenerator } from '../src/world/Generator';
import {
  generateChunkGrid,
  maxNeighborHeightDelta,
  measureSurfaceIntegrity,
  measureWorldgenRegion,
  WORLDGEN_PINHOLE_SEEDS,
  WORLDGEN_QA_SEEDS,
} from '../src/world/worldgenMetrics';
import { VoxelWorld } from '../src/world/World';

const OLD_TREES_PER_FOREST = 7.073;
const OLD_CACTUS_PER_DESERT = 2.107;

describe('worldgen mountains, caves and density', () => {
  it('keeps WORLD_HEIGHT and headroom large enough for +20 mountains', () => {
    expect(WORLD_HEIGHT).toBe(96);
    expect(WORLD_HEIGHT - TERRAIN_HEADROOM).toBeGreaterThanOrEqual(84);
    expect(SEA_LEVEL).toBe(63);
  });

  it('is deterministic and varies by seed', () => {
    const a = new TerrainGenerator('worldgen-det');
    const b = new TerrainGenerator('worldgen-det');
    const c = new TerrainGenerator('worldgen-other');
    expect(a.columnAt(40, -12)).toEqual(b.columnAt(40, -12));
    const chunkA = new Chunk(1, -1);
    const chunkB = new Chunk(1, -1);
    a.generate(chunkA);
    b.generate(chunkB);
    expect([...chunkA.blocks]).toEqual([...chunkB.blocks]);
    expect(a.columnAt(40, -12).height).not.toBe(c.columnAt(40, -12).height);
  });

  it('produces periodic mountains in +10…+20 without flattening the world', () => {
    const heights: number[] = [];
    const mountains: number[] = [];
    for (const seed of WORLDGEN_QA_SEEDS) {
      const gen = new TerrainGenerator(seed);
      for (let z = -80; z <= 80; z += 4) {
        for (let x = -80; x <= 80; x += 4) {
          const column = gen.columnAt(x, z);
          heights.push(column.height);
          mountains.push(column.mountain);
        }
      }
    }
    const maxM = Math.max(...mountains);
    const share = mountains.filter((value) => value >= 10).length / mountains.length;
    expect(maxM).toBeGreaterThanOrEqual(10);
    expect(maxM).toBeLessThanOrEqual(21);
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.35);
    expect(Math.max(...heights)).toBeLessThanOrEqual(WORLD_HEIGHT - TERRAIN_HEADROOM);
    expect(Math.min(...heights)).toBeGreaterThan(SEA_LEVEL - 8);
  });

  it('keeps cross-chunk height changes smooth', () => {
    for (const seed of ['alpha', 'delta', 'india']) {
      expect(maxNeighborHeightDelta(new TerrainGenerator(seed), 500)).toBeLessThanOrEqual(4);
    }
  });

  it('does not cliff at biome transitions', () => {
    const gen = new TerrainGenerator('biome-seams');
    let biomeChanges = 0;
    let maxStep = 0;
    for (let x = -120; x < 120; x += 1) {
      const a = gen.columnAt(x, 8);
      const b = gen.columnAt(x + 1, 8);
      maxStep = Math.max(maxStep, Math.abs(a.height - b.height));
      if (a.biome !== b.biome) biomeChanges += 1;
    }
    expect(biomeChanges).toBeGreaterThan(0);
    expect(maxStep).toBeLessThanOrEqual(4);
  });

  it('keeps bedrock as a sealed floor and leaves extra underground under typical plains', () => {
    const gen = new TerrainGenerator('bedrock-depth');
    const stats = measureWorldgenRegion(gen, 2);
    expect(stats.maxBedrockY).toBeLessThanOrEqual(2);
    expect(stats.bedrockBroken).toBe(0);
    expect(stats.avgHeight - stats.maxBedrockY).toBeGreaterThanOrEqual(55);
    const chunk = new Chunk(0, 0);
    gen.generate(chunk);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        expect(chunk.get(x, 0, z)).toBe(BlockId.Bedrock);
        const floor = gen.bedrockHeight(chunk.x * CHUNK_SIZE + x, chunk.z * CHUNK_SIZE + z);
        for (let y = 0; y <= floor; y += 1) expect(chunk.get(x, y, z)).toBe(BlockId.Bedrock);
      }
    }
  });

  it('carves connected caves that continue across chunk borders', () => {
    const gen = new TerrainGenerator('cave-network');
    const west = new Chunk(0, 0);
    const east = new Chunk(1, 0);
    gen.generate(west);
    gen.generate(east);
    let borderCaves = 0;
    let continued = 0;
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let y = 4; y < 70; y += 1) {
        const wx = 15;
        const wz = z;
        if (!gen.isCave(wx, y, wz, gen.columnAt(wx, wz).height)) continue;
        if (west.get(15, y, z) !== BlockId.Air && west.get(15, y, z) !== BlockId.Lava) continue;
        borderCaves += 1;
        const continues = gen.isCave(16, y, wz, gen.columnAt(16, wz).height);
        const eastBlock = east.get(0, y, z);
        if (continues) {
          expect([BlockId.Air, BlockId.Lava]).toContain(eastBlock);
          continued += 1;
        }
      }
    }
    expect(borderCaves).toBeGreaterThan(5);
    expect(continued).toBeGreaterThan(0);
    const stats = measureWorldgenRegion(gen, 2);
    expect(stats.caveLargest).toBeGreaterThan(80);
    expect(stats.caveMeanWidth).toBeGreaterThan(1.1);
    expect(stats.caveRatio).toBeGreaterThan(0.04);
    expect(stats.caveRatio).toBeLessThan(0.28);
  });

  it('does not punch 1×1 cave pinholes through plains, forest, desert or mountain surfaces', () => {
    let plains = 0;
    let forest = 0;
    let desert = 0;
    let mountain = 0;
    let pinholes = 0;
    let tiny = 0;
    let holes = 0;
    let thinRoof = 0;
    let hillside = 0;
    for (const seed of WORLDGEN_PINHOLE_SEEDS) {
      const gen = new TerrainGenerator(seed);
      const chunks = generateChunkGrid(gen, 2);
      const integrity = measureSurfaceIntegrity(chunks, gen);
      pinholes += integrity.pinholeOpenings;
      tiny += integrity.tinyOpenings;
      holes += integrity.surfaceHoles;
      thinRoof += integrity.thinRoofCells;
      hillside += integrity.hillsideExposures;
      for (const chunk of chunks.values()) {
        const center = gen.columnAt(chunk.x * CHUNK_SIZE + 8, chunk.z * CHUNK_SIZE + 8);
        if (center.biome === 'plains') plains += 1;
        if (center.biome === 'forest') forest += 1;
        if (center.biome === 'desert') desert += 1;
        if (center.mountain >= 10) mountain += 1;
      }
    }
    expect(plains).toBeGreaterThan(0);
    expect(forest).toBeGreaterThan(0);
    expect(desert).toBeGreaterThan(0);
    expect(mountain).toBeGreaterThan(0);
    expect(pinholes, '1×1 surface openings').toBe(0);
    expect(tiny, '1–2 block surface openings').toBe(0);
    expect(holes, 'any surface cave mouths').toBe(0);
    expect(thinRoof, 'cave air inside the roof cap').toBe(0);
    expect(hillside, 'side leaks on slopes').toBe(0);
  });

  it('keeps a solid roof of CAVE_ROOF_DEPTH under ordinary cave air', () => {
    expect(CAVE_ROOF_DEPTH).toBeGreaterThanOrEqual(3);
    const gen = new TerrainGenerator('cave-network');
    const stats = measureWorldgenRegion(gen, 2);
    expect(stats.thinRoofCells).toBe(0);
    expect(stats.caveLargest).toBeGreaterThan(1000);
    expect(stats.caveRatio).toBeGreaterThan(0.08);
  });

  it('reduces forest trees ~2–3× and desert cactus ~4× vs the previous generator', () => {
    let trees = 0;
    let cactus = 0;
    let forestChunks = 0;
    let desertChunks = 0;
    for (const seed of WORLDGEN_QA_SEEDS) {
      const stats = measureWorldgenRegion(new TerrainGenerator(seed), 2);
      trees += stats.trees;
      cactus += stats.cactus;
      forestChunks += stats.forestChunks;
      desertChunks += stats.desertChunks;
    }
    const treesPer = trees / Math.max(1, forestChunks);
    const cactusPer = cactus / Math.max(1, desertChunks);
    const treeRatio = treesPer / OLD_TREES_PER_FOREST;
    const cactusRatio = cactusPer / OLD_CACTUS_PER_DESERT;
    expect(treeRatio).toBeGreaterThan(0.28);
    expect(treeRatio).toBeLessThan(0.58);
    expect(cactusRatio).toBeGreaterThan(0.12);
    expect(cactusRatio).toBeLessThan(0.38);
    expect(treesPer).toBeGreaterThan(1.2);
  });

  it('keeps ores in the shifted bands including the new deep range', () => {
    const gen = new TerrainGenerator('ore-depth');
    const found = new Map<BlockId, number>();
    let deepDiamond = 0;
    for (let cz = -1; cz <= 1; cz += 1) {
      for (let cx = -1; cx <= 1; cx += 1) {
        const chunk = new Chunk(cx, cz);
        gen.generate(chunk);
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          for (let z = 0; z < CHUNK_SIZE; z += 1) {
            for (let x = 0; x < CHUNK_SIZE; x += 1) {
              const block = chunk.get(x, y, z) as BlockId;
              const rule = ORE_RULES.find((item) => item.block === block);
              if (!rule) continue;
              expect(y).toBeGreaterThanOrEqual(rule.minY);
              expect(y).toBeLessThanOrEqual(rule.maxY);
              found.set(block, (found.get(block) ?? 0) + 1);
              if (block === BlockId.DiamondOre && y <= 12) deepDiamond += 1;
            }
          }
        }
      }
    }
    for (const rule of ORE_RULES) expect(found.get(rule.block) ?? 0, BlockId[rule.block]).toBeGreaterThan(0);
    expect(deepDiamond).toBeGreaterThan(0);
    expect(found.get(BlockId.CoalOre) ?? 0).toBeGreaterThan(found.get(BlockId.DiamondOre) ?? 0);
  });

  it('spawns the player on open plains above sea, not in caves or mountains', () => {
    for (const seed of ['spawn-a', 'spawn-b', 'alpha']) {
      const world = new VoxelWorld(seed);
      const candidates = collectSpawnColumns(world.generator);
      expect(candidates.length).toBeGreaterThan(0);
      const found = candidates.find((column) => {
        world.getChunk(Math.floor(column.x / CHUNK_SIZE), Math.floor(column.z / CHUNK_SIZE));
        return world.getBlock(column.x, column.height, column.z) === BlockId.GrassBlock
          && !world.isSolid(column.x, column.height + 1, column.z)
          && !world.isSolid(column.x, column.height + 2, column.z);
      });
      expect(found).toBeDefined();
      expect(found!.biome).toBe('plains');
      expect(found!.mountain).toBeLessThan(10);
      expect(found!.height).toBeGreaterThan(SEA_LEVEL);
    }
  });

  it('keeps a single-chunk generation budget after the taller world', () => {
    const generator = new TerrainGenerator('gen-budget');
    const samples: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const chunk = new Chunk(i, 0);
      const start = performance.now();
      generator.generate(chunk);
      samples.push(performance.now() - start);
    }
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    expect(average).toBeLessThan(40);
  });

  it('restores old modification indices after the height change', () => {
    const world = new VoxelWorld('save-compat');
    world.restore({
      timeOfDay: 1000,
      modifications: { '0,0': { [Chunk.index(4, 50, 7)]: BlockId.Tnt } },
      chests: {},
      furnaces: {},
    });
    expect(world.getBlock(4, 50, 7)).toBe(BlockId.Tnt);
    expect(Chunk.index(4, 50, 7)).toBe(50 * 16 * 16 + 7 * 16 + 4);
  });
});
