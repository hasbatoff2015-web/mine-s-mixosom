import { describe, expect, it } from 'vitest';
import {
  COMBAT_HISTORY_TICKS,
  MAX_PVP_REWIND_TICKS,
  combatPoseForCommand,
  recordCombatPose,
  rewindCombatPose,
  type CombatPoseSample,
} from '../server/combatPoseHistory';

function sample(serverTick: number, commandSeq = serverTick, x = serverTick): CombatPoseSample {
  return {
    serverTick,
    commandSeq,
    commandBoundary: true,
    eyeX: x,
    eyeY: 1.62,
    eyeZ: 0,
    positionX: x,
    positionY: 0,
    positionZ: 0,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    aabb: { minX: x - 0.3, minY: 0, minZ: -0.3, maxX: x + 0.3, maxY: 1.8, maxZ: 0.3 },
    dead: false,
    fallDistance: 0,
    onGround: true,
    sprinting: false,
    inWater: false,
    onLadder: false,
    riding: false,
  };
}

describe('authoritative combat pose history', () => {
  it('is bounded independently from the five-tick accepted rewind', () => {
    expect(COMBAT_HISTORY_TICKS).toBeGreaterThanOrEqual(10);
    expect(MAX_PVP_REWIND_TICKS).toBe(5);
    const history: CombatPoseSample[] = [];
    for (let tick = 1; tick <= 20; tick += 1) recordCombatPose(history, sample(tick));
    expect(history).toHaveLength(COMBAT_HISTORY_TICKS);
    expect(history[0]?.serverTick).toBe(20 - COMBAT_HISTORY_TICKS + 1);
  });

  it('resolves only the authoritative dequeue boundary for commandSeq', () => {
    const history = [
      sample(10, 7, 1),
      { ...sample(11, 7, 2), commandBoundary: false },
    ];
    expect(combatPoseForCommand(history, 7)?.eyeX).toBe(1);
    expect(combatPoseForCommand([{ ...history[1]!, commandBoundary: false }], 7)).toBeUndefined();
  });

  it('interpolates a fractional authoritative target AABB', () => {
    const history = [sample(10, 1, 0), sample(11, 2, 2)];
    const rewound = rewindCombatPose(history, 10.5, 12);
    expect(rewound?.aabb.minX).toBeCloseTo(0.7);
    expect(rewound?.resolvedTick).toBe(10.5);
    expect(rewound?.rewindTicks).toBe(1.5);
  });

  it('rejects requests older than five ticks and any future tick', () => {
    const history = Array.from({ length: 8 }, (_, index) => sample(10 + index));
    expect(rewindCombatPose(history, 11.99, 17)).toBeUndefined();
    expect(rewindCombatPose(history, 17.01, 17)).toBeUndefined();
    expect(rewindCombatPose(history, 12, 17)?.rewindTicks).toBe(5);
  });
});
