import { describe, expect, it } from 'vitest';
import {
  recordActionPose,
  resolveActionEye,
  type ActionPoseSample,
} from '../shared/actionPoseHistory';

describe('action pose history', () => {
  it('resolves the historical eye for an older commandSeq', () => {
    const history: ActionPoseSample[] = [];
    recordActionPose(history, { commandSeq: 500, eyeX: 1, eyeY: 2, eyeZ: 3, selectedSlot: 0 });
    recordActionPose(history, { commandSeq: 501, eyeX: 4, eyeY: 5, eyeZ: 6, selectedSlot: 1 });
    const resolved = resolveActionEye(
      history,
      501,
      { x: 4, y: 5, z: 6 },
      500,
    );
    expect(resolved).toEqual({
      ok: true,
      source: 'history',
      eye: { x: 1, y: 2, z: 3 },
    });
  });

  it('uses current eye for a pending unapplied commandSeq', () => {
    const history: ActionPoseSample[] = [
      { commandSeq: 10, eyeX: 1, eyeY: 2, eyeZ: 3, selectedSlot: 0 },
    ];
    const resolved = resolveActionEye(history, 10, { x: 1, y: 2, z: 3 }, 12);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.source).toBe('pending');
      expect(resolved.eye).toEqual({ x: 1, y: 2, z: 3 });
    }
  });

  it('rejects a commandSeq that has fallen out of history', () => {
    const history: ActionPoseSample[] = [
      { commandSeq: 80, eyeX: 1, eyeY: 2, eyeZ: 3, selectedSlot: 0 },
    ];
    expect(resolveActionEye(history, 80, { x: 1, y: 2, z: 3 }, 1)).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('compacts sticky repeats of the same commandSeq', () => {
    const history: ActionPoseSample[] = [];
    recordActionPose(history, { commandSeq: 7, eyeX: 0, eyeY: 0, eyeZ: 0, selectedSlot: 0 });
    recordActionPose(history, { commandSeq: 7, eyeX: 1, eyeY: 1, eyeZ: 1, selectedSlot: 0 });
    expect(history).toHaveLength(1);
    expect(history[0]?.eyeX).toBe(1);
  });
});
