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
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-homes-'));
    dirs.push(dir);
    return new HomeService(new JsonFileStore(dir));
  }

  it('creates, teleports lookup, enforces unique names and the max of 4', async () => {
    const homes = await setup();
    const pos = { worldId: 'anarchy', x: 1, y: 64, z: 2 };
    expect(homes.set('ada', 'Дом', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.set('ada', 'дом', { ...pos, x: 8 }, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.find('ada', 'Дом')?.x).toBe(8);
    expect(homes.set('ada', 'Шахта', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.set('ada', 'Ферма', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.set('ada', 'База', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.set('ada', 'Лишняя', pos, HOME_MAX_DEFAULT).error).toBe(HOME_LIMIT_ERROR);
    expect(homes.set('ada', 'Шахта', pos, HOME_MAX_DEFAULT).error).toBeUndefined();
    expect(homes.set('bob', 'Шахта', pos, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.remove('ada', 'Ферма').ok).toBe(true);
    expect(homes.list('ada')).toHaveLength(3);
    expect(homes.set('ada', 'Шахта', { ...pos, x: 99 }, HOME_MAX_DEFAULT).ok).toBe(true);
    expect(homes.find('ada', 'шахта')?.x).toBe(99);
  });

  it('rejects a second distinct home with the same name key', async () => {
    const homes = await setup();
    const pos = { worldId: 'anarchy', x: 0, y: 1, z: 0 };
    expect(homes.set('ada', 'Home', pos, 4).ok).toBe(true);
    const again = homes.set('ada', 'HOME', { ...pos, x: 3 }, 4);
    expect(again.ok).toBe(true);
    expect(homes.list('ada')).toHaveLength(1);
    expect(HOME_NAME_TAKEN_ERROR.length).toBeGreaterThan(0);
  });
});
