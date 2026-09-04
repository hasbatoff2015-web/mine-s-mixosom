import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { PersistenceError } from '../src/save/PersistenceError';
import { WORLD_SCHEMA_VERSION } from '../src/save/types';
import { FsWorldStore } from '../server/FsWorldStore';
import { importWorldDump } from '../server/importDump';
import { WorldInstance } from '../server/WorldInstance';
import { loadServerConfig } from '../server/config';
import { ANARCHY_WORLD_ID, ANARCHY_WORLD_SEED } from '../src/world/import/anarchy';
import { sampleSnapshot } from './persistFixture';

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-persist-'));
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

describe('FsWorldStore', () => {
  it('returns null for an empty directory and preserves the Anarchy world id on create/load', async () => {
    const dataDir = await tempDir();
    const store = new FsWorldStore(dataDir);
    expect(await store.load(ANARCHY_WORLD_ID)).toBeNull();
    const snapshot = sampleSnapshot({
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
    });
    await store.save(snapshot);
    const loaded = await store.load(ANARCHY_WORLD_ID);
    expect(loaded?.summary.id).toBe(ANARCHY_WORLD_ID);
    expect(loaded?.summary.seed).toBe(ANARCHY_WORLD_SEED);
    expect(loaded?.schemaVersion).toBe(WORLD_SCHEMA_VERSION);
    expect(loaded?.modifications['0,0']?.['20']).toBe(BlockId.Dirt);
    await store.save({
      ...loaded!,
      modifications: { '0,0': { '20': BlockId.Dirt, '21': BlockId.Cobblestone } },
    });
    const again = await store.load(ANARCHY_WORLD_ID);
    expect(again?.modifications['0,0']?.['21']).toBe(BlockId.Cobblestone);
  });

  it('throws an explicit error on a corrupt existing save instead of creating a new world', async () => {
    const dataDir = await tempDir();
    const worldDir = join(dataDir, ANARCHY_WORLD_ID);
    await mkdir(worldDir, { recursive: true });
    await writeFile(join(worldDir, 'meta.json'), '{not-json', 'utf8');
    const store = new FsWorldStore(dataDir);
    await expect(store.load(ANARCHY_WORLD_ID)).rejects.toBeInstanceOf(PersistenceError);
  });

  it('throws when meta.json exists without world.json', async () => {
    const dataDir = await tempDir();
    const worldDir = join(dataDir, ANARCHY_WORLD_ID);
    await mkdir(worldDir, { recursive: true });
    await writeFile(join(worldDir, 'meta.json'), `${JSON.stringify({
      worldId: ANARCHY_WORLD_ID,
      seed: ANARCHY_WORLD_SEED,
      spawn: [0.5, 70, 0.5],
      createdAt: 1,
      updatedAt: 1,
      readyState: 'READY',
    })}\n`, 'utf8');
    const store = new FsWorldStore(dataDir);
    await expect(store.load(ANARCHY_WORLD_ID)).rejects.toMatchObject({ code: 'incomplete' });
  });

  it('serializes concurrent saves', async () => {
    const dataDir = await tempDir();
    const store = new FsWorldStore(dataDir);
    const base = sampleSnapshot({
      summary: { ...sampleSnapshot().summary, id: ANARCHY_WORLD_ID, seed: ANARCHY_WORLD_SEED },
    });
    await Promise.all([
      store.save({ ...base, timeOfDay: 100 }),
      store.save({ ...base, timeOfDay: 200 }),
    ]);
    const loaded = await store.load(ANARCHY_WORLD_ID);
    expect(loaded?.timeOfDay === 100 || loaded?.timeOfDay === 200).toBe(true);
    expect(loaded?.summary.id).toBe(ANARCHY_WORLD_ID);
  });

  it('imports an IndexedDB dump through the shared snapshot into FsWorldStore', async () => {
    const dataDir = await tempDir();
    const store = new FsWorldStore(dataDir);
    const dump = sampleSnapshot({
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
    });
    await importWorldDump({
      store,
      worldId: ANARCHY_WORLD_ID,
      fallbackSeed: ANARCHY_WORLD_SEED,
      raw: dump,
    });
    const loaded = await store.load(ANARCHY_WORLD_ID);
    expect(loaded?.modifications).toEqual(dump.modifications);
    expect(loaded?.blockStates).toEqual(dump.blockStates);
    expect(loaded?.droppedItems).toHaveLength(1);
    expect(loaded?.summary.id).toBe(ANARCHY_WORLD_ID);
    await expect(importWorldDump({
      store,
      worldId: ANARCHY_WORLD_ID,
      fallbackSeed: ANARCHY_WORLD_SEED,
      raw: dump,
    })).rejects.toMatchObject({ code: 'exists' });
  });

  it('WorldInstance restart keeps blocks, farming state and inventory via the store', async () => {
    const dataDir = await tempDir();
    const first = new WorldInstance(testConfig(dataDir));
    await first.initialize();
    expect(first.worldId).toBe(ANARCHY_WORLD_ID);
    const joined = first.join({ sink: { send() {} }, name: 'Keeper' });
    if ('error' in joined) throw new Error(joined.error);
    joined.player.inventory.clear();
    joined.player.inventory.addItem('iron_ingot', 4);
    const x = Math.floor(first.spawn[0]);
    const y = Math.floor(first.spawn[1]) + 3;
    const z = Math.floor(first.spawn[2]);
    first.world.setBlock(x, y, z, BlockId.GoldOre);
    first.world.setBlock(x + 1, y, z, BlockId.Farmland);
    first.world.setBlockState(x + 1, y, z, { hydrated: true });
    first.world.setBlock(x + 1, y + 1, z, BlockId.PotatoCrop);
    first.world.setBlockState(x + 1, y + 1, z, { age: 6 });
    await first.save();
    await first.stop();

    const second = new WorldInstance(testConfig(dataDir));
    await second.initialize();
    expect(second.world.getBlock(x, y, z)).toBe(BlockId.GoldOre);
    expect(second.world.getBlock(x + 1, y, z)).toBe(BlockId.Farmland);
    expect(second.world.getBlockState(x + 1, y, z)).toEqual({ hydrated: true });
    expect(second.world.getBlock(x + 1, y + 1, z)).toBe(BlockId.PotatoCrop);
    expect(second.world.getBlockState(x + 1, y + 1, z)).toEqual({ age: 6 });
    const resumed = second.join({
      sink: { send() {} },
      name: 'Keeper',
      sessionToken: joined.player.sessionToken,
    });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.player.inventory.has('iron_ingot', 4)).toBe(true);
    await second.stop();
  });
});
