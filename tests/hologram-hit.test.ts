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

  it('checks the hologram ray before bow or block use on the Online RMB path', () => {
    const from = gameSource.indexOf('private sendOnlineUse');
    const to = gameSource.indexOf('private sendOnlineBowRelease');
    const body = gameSource.slice(from, to);
    expect(body.indexOf('tryInteractHologram')).toBeGreaterThan(0);
    expect(body.indexOf('tryInteractHologram')).toBeLessThan(body.indexOf('ItemId.Bow'));
  });
});
