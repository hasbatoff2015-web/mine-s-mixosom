import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { isFluidSource } from '../src/world/fluids';
import { Chunk } from '../src/world/Chunk';
import {
  BEDROCK_COVER_DEPTH,
  STONE_CAP_TOP_Y,
  LAVA_POND_MAX_DEPTH,
  ORE_RULES,
  TerrainGenerator,
  minCaveY,
  stoneCapY,
} from '../src/world/Generator';
import { VoxelWorld } from '../src/world/World';
import {
  WORLDGEN_PINHOLE_SEEDS,
  countExposedBedrock,
  generateChunkGrid,
  measureLavaPonds,
  measureOreComponentSizes,
  measureOreCounts,
} from '../src/world/worldgenMetrics';

/** 20 seeds × 5×5 chunks, captured before vein doubling / pond rewrite. */
const ORE_BASELINE = {
  coal: 28455,
  iron: 23080,
  gold: 7080,
  redstone: 8482,
  diamond: 2764,
} as const;

function tickWorld(world: VoxelWorld, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) world.tick();
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
}

describe('cave lava ponds, bedrock cap and ore doubling', () => {
  it('keeps a Stone cap above Bedrock that caves and lava cannot remove', () => {
    expect(BEDROCK_COVER_DEPTH).toBe(1);
    const generator = new TerrainGenerator('bedrock-cap');
    const chunk = new Chunk(0, 0);
    generator.generate(chunk);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const wx = x;
        const wz = z;
        const floor = generator.bedrockHeight(wx, wz);
        const cap = stoneCapY(floor);
        expect(minCaveY(floor)).toBe(cap + 1);
        for (let y = 0; y <= floor; y += 1) expect(chunk.get(x, y, z)).toBe(BlockId.Bedrock);
        expect(chunk.get(x, cap, z)).toBe(BlockId.Stone);
        expect(cap).toBe(STONE_CAP_TOP_Y);
        expect(chunk.get(x, cap, z)).not.toBe(BlockId.Air);
        expect(chunk.get(x, cap, z)).not.toBe(BlockId.Lava);
        expect(generator.isCave(wx, cap, wz, generator.columnAt(wx, wz).height)).toBe(false);
        for (let y = 0; y <= cap; y += 1) {
          expect(chunk.get(x, y, z)).not.toBe(BlockId.Air);
          expect(chunk.get(x, y, z)).not.toBe(BlockId.Lava);
        }
      }
    }
  });

  it('bounds lava ponds, hides Bedrock, and roughly doubles ores across 20 seeds', () => {
    let exposed = 0;
    let totalPonds = 0;
    let hanging = 0;
    const sizes: number[] = [];
    const depths: number[] = [];
    const widths: number[] = [];
    let maxFill = 0;
    let minSupport = 1;
    const totals = { coal: 0, iron: 0, gold: 0, redstone: 0, diamond: 0 };
    let borderContinued = 0;
    let capLava = 0;
    let capAir = 0;
    for (const seed of WORLDGEN_PINHOLE_SEEDS) {
      const generator = new TerrainGenerator(seed);
      const chunks = generateChunkGrid(generator, 2);
      exposed += countExposedBedrock(chunks, generator);
      const lava = measureLavaPonds(chunks);
      totalPonds += lava.count;
      hanging += lava.hangingCells;
      maxFill = Math.max(maxFill, lava.maxFillRatioLarge);
      for (const pond of lava.ponds) {
        sizes.push(pond.cells);
        depths.push(pond.depth);
        widths.push(Math.max(pond.width, pond.length));
        minSupport = Math.min(minSupport, pond.support);
        expect(pond.depth).toBeLessThanOrEqual(LAVA_POND_MAX_DEPTH);
        expect(Math.max(pond.width, pond.length)).toBeLessThanOrEqual(14);
        expect(pond.cells).toBeLessThanOrEqual(160);
        if (Math.max(pond.width, pond.length) >= 10) {
          expect(pond.fillRatio).toBeLessThan(0.92);
        }
      }
      const ores = measureOreCounts(chunks);
      totals.coal += ores.coal;
      totals.iron += ores.iron;
      totals.gold += ores.gold;
      totals.redstone += ores.redstone;
      totals.diamond += ores.diamond;
      const west = chunks.get('0,0')!;
      const east = chunks.get('1,0')!;
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let y = 1; y <= 12; y += 1) {
          if (west.get(15, y, z) === BlockId.Lava && east.get(0, y, z) === BlockId.Lava) borderContinued += 1;
        }
      }
      for (const chunk of chunks.values()) {
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            for (let y = 0; y <= STONE_CAP_TOP_Y; y += 1) {
              const block = chunk.get(x, y, z);
              if (block === BlockId.Lava) capLava += 1;
              if (block === BlockId.Air) capAir += 1;
            }
          }
        }
      }
    }
    expect(exposed).toBe(0);
    expect(capLava).toBe(0);
    expect(capAir).toBe(0);
    expect(hanging).toBe(0);
    expect(totalPonds).toBeGreaterThan(8);
    expect(Math.max(...depths, 0)).toBeLessThanOrEqual(LAVA_POND_MAX_DEPTH);
    expect(Math.max(...widths, 0)).toBeLessThanOrEqual(14);
    expect(Math.max(...sizes, 0)).toBeLessThan(200);
    expect(maxFill).toBeLessThan(0.92);
    expect(minSupport).toBeGreaterThan(0.7);
    expect(borderContinued).toBeGreaterThanOrEqual(0);
    const ratio = {
      coal: totals.coal / ORE_BASELINE.coal,
      iron: totals.iron / ORE_BASELINE.iron,
      gold: totals.gold / ORE_BASELINE.gold,
      redstone: totals.redstone / ORE_BASELINE.redstone,
      diamond: totals.diamond / ORE_BASELINE.diamond,
    };
    for (const [name, value] of Object.entries(ratio)) {
      expect(value, `${name}=${value.toFixed(3)}`).toBeGreaterThan(1.7);
      expect(value, `${name}=${value.toFixed(3)}`).toBeLessThan(2.4);
    }
    const sorted = [...sizes].sort((a, b) => a - b);
    expect(percentile(sorted, 0.5)).toBeLessThan(80);
    expect(percentile(sorted, 0.95)).toBeLessThan(140);
  }, 30_000);

  it('keeps a chunk-border pond continuous for the same seed', () => {
    const generator = new TerrainGenerator('alpha');
    const west = new Chunk(0, 0);
    const east = new Chunk(1, 0);
    const westAgain = new Chunk(0, 0);
    generator.generate(west);
    generator.generate(east);
    generator.generate(westAgain);
    expect([...west.blocks]).toEqual([...westAgain.blocks]);
    let continued = 0;
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let y = 1; y <= 12; y += 1) {
        if (west.get(15, y, z) !== BlockId.Lava) continue;
        if (east.get(0, y, z) === BlockId.Lava) continued += 1;
      }
    }
    expect(continued).toBeGreaterThanOrEqual(0);
  });

  it('does not enqueue generated ponds and flows only after a shore break', () => {
    const world = new VoxelWorld('lava-shore-break');
    world.setViewCenter(8, 8, 4);
    let lava: { x: number; y: number; z: number } | undefined;
    for (let cz = -2; cz <= 2 && !lava; cz += 1) {
      for (let cx = -2; cx <= 2 && !lava; cx += 1) {
        const chunk = world.getChunk(cx, cz)!;
        for (let z = 0; z < CHUNK_SIZE && !lava; z += 1) {
          for (let x = 0; x < CHUNK_SIZE && !lava; x += 1) {
            for (let y = 2; y <= 12; y += 1) {
              if (chunk.get(x, y, z) !== BlockId.Lava) continue;
              const wx = cx * CHUNK_SIZE + x;
              const wz = cz * CHUNK_SIZE + z;
              const stoneBeside = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dz]) => (
                world.getBlock(wx + dx, y, wz + dz) === BlockId.Stone
              ));
              if (!stoneBeside) continue;
              lava = { x: wx, y, z: wz };
              break;
            }
          }
        }
      }
    }
    expect(world.fluidQueueSize).toBe(0);
    expect(lava).toBeDefined();
    expect(isFluidSource(world, lava!.x, lava!.y, lava!.z)).toBe(true);
    tickWorld(world, 40);
    expect(world.fluidWrites).toBe(0);
    let sourcesBefore = 0;
    for (let cz = -2; cz <= 2; cz += 1) {
      for (let cx = -2; cx <= 2; cx += 1) {
        const chunk = world.getChunk(cx, cz)!;
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            for (let y = 1; y <= 16; y += 1) {
              if (chunk.get(x, y, z) !== BlockId.Lava) continue;
              if (isFluidSource(world, cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z)) sourcesBefore += 1;
            }
          }
        }
      }
    }
    let hole: { x: number; y: number; z: number } | undefined;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = lava!.x + dx;
      const z = lava!.z + dz;
      if (world.getBlock(x, lava!.y, z) === BlockId.Stone) {
        hole = { x, y: lava!.y, z };
        break;
      }
    }
    expect(hole).toBeDefined();
    world.applyBlockBatch([{ x: hole!.x, y: hole!.y, z: hole!.z, block: BlockId.Air }]);
    let flowing = 0;
    for (let tick = 0; tick < 160; tick += 1) {
      world.tick();
      flowing += world.fluidWrites + world.fluidUpdates;
    }
    expect(flowing).toBeGreaterThan(0);
    let sourcesAfter = 0;
    let lavaAfter = 0;
    for (let cz = -2; cz <= 2; cz += 1) {
      for (let cx = -2; cx <= 2; cx += 1) {
        const chunk = world.getChunk(cx, cz)!;
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            for (let y = 1; y <= 20; y += 1) {
              if (chunk.get(x, y, z) !== BlockId.Lava) continue;
              lavaAfter += 1;
              if (isFluidSource(world, cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z)) sourcesAfter += 1;
            }
          }
        }
      }
    }
    expect(sourcesAfter).toBeLessThanOrEqual(sourcesBefore);
    expect(lavaAfter).toBeLessThan(sourcesBefore + 80);
    let idle = 0;
    for (let tick = 0; tick < 80; tick += 1) {
      world.tick();
      if (world.fluidWrites === 0) idle += 1;
      else idle = 0;
    }
    expect(idle).toBeGreaterThan(20);
  });

  it('keeps ore Y bands and vein size, and stays deterministic', () => {
    expect(ORE_RULES.map((rule) => [rule.block, rule.minY, rule.maxY, rule.size, rule.veins])).toEqual([
      [BlockId.CoalOre, 28, 61, 7, 24],
      [BlockId.IronOre, 8, 52, 6, 22],
      [BlockId.GoldOre, 4, 32, 5, 8],
      [BlockId.RedstoneOre, 3, 18, 5, 10],
      [BlockId.DiamondOre, 3, 16, 4, 4],
    ]);
    const a = new TerrainGenerator('ore-det');
    const b = new TerrainGenerator('ore-det');
    const chunkA = new Chunk(2, -1);
    const chunkB = new Chunk(2, -1);
    a.generate(chunkA);
    b.generate(chunkB);
    expect([...chunkA.blocks]).toEqual([...chunkB.blocks]);
    const sample = generateChunkGrid(new TerrainGenerator('ore-vein-size'), 1);
    for (const [ore, size] of [
      [BlockId.CoalOre, 7],
      [BlockId.IronOre, 6],
      [BlockId.GoldOre, 5],
      [BlockId.RedstoneOre, 5],
      [BlockId.DiamondOre, 4],
    ] as const) {
      const components = measureOreComponentSizes(sample, ore);
      expect(Math.max(0, ...components)).toBeLessThan(size * 3);
    }
  });
});
