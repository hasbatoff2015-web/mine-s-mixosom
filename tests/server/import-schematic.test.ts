import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId } from '../../src/blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y, WORLD_HEIGHT } from '../../src/core/constants';
import { PersistenceError } from '../../src/save/PersistenceError';
import { FsWorldStore } from '../../server/FsWorldStore';
import { importAnarchySchematic } from '../../server/importSchematic';
import { isSchematicFilename, resolveExistingPath } from '../../server/schematicPaths';
import { WorldInstance } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';
import {
  ANARCHY_SPAWN_Y_SHIFT,
  ANARCHY_WORLD_ID,
  ANARCHY_WORLD_SEED,
  encodeSpongeSchematicGzip,
  resolveAnarchyStartup,
  schematicIndex,
} from '../../src/world/import';
import { sampleSnapshot } from '../persistFixture';

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-schem-import-'));
  dirs.push(dir);
  return dir;
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: ANARCHY_WORLD_ID,
      WORLD_SEED: ANARCHY_WORLD_SEED,
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
  };
}

async function fixtureBytes(): Promise<Uint8Array> {
  const width = 3;
  const height = 2;
  const length = 3;
  const palette = [
    'minecraft:air',
    'minecraft:stone',
    'minecraft:glowstone',
    'minecraft:jungle_wood',
    'minecraft:cocoa[age=2,facing=north]',
  ];
  const blocks = new Uint16Array(width * height * length);
  blocks[schematicIndex(1, 0, 1, width, length)] = 1;
  blocks[schematicIndex(1, 1, 1, width, length)] = 2;
  blocks[schematicIndex(0, 0, 1, width, length)] = 3;
  blocks[schematicIndex(2, 0, 1, width, length)] = 4;
  return encodeSpongeSchematicGzip({ width, height, length, palette, blocks });
}

describe('Anarchy schematic filesystem import', () => {
  it('detects schematic filenames', () => {
    expect(isSchematicFilename('frontier_spawn2.schem')).toBe(true);
    expect(isSchematicFilename('C:\\Users\\миша\\Desktop\\GAMES\\mine123\\spawn_map\\frontier_spawn2.schem')).toBe(true);
    expect(isSchematicFilename('anarchy-idb.json')).toBe(false);
  });

  it('refuses to overwrite an existing world without --force', async () => {
    const dataDir = await tempDir();
    const store = new FsWorldStore(dataDir);
    await store.save(sampleSnapshot({
      summary: {
        id: ANARCHY_WORLD_ID,
        name: 'Анархия',
        seed: ANARCHY_WORLD_SEED,
        mode: 'survival',
        kind: 'server',
        createdAt: 1,
        updatedAt: 1,
        playTimeSeconds: 0,
      },
    }));
    await expect(importAnarchySchematic({
      store,
      worldId: ANARCHY_WORLD_ID,
      seed: ANARCHY_WORLD_SEED,
      bytes: await fixtureBytes(),
    })).rejects.toMatchObject({ code: 'exists' });
  });

  it('bakes a schematic with ANARCHY_SPAWN_Y_SHIFT into FsWorldStore and preserves players', async () => {
    const dataDir = await tempDir();
    const store = new FsWorldStore(dataDir);
    const previous = sampleSnapshot({
      summary: {
        id: ANARCHY_WORLD_ID,
        name: 'Анархия',
        seed: ANARCHY_WORLD_SEED,
        mode: 'survival',
        kind: 'server',
        createdAt: 11,
        updatedAt: 11,
        playTimeSeconds: 0,
      },
      players: {
        keeper: {
          id: 'keeper',
          name: 'Keeper',
          x: 1,
          y: 70,
          z: 1,
          yaw: 0,
          pitch: 0,
          health: 20,
          gamemode: 'survival',
          selectedSlot: 0,
          inventory: { slots: [], offhand: null },
          updatedAt: 11,
        },
      },
    });
    await store.save(previous);

    const result = await importAnarchySchematic({
      store,
      worldId: ANARCHY_WORLD_ID,
      seed: ANARCHY_WORLD_SEED,
      bytes: await fixtureBytes(),
      force: true,
      worldDir: store.directoryFor(ANARCHY_WORLD_ID),
      preservePlayers: true,
    });

    expect(result.inspect.version).toBe(2);
    expect(result.inspect.width).toBe(3);
    expect(result.inspect.height).toBe(2);
    expect(result.inspect.length).toBe(3);
    expect(result.inspect.gzip).toBe(true);
    expect(result.report.yShift).toBe(ANARCHY_SPAWN_Y_SHIFT);
    expect(ANARCHY_SPAWN_Y_SHIFT).toBe(-28);
    expect(result.report.lowestImportedY).toBeGreaterThanOrEqual(MIN_WORLD_Y);
    expect(result.report.highestImportedY).toBeLessThanOrEqual(MAX_WORLD_Y);
    expect(WORLD_HEIGHT).toBe(256);
    expect(result.snapshot.summary.id).toBe(ANARCHY_WORLD_ID);
    expect(result.snapshot.summary.seed).toBe(ANARCHY_WORLD_SEED);
    expect(result.snapshot.summary.createdAt).toBe(11);
    expect(result.snapshot.players?.keeper?.name).toBe('Keeper');
    expect(result.backupPath).toBeTruthy();
    expect(result.modifiedCells).toBeGreaterThan(0);
    expect(result.snapshot.serverWorld?.spawn).toEqual(result.spawn);
    expect(BlockId.Farmland).toBe(150);
    expect(BlockId.PotatoCrop).toBe(153);

    const loaded = await store.load(ANARCHY_WORLD_ID);
    expect(loaded?.modifications).toEqual(result.snapshot.modifications);
    expect(resolveAnarchyStartup(loaded ?? undefined).action).toBe('restore');
  });

  it('WorldInstance restore uses the imported snapshot and does not fetch .schem', async () => {
    const dataDir = await tempDir();
    const store = new FsWorldStore(dataDir);
    const imported = await importAnarchySchematic({
      store,
      worldId: ANARCHY_WORLD_ID,
      seed: ANARCHY_WORLD_SEED,
      bytes: await fixtureBytes(),
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('schematic must not load at startup'));

    const first = new WorldInstance(testConfig(dataDir));
    await first.initialize();
    expect(first.worldId).toBe(ANARCHY_WORLD_ID);
    expect(first.seed).toBe(ANARCHY_WORLD_SEED);
    expect(first.spawn).toEqual(imported.spawn);
    const y = imported.report.lowestImportedY;
    expect(first.world.getBlock(1, y, 1)).toBe(BlockId.Stone);
    expect(first.world.getBlock(1, y + 1, 1)).toBe(BlockId.Glowstone);
    expect(first.world.getBlock(0, y, 1)).toBe(BlockId.OakLog);
    expect(first.world.getBlock(2, y, 1)).toBe(BlockId.Air);
    first.world.setBlock(4, y, 4, BlockId.Farmland);
    first.world.setBlockState(4, y, 4, { hydrated: true });
    first.world.setBlock(4, y + 1, 4, BlockId.PotatoCrop);
    first.world.setBlockState(4, y + 1, 4, { age: 6 });
    await first.save();
    await first.stop();

    const second = new WorldInstance(testConfig(dataDir));
    await second.initialize();
    expect(second.spawn).toEqual(imported.spawn);
    expect(second.world.getBlock(1, y, 1)).toBe(BlockId.Stone);
    expect(second.world.getBlock(4, y, 4)).toBe(BlockId.Farmland);
    expect(second.world.getBlockState(4, y, 4)).toEqual({ hydrated: true });
    expect(second.world.getBlock(4, y + 1, 4)).toBe(BlockId.PotatoCrop);
    expect(second.world.getBlockState(4, y + 1, 4)).toEqual({ age: 6 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await second.stop();
  });

  it('lists missing schematic paths instead of inventing a file', async () => {
    await expect(resolveExistingPath('/definitely/missing/frontier_spawn2.schem')).rejects.toBeInstanceOf(PersistenceError);
    const missing = join(await tempDir(), 'nope.json');
    await expect(resolveExistingPath(missing)).rejects.toMatchObject({ code: 'missing' });
    const present = join(await tempDir(), 'ok.schem');
    await writeFile(present, 'x');
    const resolved = await resolveExistingPath(present);
    expect(resolved.path).toBe(present);
  });
});
