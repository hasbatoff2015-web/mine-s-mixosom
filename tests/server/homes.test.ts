import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonFileStore } from '../../server/services/jsonStore';
import { HomeService } from '../../server/services/home';
import {
  HOME_LIMIT_ERROR,
  HOME_MAX_DEFAULT,
  HOME_NAME_TAKEN_ERROR,
  validateHomeName,
} from '../../shared/homes';

describe('Home names', () => {
  it('accepts unique unicode names and rejects empty ones', () => {
    expect(validateHomeName('Дом').ok).toBe(true);
    expect(validateHomeName('Шахта-1').ok).toBe(true);
    expect(validateHomeName('')).toMatchObject({ ok: false });
    expect(validateHomeName('a'.repeat(25)).ok).toBe(false);
  });
});

describe('HomeService', () => {
  const dirs: string[] = [];
  const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-homes-'));
    dirs.push(dir);
    return new HomeService(new JsonFileStore(dir));
  }

  it('creates, teleports lookup, enforces unique names and the max of 3', async () => {
    const homes = await setup();
    const pos = { worldId: 'anarchy', x: 1, y: 64, z: 2 };
    expect(HOME_MAX_DEFAULT).toBe(3);
    expect(homes.set(ADA, 'Дом', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.set(ADA, 'дом', { ...pos, x: 8 }, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.get(ADA, 'Дом')?.x).toBe(8);
    expect(homes.set(ADA, 'Шахта', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.set(ADA, 'Ферма', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.set(ADA, 'База', pos, HOME_MAX_DEFAULT).error).toBe(HOME_LIMIT_ERROR(HOME_MAX_DEFAULT));
    expect(homes.set(ADA, 'Лишняя', pos, HOME_MAX_DEFAULT).error).toBe(HOME_LIMIT_ERROR(HOME_MAX_DEFAULT));
    expect(homes.set(ADA, 'Шахта', pos, HOME_MAX_DEFAULT).error).toBeUndefined();
    expect(homes.set(BOB, 'Шахта', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.remove(ADA, 'Ферма').ok).toBe(true);
    expect(homes.list(ADA)).toHaveLength(2);
    expect(homes.set(ADA, 'Шахта', { ...pos, x: 99 }, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.get(ADA, 'шахта')?.x).toBe(99);
    expect(homes.list('ada')).toEqual([]);
  });

  it('overwrites the same name key via set (command path) and exposes uniqueError for the menu', async () => {
    const homes = await setup();
    const pos = { worldId: 'anarchy', x: 0, y: 1, z: 0 };
    expect(homes.set(ADA, 'Home', pos, 4).ok).toBe(true);
    const again = homes.set(ADA, 'HOME', { ...pos, x: 3 }, 4);
    expect(again.ok).toBe(true);
    expect(homes.list(ADA)).toHaveLength(1);
    expect(homes.get(ADA, 'HOME')?.x).toBe(3);
    expect(homes.renameTaken(ADA, 'Home')).toBe(true);
    expect(homes.uniqueError().error).toBe(HOME_NAME_TAKEN_ERROR);
  });

  it('keeps a nickname home list inert and refuses to overwrite on migrate', async () => {
    const homes = await setup();
    const dir = dirs[dirs.length - 1]!;
    const store = new JsonFileStore(dir);
    store.save('home/homes', {
      players: { alex: [{ name: 'base', worldId: 'anarchy', x: 4, y: 5, z: 6 }] },
    });
    homes.load();
    expect(homes.list(ADA)).toEqual([]);
    expect(homes.list('alex')).toEqual([]);
    expect(homes.legacyList('Alex').map((home) => home.x)).toEqual([4]);
    expect(homes.set(ADA, 'base', { worldId: 'anarchy', x: 1, y: 2, z: 3 }, 4).ok).toBe(true);
    expect(homes.migrateLegacy('alex', ADA).ok).toBe(false);
    expect(homes.get(ADA, 'base')?.x).toBe(1);
    expect(homes.legacyList('alex')).toHaveLength(1);
    expect(homes.remove(ADA, 'base').ok).toBe(true);
    expect(homes.migrateLegacy('alex', ADA).ok).toBe(true);
    expect(homes.get(ADA, 'base')?.x).toBe(4);
    expect(homes.legacyList('alex')).toEqual([]);
    expect(homes.migrateLegacy('alex', ADA).ok).toBe(false);
    expect(homes.list(ADA)).toHaveLength(1);
  });
});
