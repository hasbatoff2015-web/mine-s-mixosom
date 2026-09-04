import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { IdbWorldStore } from '../src/save/IdbWorldStore';
import { SaveService } from '../src/save/SaveService';
import { WORLD_SCHEMA_VERSION } from '../src/save/types';
import { sampleSnapshot } from './persistFixture';

describe('IdbWorldStore', () => {
  it('loads a pre-port schemaVersion 1 record without renaming the database', async () => {
    const saves = new SaveService();
    await saves.saveWorld({
      schemaVersion: 1,
      summary: {
        id: 'legacy-sp',
        name: 'Старый',
        seed: 'legacy-seed',
        mode: 'creative',
        createdAt: 1,
        updatedAt: 1,
        playTimeSeconds: 0,
      },
      timeOfDay: 100,
      weather: 'clear',
      player: {
        position: [1, 70, 2],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        health: 20,
        hunger: 20,
        saturation: 5,
        selectedSlot: 0,
        inventory: { version: 1, slots: Array.from({ length: 36 }, () => null), armor: { head: null, chest: null, legs: null, feet: null }, offhand: null },
      },
      modifications: { '0,0': { '5': BlockId.Stone } },
      chests: {},
      furnaces: {},
      droppedItems: [],
    });
    const store = new IdbWorldStore(saves);
    const loaded = await store.load('legacy-sp');
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(WORLD_SCHEMA_VERSION);
    expect(loaded!.summary.mode).toBe('creative');
    expect(loaded!.modifications['0,0']?.['5']).toBe(BlockId.Stone);
    expect(loaded!.player.position).toEqual([1, 70, 2]);
  });

  it('round-trips a snapshot and keeps worlds separated', async () => {
    const store = new IdbWorldStore();
    const a = sampleSnapshot({ summary: { ...sampleSnapshot().summary, id: 'world-a', name: 'A' } });
    const b = sampleSnapshot({
      summary: { ...sampleSnapshot().summary, id: 'world-b', name: 'B', seed: 'other' },
      modifications: { '1,0': { '1': BlockId.GoldOre } },
    });
    await store.save(a);
    await store.save(b);
    const loadedA = await store.load('world-a');
    const loadedB = await store.load('world-b');
    expect(loadedA?.summary.name).toBe('A');
    expect(loadedB?.summary.seed).toBe('other');
    expect(loadedB?.modifications['1,0']?.['1']).toBe(BlockId.GoldOre);
    expect(loadedA?.modifications['1,0']).toBeUndefined();
    expect(await store.exists('world-a')).toBe(true);
    const listed = await store.list();
    expect(listed.some((world) => world.id === 'world-a')).toBe(true);
    expect(listed.some((world) => world.id === 'world-b')).toBe(true);
  });

  it('does not drop player inventory on save → load', async () => {
    const store = new IdbWorldStore();
    const snapshot = sampleSnapshot({ summary: { ...sampleSnapshot().summary, id: 'inv-keep' } });
    await store.save(snapshot);
    const loaded = await store.load('inv-keep');
    expect(loaded).not.toBeNull();
    expect(JSON.stringify(loaded!.player.inventory)).toContain('diamond');
  });

  it('round-trips farmland hydration and crop age through IndexedDB', async () => {
    const store = new IdbWorldStore();
    const snapshot = sampleSnapshot({
      summary: { ...sampleSnapshot().summary, id: 'farming-idb', name: 'Farming' },
      modifications: {
        '0,0': {
          '645': BlockId.Farmland,
          '901': BlockId.WheatCrop,
        },
      },
      blockStates: {
        '5,40,5': { hydrated: true },
        '5,41,5': { age: 6 },
      },
    });

    await store.save(snapshot);
    const loaded = await store.load('farming-idb');

    expect(loaded?.modifications['0,0']?.['645']).toBe(BlockId.Farmland);
    expect(loaded?.modifications['0,0']?.['901']).toBe(BlockId.WheatCrop);
    expect(loaded?.blockStates?.['5,40,5']).toEqual({ hydrated: true });
    expect(loaded?.blockStates?.['5,41,5']).toEqual({ age: 6 });
  });
});
