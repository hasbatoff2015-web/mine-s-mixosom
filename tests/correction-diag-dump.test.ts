import { describe, expect, it } from 'vitest';
import { FIXED_DT, WALK_SPEED } from '../src/core/constants';
import {
  formatCorrectionDiag,
  resetFirstCorrectionDump,
  sampleAabbBlocks,
  sampleCollisionHint,
  type CorrectionDiag,
} from '../src/net/correctionDiagnostics';
import {
  comparableExtraTicks,
  snapshotComparePath,
} from '../src/net/localPlayerPrediction';
import {
  compareLockstepModes,
  dumpControllerTicks,
} from '../src/player/moveSimCompare';

describe('snapshot compare extra ticks (no behavior change)', () => {
  it('physicsTicks=1 seqGap=1 compares history[N] exactly', () => {
    expect(comparableExtraTicks(1, 1)).toBe(0);
    expect(snapshotComparePath(0, true)).toBe('history[N]');
  });

  it('physicsTicks=2 seqGap=1 adds one extra tick of the same latest input', () => {
    expect(comparableExtraTicks(2, 1)).toBe(1);
    expect(snapshotComparePath(1, true)).toBe('history[N]+extra');
  });

  it('physicsTicks=1 seqGap=2 does not invent ticks', () => {
    expect(comparableExtraTicks(1, 2)).toBe(0);
  });
});

describe('corrDiag dump sections', () => {
  it('prints SEQ TIMING PHYSICS INPUT CLIENT/SERVER POSE DIFF STATE WORLD', () => {
    resetFirstCorrectionDump();
    const diag = {
      inputSeq: 12,
      lastAckedSeq: 11,
      seqGap: 1,
      serverTick: 40,
      lastStateTick: 39,
      tickGap: 1,
      reject: 'xz' as const,
      error: { xz: 0.22, y: 0, speed: 0, distSq: 0.048 },
      extraTicks: 0,
      comparePath: 'history[N]' as const,
      pendingSeqs: [12, 13],
      input: {
        seq: 12, forward: 1, right: 0, jump: false, sneak: false, sprint: false,
        descend: false, flySprint: false, yaw: 0.1, pitch: 0,
      },
      predicted: {
        x: 0.5, y: 1, z: -1.2, vx: 0, vy: 0, vz: -4.3,
        onGround: true, sneaking: false, sprinting: false, jumpHeld: false,
        isFlying: false, flyWindowTicks: 0, flyIgnoreGroundTicks: 0, onLadder: false,
        fallDistance: 0, meleeKnockback: false,
      },
      history: {
        x: 0.5, y: 1, z: -1.2, vx: 0, vy: 0, vz: -4.3,
        onGround: true, sneaking: false, sprinting: false, jumpHeld: false,
        isFlying: false, flyWindowTicks: 0, flyIgnoreGroundTicks: 0, onLadder: false,
        fallDistance: 0, meleeKnockback: false,
      },
      comparable: {
        x: 0.5, y: 1, z: -1.2, vx: 0, vy: 0, vz: -4.3,
        onGround: true, sneaking: false, sprinting: false, jumpHeld: false,
        isFlying: false, flyWindowTicks: 0, flyIgnoreGroundTicks: 0, onLadder: false,
        fallDistance: 0, meleeKnockback: false,
      },
      snapshot: {
        x: 0.5, y: 1, z: -1.42, vx: 0, vy: 0, vz: -4.3,
        onGround: true, sneaking: false, sprinting: false, flying: false,
      },
      liveBefore: {
        x: 0.5, y: 1, z: -1.4, vx: 0, vy: 0, vz: -4.3,
        px: 0.5, py: 1, pz: -1.2,
        onGround: true, sneaking: false, sprinting: false, isFlying: false, jumpHeld: false,
      },
      pending: 2,
      latestClientSeq: 13,
      world: {
        feetBlock: 'grass',
        belowBlock: 'dirt',
        aheadBlock: 'air',
        msSinceBlockMutation: -1,
        msSinceChunkUpdate: -1,
        ticksThisFrame: 1,
        onGroundBefore: true,
        onGroundAfterPredicted: true,
        jump: false,
        flyingToggle: false,
        descend: false,
        aabbBlocks: '5,10,7:grass',
        chunkKey: '0,0',
        chunkLoaded: true,
        mutationMarks: 0,
        visibility: 'visible',
      },
      hypotheses: ['check 1:1 tick still mismatched'],
      ownerCategory: 'A/B one walk-step: history[N] is one physics step from snapshot',
      physicsTicks: 1,
      physicsTicksThisLoop: 1,
      firstDiff: 'z',
      rawFirstDiff: 'z',
      timing: {
        clientSentAt: 10, serverRecvAt: 11, serverSimAt: 12, serverSendAt: 13, clientRecvAt: 14, applyAt: 15,
      },
    } satisfies CorrectionDiag;
    const text = formatCorrectionDiag(diag);
    for (const section of ['SEQ:', 'TIMING:', 'PHYSICS:', 'INPUT:', 'APPLIED INPUT TIMELINE', 'CLIENT POSE:', 'SERVER POSE:', 'DIFF', 'STATE:', 'WORLD:']) {
      expect(text, section).toContain(section);
    }
    expect(text).toContain('snapshot.inputSeq=12');
    expect(text).toContain('pendingSeqs=[12,13]');
    expect(text).toContain('compare exactly history[N]');
    expect(text).toContain('extra is NOT max(0, physicsTicks-seqGap)');
    expect(text).toContain('firstDiff=z');
    expect(text).toContain('worldRevision=mutationMarks=');
    expect(text).toContain(`walkStep=${(WALK_SPEED * FIXED_DT).toFixed(4)}`);
  });

  it('lists non-air AABB cells', () => {
    const sample = sampleAabbBlocks(
      (x, y) => ({ name: y <= 0 ? 'stone' : 'air' }),
      0.5, 1, 0.5,
    );
    expect(sample).toContain('stone');
    expect(sample).not.toBe('air');
  });

  it('samples collision at the history pose not the live pose', () => {
    const hint = sampleCollisionHint(
      (x, y) => ({ name: y <= 0 ? 'stone' : 'air' }),
      { x: 0.5, y: 1, z: 0.5 },
      { chunkLoaded: true, mutationMarks: 3 },
    );
    expect(hint.belowBlock).toBe('stone');
    expect(hint.feetBlock).toBe('air');
    expect(hint.chunkLoaded).toBe(true);
    expect(hint.mutationMarks).toBe(3);
    expect(hint.chunkKey).toBe('0,0');
  });
});

describe('lockstep pose dump', () => {
  it('walk/strafe/jump/stationary/flight stay identical for 1,2,3,10,20 ticks', () => {
    for (const ticks of [1, 2, 3, 10, 20]) {
      const modes = compareLockstepModes(ticks);
      for (const [name, result] of Object.entries(modes)) {
        expect(result.identical, `${name} diverged at ${result.firstDivergedTick}`).toBe(true);
      }
    }
  });

  it('prints exact xyz after 1/2/3/10/20 walk ticks', () => {
    const dump = dumpControllerTicks([1, 2, 3, 10, 20], { forward: 1 });
    expect(dump.map((pose) => pose.tick)).toEqual([0, 1, 2, 3, 10, 20]);
    const last = dump[dump.length - 1]!;
    expect(Math.hypot(last.x - 0.5, last.z - 0.5)).toBeGreaterThan(0.5);
    expect(last.y).toBeCloseTo(1, 5);
  });

  it('stationary flight hover does not free-fall', () => {
    const dump = dumpControllerTicks([1, 2, 3, 10, 20], {}, { flying: true, startY: 8 });
    const start = dump[0]!;
    const end = dump[dump.length - 1]!;
    expect(end.flying).toBe(true);
    expect(Math.abs(end.y - start.y)).toBeLessThan(0.05);
    expect(Math.abs(end.vy)).toBeLessThan(0.05);
  });

  it('flight + SHIFT loses altitude', () => {
    const dump = dumpControllerTicks([1, 2, 3, 10, 20], { descend: true }, { flying: true, startY: 8 });
    expect(dump[dump.length - 1]!.y).toBeLessThan(dump[0]!.y - 0.5);
  });
});
