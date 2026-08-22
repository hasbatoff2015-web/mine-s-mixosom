import { describe, expect, it } from 'vitest';
import { interpolatePose, lerpAngle, shouldSnapPose } from '../src/core/entityInterpolation';

describe('entity render interpolation', () => {
  it('lerps position at alpha 0.5', () => {
    const visual = interpolatePose(
      { x: 0, y: 0, z: 0, yaw: 0, walkPhase: 0 },
      { x: 1, y: 2, z: 3, yaw: 0, walkPhase: 1 },
      0.5,
    );
    expect(visual.x).toBe(0.5);
    expect(visual.y).toBe(1);
    expect(visual.z).toBe(1.5);
    expect(visual.walkPhase).toBe(0.5);
  });

  it('takes the shortest yaw path across 0/2π', () => {
    const from = Math.PI * 2 - 0.1;
    const to = 0.1;
    const mid = lerpAngle(from, to, 0.5);
    const normalized = ((mid % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    expect(normalized).toBeCloseTo(0, 1);
    const wrapped = interpolatePose(
      { x: 0, y: 0, z: 0, yaw: from, walkPhase: 0 },
      { x: 0, y: 0, z: 0, yaw: to, walkPhase: 0 },
      0.5,
    );
    const delta = Math.abs(((wrapped.yaw - from + Math.PI) % (Math.PI * 2)) - Math.PI);
    expect(delta).toBeLessThan(Math.PI / 2);
  });

  it('snaps large corrections instead of flying across the map', () => {
    expect(shouldSnapPose(
      { x: 0, y: 0, z: 0, yaw: 0, walkPhase: 0 },
      { x: 64, y: 0, z: 0, yaw: 0, walkPhase: 0 },
    )).toBe(true);
    const visual = interpolatePose(
      { x: 0, y: 0, z: 0, yaw: 0, walkPhase: 0 },
      { x: 64, y: 0, z: 0, yaw: 1, walkPhase: 4 },
      0.5,
    );
    expect(visual.x).toBe(64);
    expect(visual.yaw).toBe(1);
  });
});
