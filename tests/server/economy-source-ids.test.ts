import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { HeadlessEntityHost, MobManager } from '../../src/entities';
import { SurvivalSystem } from '../../src/survival/SurvivalSystem';
import { VoxelWorld } from '../../src/world/World';
import { loadServerConfig } from '../../server/config';

function flatWorld(): VoxelWorld {
  const world = new VoxelWorld('economy-source');
  for (let x = 4; x <= 12; x += 1) {
    for (let z = 4; z <= 12; z += 1) {
      world.setBlock(x, 71, z, BlockId.Stone);
      for (let y = 72; y <= 76; y += 1) world.setBlock(x, y, z, BlockId.Air);
    }
  }
  return world;
}

describe('durable economy source identities', () => {
  it('gives each mob a UUID that survives save and is not mob-N', () => {
    const first = new MobManager(new HeadlessEntityHost(), flatWorld(), { automaticSpawning: false });
    const mob = first.spawn('zombie', { x: 8, y: 72, z: 8 }, { force: true });
    expect(mob).toBeDefined();
    expect(mob!.id).toBe('mob-1');
    expect(mob!.economyInstanceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mob!.economyInstanceId).not.toBe(mob!.id);
    const saved = first.serialize();
    const restored = new MobManager(new HeadlessEntityHost(), flatWorld(), { automaticSpawning: false });
    restored.restore(saved);
    const again = restored.get('mob-1');
    expect(again?.economyInstanceId).toBe(mob!.economyInstanceId);
    const without = saved.map((entry) => {
      const copy = { ...entry };
      delete copy.economyInstanceId;
      return copy;
    });
    const migrated = new MobManager(new HeadlessEntityHost(), flatWorld(), { automaticSpawning: false });
    migrated.restore(without);
    const generated = migrated.get('mob-1')!.economyInstanceId;
    expect(generated).toMatch(/^[0-9a-f-]{36}$/i);
    const persisted = migrated.serialize();
    const restarted = new MobManager(new HeadlessEntityHost(), flatWorld(), { automaticSpawning: false });
    restarted.restore(persisted);
    expect(restarted.get('mob-1')?.economyInstanceId).toBe(generated);

    const other = new MobManager(new HeadlessEntityHost(), flatWorld(), { automaticSpawning: false });
    const second = other.spawn('zombie', { x: 8, y: 72, z: 8 }, { force: true });
    expect(second!.id).toBe('mob-1');
    expect(second!.economyInstanceId).not.toBe(mob!.economyInstanceId);
  });

  it('keeps one death event id until respawn', () => {
    const survival = new SurvivalSystem();
    survival.damage(100, 'void', { forceLethal: true });
    const deathEventId = survival.deathEventId;
    expect(deathEventId).toMatch(/^[0-9a-f-]{36}$/i);
    survival.damage(100, 'void', { forceLethal: true });
    expect(survival.deathEventId).toBe(deathEventId);
    const saved = survival.serialize();
    const loaded = new SurvivalSystem();
    loaded.restore(saved);
    expect(loaded.deathEventId).toBe(deathEventId);
    loaded.respawn();
    expect(loaded.deathEventId).toBeUndefined();
    loaded.damage(100, 'void', { forceLethal: true });
    expect(loaded.deathEventId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(loaded.deathEventId).not.toBe(deathEventId);
  });

  it('requires postgres economy mode to name a database and does not imply a fallback', () => {
    expect(loadServerConfig({}).economy).toEqual({ backend: 'legacy_json' });
    expect(() => loadServerConfig({ FC_ECONOMY_BACKEND: 'postgres' })).toThrow(/FC_DATABASE_URL/);
    expect(() => loadServerConfig({ FC_ECONOMY_BACKEND: 'json' })).toThrow(/legacy_json or postgres/);
  });
});
