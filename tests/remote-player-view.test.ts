import { describe, expect, it } from 'vitest';
import { sampleRemotePose, type RemotePoseSample } from '../src/net/RemotePlayerView';

describe('remote player interpolation', () => {
  it('lerps previous → current over the delayed render time instead of snapping to the latest pose', () => {
    const samples: RemotePoseSample[] = [
      { x: 0, y: 70, z: 0, yaw: 0, at: 1_000 },
      { x: 2, y: 70, z: 0, yaw: 0, at: 1_050 },
    ];
    const mid = sampleRemotePose(samples, 1_105, 80);
    expect(mid).toBeDefined();
    expect(mid!.x).toBeCloseTo(1, 5);
    const held = sampleRemotePose(samples, 1_200, 80);
    expect(held!.x).toBeCloseTo(2, 5);
  });

  it('does not jump to the newest sample the instant it arrives', () => {
    const samples: RemotePoseSample[] = [
      { x: 0, y: 70, z: 0, yaw: 0, at: 50 },
      { x: 4, y: 70, z: 0, yaw: 0, at: 100 },
    ];
    const justArrived = sampleRemotePose(samples, 100, 80);
    expect(justArrived!.x).toBeCloseTo(0, 5);
  });
});
