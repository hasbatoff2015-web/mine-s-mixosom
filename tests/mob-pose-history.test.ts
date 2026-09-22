import { describe, expect, it } from 'vitest';
import {
  MAX_MOB_REWIND_TICKS,
  MOB_POSE_HISTORY_TICKS,
  recordMobPose,
  rewindMobPose,
  type MobPoseSample,
} from '../src/entities/mobPoseHistory';

describe('mob pose rewind history', () => {
  it('lerps between retained ticks and rejects ticks outside the window', () => {
    const history: MobPoseSample[] = [];
    for (let tick = 1; tick <= 20; tick += 1) {
      recordMobPose(history, { tick, x: tick, y: 70, z: 0, yaw: 0 });
    }
    expect(history).toHaveLength(MOB_POSE_HISTORY_TICKS);
    const current = 20;
    const mid = rewindMobPose(history, 19.5, current);
    expect(mid?.x).toBeCloseTo(19.5, 5);
    expect(mid?.rewindTicks).toBeCloseTo(0.5, 5);
    expect(rewindMobPose(history, current - MAX_MOB_REWIND_TICKS - 0.01, current)).toBeUndefined();
    expect(rewindMobPose(history, current + 0.01, current)).toBeUndefined();
  });

  it('keeps PvP rewind on a separate smaller bound', async () => {
    const { MAX_PVP_REWIND_TICKS } = await import('../server/combatPoseHistory');
    expect(MAX_MOB_REWIND_TICKS).toBe(8);
    expect(MAX_PVP_REWIND_TICKS).toBe(5);
    expect(MOB_POSE_HISTORY_TICKS).toBe(16);
  });
});
