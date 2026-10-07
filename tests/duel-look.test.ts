import { describe, expect, it } from 'vitest';
import { viewDirectionFromLook } from '../src/player/localAim';
import { duelLookToward } from '../shared/duels';

describe('duel look toward the other spawn', () => {
  it('aligns cardinal and vertical directions and falls back when the points coincide', () => {
    const origin = { x: 10, y: 64, z: 10 };
    const cases = [
      { name: 'north', to: { x: 10, y: 64, z: 4 } },
      { name: 'south', to: { x: 10, y: 64, z: 18 } },
      { name: 'east', to: { x: 16, y: 64, z: 10 } },
      { name: 'west', to: { x: 2, y: 64, z: 10 } },
      { name: 'up', to: { x: 10, y: 70, z: 10 } },
    ];
    for (const entry of cases) {
      const look = duelLookToward(origin, entry.to, { yaw: 9, pitch: 9 });
      expect(Number.isFinite(look.yaw), entry.name).toBe(true);
      expect(Number.isFinite(look.pitch), entry.name).toBe(true);
      const direction = viewDirectionFromLook(look.yaw, look.pitch);
      const dx = entry.to.x - origin.x;
      const dy = entry.to.y - origin.y;
      const dz = entry.to.z - origin.z;
      const len = Math.hypot(dx, dy, dz);
      const dot = (direction.x * dx + direction.y * dy + direction.z * dz) / len;
      expect(dot, entry.name).toBeCloseTo(1, 6);
    }

    const same = { x: 3, y: 4, z: 5, yaw: 1.25, pitch: -0.4 };
    expect(duelLookToward(same, { x: 3, y: 4, z: 5 }, same)).toEqual({ yaw: 1.25, pitch: -0.4 });
    expect(duelLookToward(same, { x: 3, y: 4, z: 5 + 1e-12 }, { yaw: Number.NaN, pitch: Number.NaN })).toEqual({
      yaw: 0,
      pitch: 0,
    });
  });
});
