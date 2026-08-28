import { BlockId } from '../blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/constants';
import { Chunk } from './Chunk';
import { CAVE_ROOF_DEPTH, stoneCapY, type TerrainGenerator } from './Generator';

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

export interface LavaPondRecord {
  readonly cells: number;
  readonly width: number;
  readonly length: number;
  readonly depth: number;
  readonly minY: number;
  readonly maxY: number;
  readonly support: number;
  readonly hanging: number;
  readonly bboxArea: number;
  readonly fillRatio: number;
}

export interface LavaPondStats {
  readonly ponds: readonly LavaPondRecord[];
  readonly count: number;
  readonly sourceCells: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly widthP95: number;
  readonly widthMax: number;
  readonly depthP50: number;
  readonly depthMax: number;
  readonly maxFillRatioLarge: number;
  readonly hangingCells: number;
}

export interface OreCounts {
  readonly coal: number;
  readonly iron: number;
  readonly gold: number;
  readonly redstone: number;
  readonly diamond: number;
}

function pct(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
}

export function measureLavaPonds(chunks: Map<string, Chunk>): LavaPondStats {
  const seen = new Set<string>();
  const ponds: LavaPondRecord[] = [];
  for (const chunk of chunks.values()) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        for (let y = 0; y <= chunk.scanMaxY(); y += 1) {
          if (chunk.get(x, y, z) !== BlockId.Lava) continue;
          const startX = chunk.x * CHUNK_SIZE + x;
          const startZ = chunk.z * CHUNK_SIZE + z;
          const key = `${startX},${y},${startZ}`;
          if (seen.has(key)) continue;
          ponds.push(floodLavaPond(chunks, startX, y, startZ, seen));
        }
      }
    }
  }
  const sizes = ponds.map((pond) => pond.cells).sort((a, b) => a - b);
  const widths = ponds.map((pond) => Math.max(pond.width, pond.length)).sort((a, b) => a - b);
  const depths = ponds.map((pond) => pond.depth).sort((a, b) => a - b);
  let maxFillRatioLarge = 0;
  let hangingCells = 0;
  for (const pond of ponds) {
    hangingCells += pond.hanging;
    if (Math.max(pond.width, pond.length) < 10) continue;
    maxFillRatioLarge = Math.max(maxFillRatioLarge, pond.fillRatio);
  }
  return {
    ponds,
    count: ponds.length,
    sourceCells: ponds.reduce((sum, pond) => sum + pond.cells, 0),
    p50: pct(sizes, 0.5),
    p95: pct(sizes, 0.95),
    max: sizes.at(-1) ?? 0,
    widthP95: pct(widths, 0.95),
    widthMax: widths.at(-1) ?? 0,
    depthP50: pct(depths, 0.5),
    depthMax: depths.at(-1) ?? 0,
    maxFillRatioLarge,
    hangingCells,
  };
}

function floodLavaPond(
  chunks: Map<string, Chunk>,
  x: number,
  y: number,
  z: number,
  seen: Set<string>,
): LavaPondRecord {
  const stack: Array<[number, number, number]> = [[x, y, z]];
  seen.add(`${x},${y},${z}`);
  let cells = 0;
  let supported = 0;
  let floorCells = 0;
  let hanging = 0;
  let minx = x;
  let maxx = x;
  let minz = z;
  let maxz = z;
  let miny = y;
  let maxy = y;
  while (stack.length > 0) {
    const [cx, cy, cz] = stack.pop()!;
    cells += 1;
    minx = Math.min(minx, cx);
    maxx = Math.max(maxx, cx);
    minz = Math.min(minz, cz);
    maxz = Math.max(maxz, cz);
    miny = Math.min(miny, cy);
    maxy = Math.max(maxy, cy);
    const below = blockAt(chunks, cx, cy - 1, cz);
    if (below !== BlockId.Lava) {
      floorCells += 1;
      if (isSolidSupport(below)) supported += 1;
      else if (below === BlockId.Air) hanging += 1;
    }
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      const key = `${nx},${ny},${nz}`;
      if (seen.has(key) || blockAt(chunks, nx, ny, nz) !== BlockId.Lava) continue;
      seen.add(key);
      stack.push([nx, ny, nz]);
    }
  }
  const width = maxx - minx + 1;
  const length = maxz - minz + 1;
  const bboxArea = width * length;
  return {
    cells,
    width,
    length,
    depth: maxy - miny + 1,
    minY: miny,
    maxY: maxy,
    support: supported / Math.max(1, floorCells),
    hanging,
    bboxArea,
    fillRatio: cells / Math.max(1, bboxArea),
  };
}

export function measureOreComponentSizes(chunks: Map<string, Chunk>, ore: number): number[] {
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const chunk of chunks.values()) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        for (let y = 0; y <= chunk.scanMaxY(); y += 1) {
          if (chunk.get(x, y, z) !== ore) continue;
          const sx = chunk.x * CHUNK_SIZE + x;
          const sz = chunk.z * CHUNK_SIZE + z;
          const key = `${sx},${y},${sz}`;
          if (seen.has(key)) continue;
          let cells = 0;
          const stack: Array<[number, number, number]> = [[sx, y, sz]];
          seen.add(key);
          while (stack.length > 0) {
            const [cx, cy, cz] = stack.pop()!;
            cells += 1;
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
              const nx = cx + dx;
              const ny = cy + dy;
              const nz = cz + dz;
              const next = `${nx},${ny},${nz}`;
              if (seen.has(next) || blockAt(chunks, nx, ny, nz) !== ore) continue;
              seen.add(next);
              stack.push([nx, ny, nz]);
            }
          }
          sizes.push(cells);
        }
      }
    }
  }
  return sizes;
}

function isSolidSupport(block: number): boolean {
  return block !== BlockId.Air && block !== BlockId.Water && block !== BlockId.Lava;
}

function chunkExists(chunks: Map<string, Chunk>, x: number, z: number): boolean {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  return chunks.has(`${cx},${cz}`);
}

export interface LavaContainmentStats {
  readonly lavaCells: number;
  readonly exposedCells: number;
  readonly unsupportedCells: number;
  readonly hangingCells: number;
}

/**
 * Voxel containment for generated lava. Neighbors outside the sampled grid
 * are ignored (unknown), matching runtime fluid activation.
 */
export function measureLavaContainment(chunks: Map<string, Chunk>): LavaContainmentStats {
  const hangingCells = measureLavaPonds(chunks).hangingCells;
  let lavaCells = 0;
  let exposedCells = 0;
  let unsupportedCells = 0;
  for (const chunk of chunks.values()) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        for (let y = 0; y <= chunk.scanMaxY(); y += 1) {
          if (chunk.get(x, y, z) !== BlockId.Lava) continue;
          lavaCells += 1;
          const wx = chunk.x * CHUNK_SIZE + x;
          const wz = chunk.z * CHUNK_SIZE + z;
          const below = blockAt(chunks, wx, y - 1, wz);
          if (below === BlockId.Air || below === BlockId.Water) unsupportedCells += 1;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = wx + dx;
            const nz = wz + dz;
            if (!chunkExists(chunks, nx, nz)) continue;
            const neighbor = blockAt(chunks, nx, y, nz);
            if (neighbor === BlockId.Air || neighbor === BlockId.Water || neighbor === BlockId.Fire) {
              exposedCells += 1;
              break;
            }
          }
        }
      }
    }
  }
  return { lavaCells, exposedCells, unsupportedCells, hangingCells };
}

export function countExposedBedrock(chunks: Map<string, Chunk>, generator: TerrainGenerator): number {
  let exposed = 0;
  for (const chunk of chunks.values()) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const wx = chunk.x * CHUNK_SIZE + x;
        const wz = chunk.z * CHUNK_SIZE + z;
        const cap = stoneCapY(generator.bedrockHeight(wx, wz));
        for (let y = 0; y <= cap; y += 1) {
          const block = chunk.get(x, y, z);
          if (block === BlockId.Air || block === BlockId.Lava) exposed += 1;
        }
        for (let y = 0; y <= chunk.scanMaxY(); y += 1) {
          if (chunk.get(x, y, z) !== BlockId.Bedrock) continue;
          for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const) {
            const nx = wx + dx;
            const ny = y + dy;
            const nz = wz + dz;
            if (ny < 0 || ny >= WORLD_HEIGHT) continue;
            const neighbor = chunks.get(`${Math.floor(nx / CHUNK_SIZE)},${Math.floor(nz / CHUNK_SIZE)}`);
            if (!neighbor) continue;
            const lx = ((nx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const lz = ((nz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const next = neighbor.get(lx, ny, lz);
            if (next === BlockId.Air || next === BlockId.Lava) exposed += 1;
          }
        }
      }
    }
  }
  return exposed;
}

export function measureOreCounts(chunks: Map<string, Chunk>): OreCounts {
  const counts = { coal: 0, iron: 0, gold: 0, redstone: 0, diamond: 0 };
  for (const chunk of chunks.values()) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        for (let y = 0; y <= chunk.scanMaxY(); y += 1) {
          const block = chunk.get(x, y, z);
          if (block === BlockId.CoalOre) counts.coal += 1;
          else if (block === BlockId.IronOre) counts.iron += 1;
          else if (block === BlockId.GoldOre) counts.gold += 1;
          else if (block === BlockId.RedstoneOre) counts.redstone += 1;
          else if (block === BlockId.DiamondOre) counts.diamond += 1;
        }
      }
    }
  }
  return counts;
}
