import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { Inventory } from '../src/inventory';
import { PersistenceError } from '../src/save/PersistenceError';
import { fsRecordsToSnapshot, snapshotToFsRecords } from '../src/save/fsRecords';
import { parseWorldSnapshot } from '../src/save/snapshot';
import { WORLD_SCHEMA_VERSION } from '../src/save/types';
import { sampleSnapshot, inventoryWithDiamond } from './persistFixture';

describe('WorldSnapshot', () => {
  it('serializes, deserializes and round-trips gameplay fields', () => {
    const original = sampleSnapshot();
    const json = JSON.parse(JSON.stringify(original)) as unknown;
    const restored = parseWorldSnapshot(json);
    expect(restored.schemaVersion).toBe(WORLD_SCHEMA_VERSION);
    expect(restored.summary.seed).toBe('seed-1');
    expect(restored.timeOfDay).toBe(6000);
    expect(restored.player.position).toEqual([8.5, 64, 8.5]);
    expect(restored.player.health).toBe(18);
    expect(restored.player.hunger).toBe(16);
    expect(restored.player.absorption).toBe(4);
    expect(restored.summary.mode).toBe('survival');
    expect(restored.modifications['0,0']?.['20']).toBe(BlockId.Dirt);
    expect(restored.blockStates?.['5,64,5']).toEqual({ facing: 'north' });
    expect(restored.droppedItems).toHaveLength(1);
    expect(restored.mobs).toHaveLength(1);
    expect(restored.minecarts).toHaveLength(1);
    expect(restored.serverWorld?.spawn).toEqual([8.5, 64, 8.5]);
    const inv = Inventory.deserialize(restored.player.inventory);
    expect(inv.has('diamond', 3)).toBe(true);
    expect(inv.getSlot({ section: 'armor', slot: 'chest' })?.itemId).toBe('iron_chestplate');
  });

  it('preserves effects inside a server player survival blob', () => {
    const snapshot = sampleSnapshot({
      players: {
        'p-1': {
          id: 'p-1',
          name: 'Ada',
          x: 3,
          y: 70,
          z: 4,
          yaw: 0.2,
          pitch: 0,
          health: 15,
          gamemode: 'creative',
          selectedSlot: 1,
          inventory: inventoryWithDiamond(),
          updatedAt: 50,
          survival: {
            health: 15,
            hunger: 18,
            saturation: 5,
            effects: [{ id: 'absorption', amplifier: 0, ticks: 80 }],
          },
        },
      },
    });
    const restored = parseWorldSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.players?.['p-1']?.gamemode).toBe('creative');
    expect(restored.players?.['p-1']?.survival).toMatchObject({
      effects: [{ id: 'absorption', amplifier: 0, ticks: 80 }],
    });
    expect(Inventory.deserialize(restored.players!['p-1']!.inventory).has('diamond', 3)).toBe(true);
  });

  it('round-trips through filesystem records without IndexedDB or fs.writeFile', () => {
    const original = sampleSnapshot({
      summary: {
        id: 'anarchy',
        name: 'Анархия',
        seed: 'anarchy-spawn-v1',
        mode: 'survival',
        kind: 'server',
        serverId: 'anarchy-pvp',
        createdAt: 1,
        updatedAt: 2,
        playTimeSeconds: 0,
      },
      players: {
        'p-1': {
          id: 'p-1',
          name: 'Ada',
          x: 12.5,
          y: 41,
          z: 8.5,
          yaw: 0,
          pitch: 0,
          health: 20,
          gamemode: 'survival',
          selectedSlot: 0,
          inventory: inventoryWithDiamond(),
          sessionToken: 'tok',
          updatedAt: 9,
        },
      },
    });
    const records = snapshotToFsRecords(original);
    expect(records.meta.worldId).toBe('anarchy');
    expect(records.meta.spawn).toEqual([8.5, 64, 8.5]);
    const back = parseWorldSnapshot(fsRecordsToSnapshot(records));
    expect(back.summary.id).toBe('anarchy');
    expect(back.summary.seed).toBe('anarchy-spawn-v1');
    expect(back.modifications).toEqual(original.modifications);
    expect(back.blockStates).toEqual(original.blockStates);
    expect(back.droppedItems).toEqual(original.droppedItems);
    expect(back.players?.['p-1']?.sessionToken).toBe('tok');
    expect(back.serverWorld?.spawn).toEqual([8.5, 64, 8.5]);
  });

  it('rejects future schema versions instead of resetting', () => {
    expect(() => parseWorldSnapshot({
      ...sampleSnapshot(),
      schemaVersion: 99,
    })).toThrow(PersistenceError);
  });

  it('does not persist client-only visual clocks', () => {
    const json = JSON.stringify(sampleSnapshot());
    expect(json).not.toContain('deathVisualElapsed');
    expect(json).not.toContain('hurtFlashSeconds');
  });
});
