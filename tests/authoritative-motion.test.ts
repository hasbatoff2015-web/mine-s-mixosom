import { describe, expect, it } from 'vitest';
import {
  clientLookAfterSnapshot,
  ingestAuthoritativePosition,
  shouldAcceptSnapshot,
  splitPlayerSnapshots,
  stepTowardTarget,
} from '../src/net/authoritativeMotion';
import type { PlayerSnapshot } from '../shared/protocol';

function snapshot(id: string, extras?: Partial<PlayerSnapshot>): PlayerSnapshot {
  return {
    id,
    name: id,
    x: 0,
    y: 70,
    z: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    health: 20,
    gamemode: 'survival',
    sneaking: false,
    sprinting: false,
    onGround: true,
    selectedSlot: 0,
    ...extras,
  };
}

describe('authoritative local motion', () => {
  it('ignores stale and duplicate snapshot ticks', () => {
    expect(shouldAcceptSnapshot(105, 106)).toBe(true);
    expect(shouldAcceptSnapshot(105, 105)).toBe(false);
    expect(shouldAcceptSnapshot(105, 104)).toBe(false);
    expect(shouldAcceptSnapshot(-1, 1)).toBe(true);
  });

  it('does not hard-teleport a small error in one render frame', () => {
    const next = stepTowardTarget({ x: 0, y: 70, z: 0 }, { x: 0.25, y: 70, z: 0 }, 1 / 60);
    expect(next.snapped).toBe(false);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(0.25);
    expect(next.y).toBe(70);
  });

  it('snaps only when the server pose is far away', () => {
    const ingested = ingestAuthoritativePosition({ x: 0, y: 70, z: 0 }, { x: 20, y: 70, z: 0 });
    expect(ingested.snapped).toBe(true);
    expect(ingested.position.x).toBe(20);
    const near = ingestAuthoritativePosition({ x: 0, y: 70, z: 0 }, { x: 0.4, y: 70, z: 0 });
    expect(near.snapped).toBe(false);
    expect(near.position.x).toBe(0);
    expect(near.target.x).toBe(0.4);
  });

  it('keeps camera look on the client when a snapshot arrives', () => {
    const look = clientLookAfterSnapshot({ yaw: 1.25, pitch: -0.4 }, { yaw: 0, pitch: 0.9 });
    expect(look.yaw).toBe(1.25);
    expect(look.pitch).toBe(-0.4);
  });

  it('does not treat the local player as a remote interpolation target', () => {
    const { local, remotes } = splitPlayerSnapshots('self', [
      snapshot('self', { x: 3 }),
      snapshot('other', { x: 8 }),
    ]);
    expect(local?.id).toBe('self');
    expect(local?.x).toBe(3);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]?.id).toBe('other');
  });
});
