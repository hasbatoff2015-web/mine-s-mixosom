import { describe, expect, it } from 'vitest';
import { angularError } from '../shared/playerActions';
import { parseClientMessage } from '../shared/protocol';
import {
  captureBowRelease,
  resolveBowReleaseCommandSeq,
  selectBowRenderTick,
} from '../src/net/actionIntent';
import { viewDirectionFromLook } from '../src/player/localAim';

describe('bow release intent contract', () => {
  it('captures yaw/pitch at send time and does not follow a later look', () => {
    const source = { actionSeq: 0, inputSeq: 12, selectedSlot: 0 };
    const released = captureBowRelease(source, { yaw: 0.4, pitch: -0.2 });
    const laterLook = { yaw: 1.7, pitch: 0.5 };
    expect(released.yaw).toBe(0.4);
    expect(released.pitch).toBe(-0.2);
    expect(released.yaw).not.toBe(laterLook.yaw);
    expect(released.commandSeq).toBe(12);
    expect(released.actionSeq).toBe(1);
  });

  it('binds a release between fixed ticks to the next use=false command', () => {
    const boundary = resolveBowReleaseCommandSeq({
      currentInputSeq: 12,
      lastSentInputSeq: 12,
      lastSentUse: true,
    });
    const source = { actionSeq: 0, inputSeq: 12, selectedSlot: 0 };
    const released = captureBowRelease(source, { yaw: 0.4, pitch: -0.2 }, 97, boundary.commandSeq);

    expect(boundary).toEqual({ commandSeq: 13, mode: 'next-after-use-true' });
    expect(released.commandSeq).toBe(13);
    expect(source.inputSeq).toBe(12);
  });

  it('binds a release edge consumed after a fixed tick to its already-sent use=false command', () => {
    const boundary = resolveBowReleaseCommandSeq({
      currentInputSeq: 13,
      lastSentInputSeq: 13,
      lastSentUse: false,
    });
    const released = captureBowRelease(
      { actionSeq: 0, inputSeq: 13, selectedSlot: 0 },
      { yaw: 0.4, pitch: -0.2 },
      undefined,
      boundary.commandSeq,
    );

    expect(boundary).toEqual({ commandSeq: 13, mode: 'current-use-false' });
    expect(released.commandSeq).toBe(13);
  });

  it('selects the exact first use=false command in every simulated 180 FPS render phase', () => {
    const drawCommandSeq = 40;
    const phases = Array.from({ length: 20 }, (_, index) => ((index + 0.5) / 180) % 0.05);
    const chosen = phases.map(() => resolveBowReleaseCommandSeq({
      currentInputSeq: drawCommandSeq,
      lastSentInputSeq: drawCommandSeq,
      lastSentUse: true,
    }).commandSeq);

    expect(phases.every((phase) => phase > 0 && phase < 0.05)).toBe(true);
    expect(chosen).toEqual(Array.from({ length: 20 }, () => drawCommandSeq + 1));
  });

  it('duplicate seq is a distinct actionSeq', () => {
    const source = { actionSeq: 3, inputSeq: 9, selectedSlot: 1 };
    const first = captureBowRelease(source, { yaw: 0, pitch: 0 });
    const second = captureBowRelease(source, { yaw: 0, pitch: 0 });
    expect(second.actionSeq).toBe(first.actionSeq + 1);
  });

  it('angular error between captured aim and projectile dir is ~0', () => {
    const yaw = 0.31;
    const pitch = -0.17;
    const dir = viewDirectionFromLook(yaw, pitch);
    const reconstructed = viewDirectionFromLook(yaw, pitch);
    expect(dir.distanceTo(reconstructed)).toBeLessThan(1e-9);
    expect(angularError(yaw, pitch, yaw, pitch)).toBeLessThan(1e-9);
  });

  it('later yaw is a large angular error versus captured aim', () => {
    expect(angularError(0, 0, 0.5, 0)).toBeGreaterThan(0.4);
  });

  it('prefers the directly rendered remote tick and otherwise uses the active median', () => {
    expect(selectBowRenderTick(97.25, [96, 97, 98])).toBe(97.25);
    expect(selectBowRenderTick(undefined, [99, 96, 98, 97])).toBe(97.5);
    expect(selectBowRenderTick(undefined, [Number.NaN, 96, 98, 97])).toBe(97);
    expect(selectBowRenderTick(undefined, [])).toBeUndefined();
    expect(captureBowRelease({ actionSeq: 0, inputSeq: 4, selectedSlot: 2 }, { yaw: 1, pitch: 0 }, 97))
      .toMatchObject({ renderTick: 97 });
  });

  it('parses an additive render tick but rejects non-finite client values', () => {
    const message = {
      type: 'bow_release', actionSeq: 2, commandSeq: 7, selectedSlot: 0, yaw: 0.2, pitch: -0.1,
    } as const;
    expect(parseClientMessage({ ...message, renderTick: 44.5 })).toMatchObject({ renderTick: 44.5 });
    expect(parseClientMessage({ ...message, renderTick: Number.NaN })).toHaveProperty('error');
    expect(parseClientMessage({ ...message, renderTick: Number.POSITIVE_INFINITY })).toHaveProperty('error');
    const stripped = parseClientMessage({ ...message, aabb: { minX: -999 }, damage: 999 });
    expect(stripped).not.toHaveProperty('aabb');
    expect(stripped).not.toHaveProperty('damage');
  });
});
