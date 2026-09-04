import { describe, expect, it } from 'vitest';
import { angularError } from '../shared/playerActions';
import { captureBowRelease } from '../src/net/actionIntent';
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
});
