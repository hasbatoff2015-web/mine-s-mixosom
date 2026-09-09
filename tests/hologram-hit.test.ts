import { describe, expect, it } from 'vitest';
import gameSource from '../src/core/Game.ts?raw';
import { pickHologramRayHit, resolveHologramUseTarget } from '../src/gameplay/hologramHit';

const hologram = {
  name: 'spawn',
  x: 8,
  y: 70,
  z: 8,
  lines: ['Hello'],
  size: 1,
  enabled: true,
};

describe('hologram RMB interaction', () => {
  it('opens the hologram editor when the ray hits the hologram first', () => {
    const origin = { x: 8, y: 70, z: 5 };
    const direction = { x: 0, y: 0, z: 1 };
    const hit = pickHologramRayHit([hologram], origin, direction, 5);
    expect(hit?.name).toBe('spawn');
    expect(resolveHologramUseTarget(hit, 4.5)).toEqual({ kind: 'hologram', name: 'spawn' });
  });

  it('keeps the ordinary block interaction when the hologram is not under the cursor', () => {
    const origin = { x: 0, y: 70, z: 0 };
    const direction = { x: 1, y: 0, z: 0 };
    const hit = pickHologramRayHit([hologram], origin, direction, 5);
    expect(hit).toBeUndefined();
    expect(resolveHologramUseTarget(hit, 1.2)).toEqual({ kind: 'world' });
    expect(resolveHologramUseTarget(
      { name: 'spawn', distance: 3 },
      1.2,
    )).toEqual({ kind: 'world' });
  });

  it('uses the background plane for RMB when it is larger than the text', () => {
    const wide = {
      name: 'banner',
      x: 8,
      y: 70,
      z: 8,
      lines: ['Hi'],
      size: 0.5,
      enabled: true,
      backgroundEnabled: true,
      backgroundWidth: 4,
      backgroundHeight: 0.5,
    };
    const origin = { x: 9.5, y: 70, z: 5 };
    const direction = { x: 0, y: 0, z: 1 };
    expect(pickHologramRayHit([wide], origin, direction, 5)?.name).toBe('banner');
    expect(pickHologramRayHit([{ ...wide, backgroundEnabled: false }], origin, direction, 5)).toBeUndefined();
  });
});
