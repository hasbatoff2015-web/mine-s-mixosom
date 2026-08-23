import { BlockId } from '../blocks';
import { CHUNK_SIZE } from '../core/constants';
import { Chunk } from './Chunk';
import { CAVE_ROOF_DEPTH, type TerrainGenerator } from './Generator';

export const WORLDGEN_QA_SEEDS = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo',
  'foxtrot', 'golf', 'hotel', 'india', 'juliet',
] as const;

export const WORLDGEN_PINHOLE_SEEDS = [
  ...WORLDGEN_QA_SEEDS,
  'kilo', 'lima', 'mike', 'november', 'oscar',
  'papa', 'quebec', 'romeo', 'sierra', 'tango',
] as const;

export interface WorldgenRegionStats {
  readonly columns: number;
  readonly minHeight: number;
  readonly avgHeight: number;
  readonly p95Height: number;
  readonly maxHeight: number;
  readonly maxMountain: number;
  readonly elevatedShare: number;
  readonly trees: number;
  readonly cactus: number;
  readonly forestChunks: number;
  readonly desertChunks: number;
  readonly caveAir: number;
  readonly stone: number;
  readonly caveRatio: number;
  readonly caveComponents: number;
  readonly caveAvgSize: number;
  readonly caveP95Size: number;
  readonly caveLargest: number;
  readonly caveMeanWidth: number;
  readonly bedrockBroken: number;
  readonly maxBedrockY: number;
  readonly surfaceHoles: number;
  readonly pinholeOpenings: number;
  readonly tinyOpenings: number;
  readonly thinRoofCells: number;
  readonly hillsideExposures: number;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
}

export function generateChunkGrid(generator: TerrainGenerator, radius: number): Map<string, Chunk> {
  const chunks = new Map<string, Chunk>();
  for (let z = -radius; z <= radius; z += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const chunk = new Chunk(x, z);
      generator.generate(chunk);
      chunks.set(`${x},${z}`, chunk);
    }
  }
  return chunks;
}

function blockAt(chunks: Map<string, Chunk>, x: number, y: number, z: number): number {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const chunk = chunks.get(`${cx},${cz}`);
  if (!chunk) return BlockId.Air;
  const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk.get(lx, y, lz);
}

function surfaceAt(chunks: Map<string, Chunk>, x: number, z: number): number {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const chunk = chunks.get(`${cx},${cz}`);
  if (!chunk) return 0;
  const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk.surfaceHeights[lz * CHUNK_SIZE + lx] ?? 0;
}

export function measureWorldgenRegion(
  generator: TerrainGenerator,
  radius: number,
): WorldgenRegionStats {
  const chunks = generateChunkGrid(generator, radius);
  const heights: number[] = [];
  let trees = 0;
  let cactus = 0;
  let forestChunks = 0;
  let desertChunks = 0;
  let caveAir = 0;
  let stone = 0;
  let bedrockBroken = 0;
  let maxBedrockY = 0;
  let maxMountain = 0;
  let elevated = 0;
  const caveCells: Array<{ x: number; y: number; z: number }> = [];

  for (const chunk of chunks.values()) {
    const center = generator.columnAt(chunk.x * CHUNK_SIZE + 8, chunk.z * CHUNK_SIZE + 8);
    if (center.biome === 'forest') forestChunks += 1;
    if (center.biome === 'desert') desertChunks += 1;
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const x = chunk.x * CHUNK_SIZE + lx;
        const z = chunk.z * CHUNK_SIZE + lz;
        const column = generator.columnAt(x, z);
        const h = chunk.surfaceHeights[lz * CHUNK_SIZE + lx]!;
        heights.push(h);
        maxMountain = Math.max(maxMountain, column.mountain);
        if (column.mountain >= 10) elevated += 1;
        for (let y = 0; y <= h + 6; y += 1) {
          const block = chunk.get(lx, y, lz);
          if (block === BlockId.Bedrock) {
            maxBedrockY = Math.max(maxBedrockY, y);
            if (y > 3) bedrockBroken += 1;
          } else if (y <= generator.bedrockHeight(x, z) && block !== BlockId.Bedrock) {
            bedrockBroken += 1;
          }
          if (block === BlockId.OakLog && y === h + 1 && column.biome === 'forest') trees += 1;
          if (block === BlockId.Cactus && y === h + 1 && column.biome === 'desert') cactus += 1;
          if (block === BlockId.Stone || block === BlockId.CoalOre || block === BlockId.IronOre
            || block === BlockId.GoldOre || block === BlockId.RedstoneOre || block === BlockId.DiamondOre) {
            stone += 1;
          }
          if (block === BlockId.Air && y > 0 && y < h) {
            caveAir += 1;
            caveCells.push({ x, y, z });
          }
        }
      }
    }
  }

  const components = caveComponentSizes(chunks, caveCells);
  const widthSamples = caveWidthSamples(chunks, caveCells);
  heights.sort((a, b) => a - b);
  components.sort((a, b) => a - b);
  const avgHeight = heights.reduce((sum, value) => sum + value, 0) / Math.max(1, heights.length);
  const integrity = measureSurfaceIntegrity(chunks, generator);
  return {
    columns: heights.length,
    minHeight: heights[0] ?? 0,
    avgHeight,
    p95Height: percentile(heights, 0.95),
    maxHeight: heights.at(-1) ?? 0,
    maxMountain,
    elevatedShare: elevated / Math.max(1, heights.length),
    trees,
    cactus,
    forestChunks,
    desertChunks,
    caveAir,
    stone,
    caveRatio: caveAir / Math.max(1, caveAir + stone),
    caveComponents: components.length,
    caveAvgSize: components.reduce((sum, value) => sum + value, 0) / Math.max(1, components.length),
    caveP95Size: percentile(components, 0.95),
    caveLargest: components.at(-1) ?? 0,
    caveMeanWidth: widthSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, widthSamples.length),
    bedrockBroken,
    maxBedrockY,
    surfaceHoles: integrity.surfaceHoles,
    pinholeOpenings: integrity.pinholeOpenings,
    tinyOpenings: integrity.tinyOpenings,
    thinRoofCells: integrity.thinRoofCells,
    hillsideExposures: integrity.hillsideExposures,
  };
}

function caveComponentSizes(
  chunks: Map<string, Chunk>,
  cells: Array<{ x: number; y: number; z: number }>,
): number[] {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const air = new Set(cells.map((cell) => key(cell.x, cell.y, cell.z)));
  const seen = new Set<string>();
  const sizes: number[] = [];
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  for (const cell of cells) {
    const start = key(cell.x, cell.y, cell.z);
    if (seen.has(start)) continue;
    let size = 0;
    const stack = [cell];
    seen.add(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      size += 1;
      for (const [dx, dy, dz] of dirs) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const nz = cur.z + dz;
        const nKey = key(nx, ny, nz);
        if (seen.has(nKey) || !air.has(nKey)) continue;
        seen.add(nKey);
        stack.push({ x: nx, y: ny, z: nz });
      }
    }
    sizes.push(size);
  }
  void chunks;
  return sizes;
}

function caveWidthSamples(
  chunks: Map<string, Chunk>,
  cells: Array<{ x: number; y: number; z: number }>,
): number[] {
  const samples: number[] = [];
  const step = Math.max(1, Math.floor(cells.length / 4000));
  for (let i = 0; i < cells.length; i += step) {
    const cell = cells[i]!;
    let open = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (blockAt(chunks, cell.x + dx, cell.y, cell.z + dz) === BlockId.Air) open += 1;
    }
    samples.push(open);
  }
  return samples;
}

export function maxNeighborHeightDelta(generator: TerrainGenerator, samples = 400): number {
  let max = 0;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 17) % 240 - 120;
    const z = (i * 29) % 240 - 120;
    const h = generator.columnAt(x, z).height;
    max = Math.max(
      max,
      Math.abs(h - generator.columnAt(x + 1, z).height),
      Math.abs(h - generator.columnAt(x, z + 1).height),
    );
  }
  return max;
}

export function surfaceAtWorld(chunks: Map<string, Chunk>, x: number, z: number): number {
  return surfaceAt(chunks, x, z);
}

export interface SurfaceIntegrity {
  readonly surfaceHoles: number;
  readonly pinholeOpenings: number;
  readonly tinyOpenings: number;
  readonly largestOpening: number;
  readonly thinRoofCells: number;
  readonly hillsideExposures: number;
}

const SURFACE_HOLE_BLOCKS = new Set<number>([BlockId.Air, BlockId.Lava, BlockId.Water]);

export function measureSurfaceIntegrity(
  chunks: Map<string, Chunk>,
  generator: TerrainGenerator,
): SurfaceIntegrity {
  const holes = new Set<string>();
  let thinRoofCells = 0;
  let hillsideExposures = 0;
  const holeKey = (x: number, z: number) => `${x},${z}`;

  for (const chunk of chunks.values()) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const x = chunk.x * CHUNK_SIZE + lx;
        const z = chunk.z * CHUNK_SIZE + lz;
        const height = chunk.surfaceHeights[lz * CHUNK_SIZE + lx]!;
        const surface = chunk.get(lx, height, lz);
        if (SURFACE_HOLE_BLOCKS.has(surface)) holes.add(holeKey(x, z));

        let localMin = height;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dz === 0) continue;
            const neighbor = surfaceAt(chunks, x + dx, z + dz);
            if (neighbor > 0) localMin = Math.min(localMin, neighbor);
            if (neighbor > 0 && neighbor < height) {
              const exposedY = neighbor + 1;
              const exposed = chunk.get(lx, exposedY, lz);
              if (exposedY < height && (exposed === BlockId.Air || exposed === BlockId.Lava)) {
                hillsideExposures += 1;
              }
            }
          }
        }
        for (let y = generator.bedrockHeight(x, z) + 1; y < height; y += 1) {
          const block = chunk.get(lx, y, lz);
          if (block !== BlockId.Air && block !== BlockId.Lava) continue;
          if (localMin - y < CAVE_ROOF_DEPTH) thinRoofCells += 1;
        }
      }
    }
  }

  const sizes = openingComponentSizes(holes);
  return {
    surfaceHoles: holes.size,
    pinholeOpenings: sizes.filter((size) => size === 1).length,
    tinyOpenings: sizes.filter((size) => size > 0 && size <= 2).length,
    largestOpening: sizes.length === 0 ? 0 : Math.max(...sizes),
    thinRoofCells,
    hillsideExposures,
  };
}

function openingComponentSizes(holes: Set<string>): number[] {
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const start of holes) {
    if (seen.has(start)) continue;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      size += 1;
      const [sx, sz] = cur.split(',').map(Number) as [number, number];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = `${sx + dx},${sz + dz}`;
        if (seen.has(next) || !holes.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  return sizes;
}
