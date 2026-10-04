import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_SETTINGS_STORAGE_KEY,
  CLIENT_SETTINGS_VERSION,
  defaultClientSettings,
  loadClientSettings,
  saveClientSettings,
  sanitizeClientSettings,
  type ClientSettingsStorage,
} from '../src/ui/clientSettings';

class MemoryStorage implements ClientSettingsStorage {
  readonly values = new Map<string, string>();
  fail = false;
  getItem(key: string): string | null {
    if (this.fail) throw new Error('unavailable');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.fail) throw new Error('unavailable');
    this.values.set(key, value);
  }
}

describe('client settings persistence', () => {
  it('uses defaults when nothing is stored', () => {
    const storage = new MemoryStorage();
    expect(loadClientSettings(storage, false)).toEqual(defaultClientSettings(false));
    expect(loadClientSettings(storage, true).renderDistance).toBe(2);
  });

  it('persists fov, sensitivity, volume, render distance, and clouds across a new load', () => {
    const storage = new MemoryStorage();
    const saved = saveClientSettings({
      volume: 0.25,
      sensitivity: 0.004,
      renderDistance: 6,
      fov: 90,
      clouds: false,
    }, storage);
    expect(saved.fov).toBe(90);
    expect(JSON.parse(storage.values.get(CLIENT_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      v: CLIENT_SETTINGS_VERSION,
      fov: 90,
      sensitivity: 0.004,
      volume: 0.25,
      renderDistance: 6,
      clouds: false,
    });
    expect(loadClientSettings(storage, false)).toEqual(saved);
  });

  it('falls back to defaults on malformed JSON and keeps a broken store from crashing', () => {
    const storage = new MemoryStorage();
    storage.values.set(CLIENT_SETTINGS_STORAGE_KEY, '{not json');
    expect(loadClientSettings(storage, false)).toEqual(defaultClientSettings(false));
    storage.fail = true;
    expect(loadClientSettings(storage, false)).toEqual(defaultClientSettings(false));
    expect(saveClientSettings(defaultClientSettings(false), storage).fov).toBe(75);
  });

  it('keeps known fields from a partial object and defaults the rest', () => {
    const storage = new MemoryStorage();
    storage.values.set(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify({ v: 1, fov: 82 }));
    const loaded = loadClientSettings(storage, false);
    expect(loaded.fov).toBe(82);
    expect(loaded.volume).toBe(defaultClientSettings(false).volume);
    expect(loaded.sensitivity).toBe(defaultClientSettings(false).sensitivity);
    expect(loaded.renderDistance).toBe(defaultClientSettings(false).renderDistance);
    expect(loaded.clouds).toBe(true);
  });

  it('clamps out-of-range values and rejects NaN, Infinity, and non-numeric strings', () => {
    const loaded = sanitizeClientSettings({
      volume: 4,
      sensitivity: '0.001',
      renderDistance: 99,
      fov: Number.NaN,
      clouds: 'false',
    });
    expect(loaded.volume).toBe(1);
    expect(loaded.sensitivity).toBeCloseTo(0.001);
    expect(loaded.renderDistance).toBe(6);
    expect(loaded.fov).toBe(defaultClientSettings(false).fov);
    expect(loaded.clouds).toBe(false);
    expect(sanitizeClientSettings({ fov: Number.POSITIVE_INFINITY, volume: 'nope' }).fov).toBe(75);
    expect(sanitizeClientSettings({ fov: Number.POSITIVE_INFINITY, volume: 'nope' }).volume).toBe(0.7);
  });

  it('does not reset runtime preferences when an online session starts', () => {
    const source = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private async startOnlineAnarchy');
    const end = source.indexOf('private async startSession');
    const body = source.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(body).not.toContain('this.settings');
    expect(body).not.toContain('loadClientSettings');
    expect(body).toContain('movementEpoch: welcome.you.movementEpoch ?? 0');
  });
});
