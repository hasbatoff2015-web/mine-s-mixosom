import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  listenerHearsWorldSound,
  worldSoundMaxDistance,
  worldSoundPlayOptions,
} from '../src/audio/worldSoundPlayback';
import { SOUND_CATALOG } from '../src/audio/soundCatalog';

const gameSource = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const applySource = readFileSync(new URL('../src/net/applyEntitySnapshots.ts', import.meta.url), 'utf8');
const gameplaySource = readFileSync(new URL('../server/gameplay.ts', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../server/WorldInstance.ts', import.meta.url), 'utf8');

describe('world_sound playback is spatial', () => {
  it('forces positional playback so catalog local profiles cannot bypass distance', () => {
    expect(SOUND_CATALOG.get('bow.shoot')?.positional).toBe(false);
    expect(SOUND_CATALOG.get('item.pickup')?.positional).toBe(false);
    expect(worldSoundPlayOptions({ volume: 0.4 }).positional).toBe(true);
    expect(worldSoundPlayOptions({ positional: false }).positional).toBe(true);
    expect(gameSource).toContain('worldSoundPlayOptions');
    expect(worldSource).toContain('listenerHearsWorldSound');
    expect(worldSource).not.toContain("broadcast({ type: 'world_sound'");
  });

  it('does not treat snapshots, interpolation, or movement as bow.shoot / item.pickup', () => {
    expect(applySource).not.toContain('item.pickup');
    expect(applySource).not.toContain('bow.shoot');
    expect(applySource).toContain('pickupDelaySeconds: 999');
    expect(gameSource).not.toMatch(/tickOnline[\s\S]{0,200}bow\.shoot/);
    expect(gameplaySource).toContain("emitWorldSound('bow.shoot'");
    expect(gameplaySource).toContain("emitWorldSound('item.pickup'");
  });

  it('skips far listeners and keeps nearby ones', () => {
    const sound = { x: 0, y: 64, z: 0 };
    const bowRange = worldSoundMaxDistance('bow.shoot');
    const pickupRange = worldSoundMaxDistance('item.pickup');
    expect(bowRange).toBe(16);
    expect(pickupRange).toBe(12);
    expect(listenerHearsWorldSound({ x: 0, y: 64, z: 0 }, sound, bowRange)).toBe(true);
    expect(listenerHearsWorldSound({ x: 20, y: 64, z: 0 }, sound, bowRange)).toBe(false);
    expect(listenerHearsWorldSound({ x: 13, y: 64, z: 0 }, sound, pickupRange)).toBe(false);
    expect(listenerHearsWorldSound({ x: 200, y: 64, z: 0 }, sound, pickupRange)).toBe(false);
  });
});
