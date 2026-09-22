import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLDGEN_VERSION, floorDiv, positiveMod } from '../src/core/constants';
import { Chunk } from '../src/world/Chunk';
import { ORE_RULES, TerrainGenerator } from '../src/world/Generator';
import {
  GOURD_PATCH_CELL,
  GOURD_PATCH_DENSITY,
  MELON_DECORATION_SALT,
  PUMPKIN_DECORATION_SALT,
  planGourdPatch,
} from '../src/world/gourdDecorations';
import { hydrologyAt, LAND_MIN_SURFACE, WATER_FLOOR_MIN } from '../src/world/hydrology';
import { VoxelWorld } from '../src/world/World';
import { parseWorldSnapshot } from '../src/save/snapshot';
import { WORLD_SCHEMA_VERSION } from '../src/save/types';
import {
  WorldEventsManager,
  type WorldEventsHost,
} from '../server/services/worldEvents';
import { emptyValidationContext } from '../server/services/spawnValidation';

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'] as const;

function generate(generator: TerrainGenerator, cx: number, cz: number): Chunk {
  const chunk = new Chunk(cx, cz);
  generator.generate(chunk);
  return chunk;
}

function findColumn(
  generator: TerrainGenerator,
  predicate: (column: ReturnType<TerrainGenerator['columnAt']>, x: number, z: number) => boolean,
  span = 2048,
  step = 8,
): { x: number; z: number; column: ReturnType<TerrainGenerator['columnAt']> } {
  for (let z = -span; z < span; z += step) {
    for (let x = -span; x < span; x += step) {
      const column = generator.columnAt(x, z);
      if (predicate(column, x, z)) return { x, z, column };
    }
  }
  throw new Error('sample column not found');
}

function largestComponent(cells: ReadonlySet<string>, step = 8): number {
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
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
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

function oreFingerprint(chunk: Chunk): string {
  const ores = new Set(ORE_RULES.map((rule) => rule.block));
  const cells: string[] = [];
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      for (let y = 0; y <= 61; y += 1) {
        const block = chunk.get(x, y, z);
        if (ores.has(block)) cells.push(`${x},${y},${z}:${block}`);
      }
    }
  }
  return cells.join('|');
}

describe('Worldgen V3 hydrology, gourds and V2 migration', () => {
  it('records WORLDGEN_VERSION 3', () => {
    expect(WORLDGEN_VERSION).toBe(3);
  });

  it('is deterministic for hydrology and columns', () => {
    const a = new TerrainGenerator('hydro-det');
    const b = new TerrainGenerator('hydro-det');
    expect(hydrologyAt(a.numericSeed, 120, -80)).toEqual(hydrologyAt(b.numericSeed, 120, -80));
    expect(a.columnAt(120, -80)).toEqual(b.columnAt(120, -80));
    expect(a.columnAt(12_040, -80).waterBiome).toBe(b.columnAt(12_040, -80).waterBiome);
  });

  it('keeps legacy height when the hydrology mask is zero', () => {
    const generator = new TerrainGenerator('alpha');
    const land = findColumn(generator, (column) => column.waterMask <= 0 && column.mountain < 1);
    expect(land.column.height).toBe(land.column.legacyHeight);
    expect(land.column.height).toBeGreaterThanOrEqual(LAND_MIN_SURFACE);
    expect(land.column.waterBiome).toBe('none');
    expect(land.column.hydrologyRegion).toBe('none');
  });

  it('never reports a dry column as lake or ocean waterBiome', () => {
    const generator = new TerrainGenerator('alpha');
    const dry = findColumn(generator, (column) => column.height >= SEA_LEVEL && column.waterMask <= 0);
    expect(dry.column.waterBiome).toBe('none');
    const wetOcean = findColumn(generator, (column) => column.hydrologyRegion === 'ocean' && column.height < SEA_LEVEL);
    expect(wetOcean.column.waterBiome).toBe('ocean');
    const wetLake = findColumn(generator, (column) => column.hydrologyRegion === 'lake' && column.height < SEA_LEVEL);
    expect(wetLake.column.waterBiome).toBe('lake');
    const coast = findColumn(
      generator,
      (column) => column.hydrologyRegion !== 'none' && column.height >= SEA_LEVEL,
    );
    expect(coast.column.waterBiome).toBe('none');
    let physical = 0;
    let oceanWater = 0;
    let lakeWater = 0;
    let legacyWater = 0;
    for (let z = -512; z < 512; z += 8) {
      for (let x = -512; x < 512; x += 8) {
        const column = generator.columnAt(x, z);
        if (column.height >= SEA_LEVEL) {
          expect(column.waterBiome).toBe('none');
          continue;
        }
        physical += 1;
        if (column.waterBiome === 'ocean') oceanWater += 1;
        else if (column.waterBiome === 'lake') lakeWater += 1;
        else legacyWater += 1;
      }
    }
    expect(oceanWater + lakeWater + legacyWater).toBe(physical);
  });

  it('uses submerged floor materials instead of grass or snow under water', () => {
    const generator = new TerrainGenerator('alpha');
    const plainsLake = findColumn(
      generator,
      (column) => column.biome === 'plains' && column.waterBiome === 'lake' && column.height <= SEA_LEVEL - 3,
    );
    const forestOcean = findColumn(
      generator,
      (column) => column.biome === 'forest' && column.waterBiome === 'ocean' && column.height <= SEA_LEVEL - 3,
    );
    const snowyLake = findColumn(
      generator,
      (column) => column.biome === 'snowy_plains' && column.height <= SEA_LEVEL - 3,
    );
    const checkFloor = (x: number, z: number, forbid: BlockId[]) => {
      const chunk = generate(generator, floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
      const lx = positiveMod(x, CHUNK_SIZE);
      const lz = positiveMod(z, CHUNK_SIZE);
      const height = generator.columnAt(x, z).height;
      const floor = chunk.get(lx, height, lz);
      for (const block of forbid) expect(floor).not.toBe(block);
      return { chunk, lx, lz, height, floor };
    };
    checkFloor(plainsLake.x, plainsLake.z, [BlockId.GrassBlock, BlockId.SnowBlock]);
    checkFloor(forestOcean.x, forestOcean.z, [BlockId.GrassBlock, BlockId.SnowBlock]);
    const snowy = checkFloor(snowyLake.x, snowyLake.z, [BlockId.GrassBlock, BlockId.SnowBlock]);
    expect(snowy.chunk.get(snowy.lx, SEA_LEVEL, snowy.lz)).toBe(BlockId.Ice);
    expect(snowy.chunk.get(snowy.lx, SEA_LEVEL - 1, snowy.lz)).toBe(BlockId.Water);
  });

  it('creates lakes and larger oceans', () => {
    const lakes: number[] = [];
    const oceans: number[] = [];
    let water = 0;
    let columns = 0;
    for (const seed of SEEDS) {
      const generator = new TerrainGenerator(seed);
      const oceanCells = new Set<string>();
      const lakeCells = new Set<string>();
      for (let z = -1024; z < 1024; z += 8) {
        for (let x = -1024; x < 1024; x += 8) {
          const column = generator.columnAt(x, z);
          columns += 1;
          if (column.height < SEA_LEVEL) water += 1;
          if (column.waterBiome === 'ocean') oceanCells.add(`${x},${z}`);
          if (column.waterBiome === 'lake') lakeCells.add(`${x},${z}`);
        }
      }
      oceans.push(largestComponent(oceanCells));
      lakes.push(largestComponent(lakeCells));
    }
    const waterShare = water / columns;
    expect(waterShare).toBeGreaterThan(0.08);
    expect(waterShare).toBeLessThan(0.28);
    expect(Math.max(...oceans)).toBeGreaterThan(Math.max(...lakes));
    expect(Math.max(...oceans)).toBeGreaterThan(400);
    expect(Math.max(...lakes)).toBeGreaterThan(40);
    const lake = findColumn(new TerrainGenerator('alpha'), (column) => column.waterBiome === 'lake' && column.height < SEA_LEVEL);
    const ocean = findColumn(new TerrainGenerator('alpha'), (column) => column.waterBiome === 'ocean' && column.height < SEA_LEVEL - 3);
    expect(lake.column.height).toBeGreaterThanOrEqual(WATER_FLOOR_MIN);
    expect(ocean.column.height).toBeGreaterThanOrEqual(WATER_FLOOR_MIN);
    expect(SEA_LEVEL - ocean.column.height).toBeGreaterThan(SEA_LEVEL - lake.column.height - 2);
  });

  it('does not cliff at hydrology shores', () => {
    const generator = new TerrainGenerator('alpha');
    const ocean = findColumn(generator, (column) => column.waterBiome === 'ocean');
    let maxStep = 0;
    for (let x = ocean.x - 80; x < ocean.x + 80; x += 1) {
      const a = generator.columnAt(x, ocean.z);
      const b = generator.columnAt(x + 1, ocean.z);
      maxStep = Math.max(maxStep, Math.abs(a.height - b.height));
    }
    expect(maxStep).toBeLessThanOrEqual(4);
  });

  it('freezes only exposed snowy water', () => {
    const generator = new TerrainGenerator('alpha');
    const water = findColumn(
      generator,
      (column) => column.biome === 'snowy_plains' && column.height <= SEA_LEVEL - 2,
    );
    const chunk = generate(generator, floorDiv(water.x, CHUNK_SIZE), floorDiv(water.z, CHUNK_SIZE));
    const lx = positiveMod(water.x, CHUNK_SIZE);
    const lz = positiveMod(water.z, CHUNK_SIZE);
    expect(chunk.get(lx, SEA_LEVEL, lz)).toBe(BlockId.Ice);
    expect(chunk.get(lx, SEA_LEVEL - 1, lz)).toBe(BlockId.Water);
  });

  it('does not open cave mouths into hydrology water', () => {
    const generator = new TerrainGenerator('alpha');
    const ocean = findColumn(generator, (column) => column.waterBiome === 'ocean' && column.height <= SEA_LEVEL - 4);
    const chunk = generate(generator, floorDiv(ocean.x, CHUNK_SIZE), floorDiv(ocean.z, CHUNK_SIZE));
    const lx = positiveMod(ocean.x, CHUNK_SIZE);
    const lz = positiveMod(ocean.z, CHUNK_SIZE);
    expect(chunk.get(lx, ocean.column.height, lz)).not.toBe(BlockId.Air);
    for (let y = ocean.column.height + 1; y <= SEA_LEVEL; y += 1) {
      const block = chunk.get(lx, y, lz);
      expect([BlockId.Water, BlockId.Ice]).toContain(block);
    }
    expect(generator.isCave(ocean.x, ocean.column.height, ocean.z, ocean.column.height)).toBe(false);
  });

  it('keeps ore rule table and dry-land ore RNG identical across generators', () => {
    expect(ORE_RULES.map((rule) => rule.block)).toEqual([
      BlockId.CoalOre, BlockId.IronOre, BlockId.GoldOre, BlockId.RedstoneOre, BlockId.DiamondOre, BlockId.TitaniumOre,
    ]);
    const generator = new TerrainGenerator('alpha');
    const dry = findColumn(generator, (column, x, z) => {
      if (column.waterMask > 0) return false;
      const cx = floorDiv(x, CHUNK_SIZE);
      const cz = floorDiv(z, CHUNK_SIZE);
      for (let dz = 0; dz < CHUNK_SIZE; dz += 4) {
        for (let dx = 0; dx < CHUNK_SIZE; dx += 4) {
          if (generator.columnAt(cx * CHUNK_SIZE + dx, cz * CHUNK_SIZE + dz).waterMask > 0) return false;
        }
      }
      return true;
    });
    const cx = floorDiv(dry.x, CHUNK_SIZE);
    const cz = floorDiv(dry.z, CHUNK_SIZE);
    const a = generate(new TerrainGenerator('alpha'), cx, cz);
    const b = generate(new TerrainGenerator('alpha'), cx, cz);
    expect(oreFingerprint(a)).toBe(oreFingerprint(b));
    expect(oreFingerprint(a).length).toBeGreaterThan(0);
  });

  it('matches staged and monolithic generation including water and gourds', () => {
    const generator = new TerrainGenerator('v3-stage');
    const probe = findColumn(generator, (column) => column.waterBiome !== 'none' || column.biome === 'plains');
    const cx = floorDiv(probe.x, CHUNK_SIZE);
    const cz = floorDiv(probe.z, CHUNK_SIZE);
    const full = generate(generator, cx, cz);
    const staged = new Chunk(cx, cz);
    const job = generator.beginGenerate(staged);
    let slices = 0;
    while (!generator.advanceGenerate(job, 16)) {
      slices += 1;
      expect(slices).toBeLessThan(80);
    }
    expect([...staged.blocks]).toEqual([...full.blocks]);
  });

  it('is independent of chunk generation order along a shoreline', () => {
    const seed = 'v3-order';
    const generator = new TerrainGenerator(seed);
    const ocean = findColumn(generator, (column) => column.waterBiome === 'ocean');
    const cx = floorDiv(ocean.x, CHUNK_SIZE);
    const cz = floorDiv(ocean.z, CHUNK_SIZE);
    const ab = new TerrainGenerator(seed);
    const ba = new TerrainGenerator(seed);
    const a1 = generate(ab, cx, cz);
    const b1 = generate(ab, cx + 1, cz);
    const b2 = generate(ba, cx + 1, cz);
    const a2 = generate(ba, cx, cz);
    expect([...a1.blocks]).toEqual([...a2.blocks]);
    expect([...b1.blocks]).toEqual([...b2.blocks]);
  });

  it('does not shift tree/plant RNG when gourd decorations are added', () => {
    const generator = new TerrainGenerator('alpha');
    const untilGourds = new Chunk(0, 0);
    const job = generator.beginGenerate(untilGourds);
    let slices = 0;
    while (job.phase !== 'gourds') {
      const done = generator.advanceGenerate(job, 256);
      slices += 1;
      expect(slices).toBeLessThan(80);
      if (done) break;
    }
    const dry = [...Array(CHUNK_SIZE * CHUNK_SIZE).keys()].every((index) => {
      const x = index % CHUNK_SIZE;
      const z = Math.floor(index / CHUNK_SIZE);
      return generator.columnAt(x, z).waterMask <= 0;
    });
    expect(dry).toBe(true);
    const treesBefore = (chunk: Chunk): Array<[number, number, number]> => {
      const trees: Array<[number, number, number]> = [];
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const height = generator.columnAt(x, z).height;
          const root = chunk.get(x, height + 1, z);
          if (root === BlockId.OakLog || root === BlockId.BirchLog || root === BlockId.SpruceLog) {
            trees.push([x, z, root]);
          }
        }
      }
      return trees;
    };
    const before = treesBefore(untilGourds);
    expect(before.length).toBeGreaterThan(0);
    const full = generate(new TerrainGenerator('alpha'), 0, 0);
    expect(treesBefore(full)).toEqual(before);
    expect(PUMPKIN_DECORATION_SALT).not.toBe(MELON_DECORATION_SALT);
  });

  it('places wild pumpkins and melons above water on allowed biomes', () => {
    const counts = {
      pumpkin: { plains: 0, forest: 0, desert: 0, snowy_plains: 0, underwater: 0, total: 0 },
      melon: { plains: 0, forest: 0, desert: 0, snowy_plains: 0, underwater: 0, total: 0 },
    };
    for (const seed of SEEDS.slice(0, 4)) {
      const generator = new TerrainGenerator(seed);
      const planned: Array<{ kind: 'pumpkin' | 'melon'; cx: number; cz: number }> = [];
      for (let cellZ = -20; cellZ <= 20 && planned.length < 24; cellZ += 1) {
        for (let cellX = -20; cellX <= 20 && planned.length < 24; cellX += 1) {
          const pumpkin = planGourdPatch(generator, PUMPKIN_DECORATION_SALT, 'pumpkin', cellX, cellZ);
          const melon = planGourdPatch(generator, MELON_DECORATION_SALT, 'melon', cellX, cellZ);
          if (pumpkin) planned.push({ kind: 'pumpkin', cx: floorDiv(pumpkin.cx, CHUNK_SIZE), cz: floorDiv(pumpkin.cz, CHUNK_SIZE) });
          if (melon) planned.push({ kind: 'melon', cx: floorDiv(melon.cx, CHUNK_SIZE), cz: floorDiv(melon.cz, CHUNK_SIZE) });
        }
      }
      expect(planned.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const patch of planned) {
        const key = `${patch.cx},${patch.cz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const chunk = generate(generator, patch.cx, patch.cz);
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            const wx = patch.cx * CHUNK_SIZE + x;
            const wz = patch.cz * CHUNK_SIZE + z;
            const column = generator.columnAt(wx, wz);
            const fruit = chunk.get(x, column.height + 1, z);
            if (fruit !== BlockId.Pumpkin && fruit !== BlockId.Melon) continue;
            const kind = fruit === BlockId.Pumpkin ? 'pumpkin' : 'melon';
            counts[kind].total += 1;
            counts[kind][column.biome] += 1;
            if (column.height < SEA_LEVEL || column.waterBiome !== 'none') counts[kind].underwater += 1;
            expect(chunk.get(x, column.height + 1, z)).not.toBe(BlockId.PumpkinStem);
          }
        }
      }
    }
    expect(counts.pumpkin.total).toBeGreaterThan(0);
    expect(counts.melon.total).toBeGreaterThan(0);
    expect(counts.pumpkin.desert).toBe(0);
    expect(counts.pumpkin.snowy_plains).toBe(0);
    expect(counts.melon.desert).toBe(0);
    expect(counts.melon.snowy_plains).toBe(0);
    expect(counts.pumpkin.underwater).toBe(0);
    expect(counts.melon.underwater).toBe(0);
    expect(counts.pumpkin.plains + counts.pumpkin.forest).toBe(counts.pumpkin.total);
    expect(counts.melon.forest).toBeGreaterThan(0);
  });

  it('places gourd patches independently of chunk order', () => {
    const seed = 'gourd-order';
    const generator = new TerrainGenerator(seed);
    let found: { cx: number; cz: number } | undefined;
    for (let cellZ = -24; cellZ <= 24 && !found; cellZ += 1) {
      for (let cellX = -24; cellX <= 24 && !found; cellX += 1) {
        const pumpkin = planGourdPatch(generator, PUMPKIN_DECORATION_SALT, 'pumpkin', cellX, cellZ);
        const melon = planGourdPatch(generator, MELON_DECORATION_SALT, 'melon', cellX, cellZ);
        const patch = pumpkin ?? melon;
        if (!patch) continue;
        found = { cx: floorDiv(patch.cx, CHUNK_SIZE), cz: floorDiv(patch.cz, CHUNK_SIZE) };
      }
    }
    expect(found).toBeDefined();
    const cx = found!.cx;
    const cz = found!.cz;
    const ab = new TerrainGenerator(seed);
    const ba = new TerrainGenerator(seed);
    const first = generate(ab, cx, cz);
    generate(ab, cx + 1, cz);
    generate(ba, cx + 1, cz);
    const second = generate(ba, cx, cz);
    expect([...first.blocks]).toEqual([...second.blocks]);
    expect(GOURD_PATCH_CELL).toBe(32);
  });

  it('accepts a 0.25 subset of unscaled gourd patches without moving survivors', { timeout: 30_000 }, () => {
    expect(GOURD_PATCH_DENSITY).toBe(0.25);
    expect(GOURD_PATCH_CELL).toBe(32);
    expect(PUMPKIN_DECORATION_SALT).toBe(81427);
    expect(MELON_DECORATION_SALT).toBe(91541);
    const counts = {
      pumpkin: { unscaled: 0, scaled: 0 },
      melon: { unscaled: 0, scaled: 0 },
    };
    for (const seed of SEEDS) {
      const generator = new TerrainGenerator(seed);
      for (let cellZ = -32; cellZ < 32; cellZ += 1) {
        for (let cellX = -32; cellX < 32; cellX += 1) {
          for (const [kind, salt] of [
            ['pumpkin', PUMPKIN_DECORATION_SALT],
            ['melon', MELON_DECORATION_SALT],
          ] as const) {
            const unscaled = planGourdPatch(generator, salt, kind, cellX, cellZ, 1);
            const scaled = planGourdPatch(generator, salt, kind, cellX, cellZ);
            if (unscaled) counts[kind].unscaled += 1;
            if (scaled) {
              counts[kind].scaled += 1;
              expect(unscaled).toEqual(scaled);
            }
          }
        }
      }
    }
    expect(counts.pumpkin.unscaled).toBeGreaterThan(100);
    expect(counts.melon.unscaled).toBeGreaterThan(40);
    const pumpkinRatio = counts.pumpkin.scaled / counts.pumpkin.unscaled;
    const melonRatio = counts.melon.scaled / counts.melon.unscaled;
    expect(pumpkinRatio).toBeGreaterThanOrEqual(0.20);
    expect(pumpkinRatio).toBeLessThanOrEqual(0.30);
    expect(melonRatio).toBeGreaterThanOrEqual(0.20);
    expect(melonRatio).toBeLessThanOrEqual(0.30);
  });

  it('migrates a V2 snapshot onto V3 terrain while keeping modifications', () => {
    const seed = 'migrate-v2';
    const generator = new TerrainGenerator(seed);
    const column = generator.columnAt(8, 8);
    const world = new VoxelWorld(seed);
    world.restore({
      timeOfDay: 1000,
      modifications: { '0,0': { [Chunk.index(4, column.height, 7)]: BlockId.GoldBlock } },
      chests: {},
      furnaces: {},
    });
    expect(world.getBlock(4, column.height, 7)).toBe(BlockId.GoldBlock);
    expect(world.generator.columnAt(8, 8).height).toBe(column.height);
    const natural = world.getBlock(8, column.height, 8, false);
    expect(natural).not.toBe(BlockId.Air);
    const snapshot = parseWorldSnapshot({
      schemaVersion: WORLD_SCHEMA_VERSION,
      worldgenVersion: 2,
      summary: {
        id: 'migrate',
        name: 'migrate',
        seed,
        mode: 'survival',
        createdAt: 1,
        updatedAt: 1,
        playTimeSeconds: 0,
      },
      timeOfDay: 1000,
      weather: 'clear',
      player: {
        position: [8.5, 70, 8.5],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        health: 20,
        hunger: 20,
        saturation: 5,
        selectedSlot: 0,
        inventory: { hotbar: [], main: [], armor: {} },
      },
      modifications: { '0,0': { [String(Chunk.index(4, column.height, 7))]: BlockId.GoldBlock } },
      chests: {},
      furnaces: {},
      droppedItems: [],
    });
    expect(snapshot.worldgenVersion).toBe(2);
    expect(WORLDGEN_VERSION).toBe(3);
    const next = parseWorldSnapshot({ ...snapshot, worldgenVersion: WORLDGEN_VERSION });
    expect(next.worldgenVersion).toBe(3);
    expect(next.modifications).toEqual(snapshot.modifications);
    expect(world.serializeModifications()['0,0']?.[String(Chunk.index(4, column.height, 7))]).toBe(BlockId.GoldBlock);
  });

  it('keeps hydrology continuous past the playable plane', () => {
    const a = new TerrainGenerator('alpha');
    const b = new TerrainGenerator('alpha');
    expect(a.columnAt(10_016, 48)).toEqual(b.columnAt(10_016, 48));
    expect(a.columnAt(10_016, 48).height).toBeGreaterThanOrEqual(WATER_FLOOR_MIN);
    const chunk = generate(a, 626, 3);
    expect(chunk.generated).toBe(true);
  });

  it('rebases an active V2 event snapshot onto current V3 terrain', () => {
    const world = new VoxelWorld('event-migrate');
    const x = 32;
    const z = 32;
    const y = world.surfaceY(x, z);
    const fakeV2: Array<{ x: number; y: number; z: number; blockId: number }> = [
      { x, y, z, blockId: BlockId.GoldBlock },
    ];
    let saved: unknown = {
      templates: [],
      active: {
        type: 'resource_chest',
        id: 'chest-old',
        phase: 'spawned_locked',
        worldId: 'anarchy',
        templateName: 'chest_shrine',
        rotation: 0,
        chest: { x, y: y + 1, z },
        volume: { minX: x, maxX: x, minY: y, maxY: y + 2, minZ: z, maxZ: z },
        chestLocked: true,
        spawnAt: 1,
        warningAt: 1,
        unlockAt: 50_000,
        cleanupAt: 80_000,
        snapshot: fakeV2,
      },
    };
    const logs: string[] = [];
    const host: WorldEventsHost = {
      world,
      worldId: () => 'anarchy',
      now: () => 10,
      random: () => 0.5,
      spawn: () => [0, 64, 0],
      loadStore: () => saved,
      saveStore: (store) => { saved = store; },
      createValidationContext: () => emptyValidationContext(),
      homes: () => [],
      players: () => [],
      flush: () => undefined,
      markDirty: () => undefined,
      closeChestWindow: () => undefined,
      broadcast: () => undefined,
      send: () => undefined,
      log: (message) => logs.push(message),
      loadedWorldgenVersion: () => 2,
    };
    const manager = new WorldEventsManager(host);
    manager.load();
    const store = saved as { active?: { snapshot?: Array<{ blockId: number }> } };
    expect(store.active?.snapshot?.some((cell) => cell.blockId === BlockId.GoldBlock)).toBe(false);
    expect(logs.some((line) => line.includes('Worldgen V3'))).toBe(true);
  });
});
