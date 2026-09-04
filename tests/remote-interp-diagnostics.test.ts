import { describe, expect, it } from 'vitest';
import { formatRemoteInterpHud, isRemoteDiagQueryEnabled } from '../src/net/remoteInterpDiagnostics';
import type { RemoteInterpDiagnostics } from '../src/net/remotePlayerInterpolation';

describe('remote interpolation diagnostics', () => {
  it('enables ?remoteDiag=1 only in DEV', () => {
    expect(isRemoteDiagQueryEnabled('?remoteDiag=1')).toBe(true);
    expect(isRemoteDiagQueryEnabled('?foo=1')).toBe(false);
  });

  it('formats a compact F3 line', () => {
    const diag: RemoteInterpDiagnostics = {
      snapshotsPerSecond: 20,
      serverTick: 440,
      bufferDepth: 2,
      bufferDepthMs: 100,
      bufferTargetDepth: 2,
      sampleCount: 6,
      interArrivalMs: 50,
      jitterMs: 2,
      arrivalJitterP50Ms: 1,
      arrivalJitterP95Ms: 2,
      renderDelayMs: 100,
      underflowsPerSecond: 0,
      extrapolationMs: 0,
      extrapolationEventsPerSecond: 0,
      staleSnapshotsPerSecond: 0,
      renderTick: 438,
      mode: 'interpolate',
      latestReceivedAt: 1000,
    };
    const line = formatRemoteInterpHud('abcd1234', diag);
    expect(line).toContain('Remote abcd1234');
    expect(line).toContain('tick=440');
    expect(line).toContain('buf=2/2.0');
    expect(line).toContain('delay=100ms');
    expect(line).toContain('under/s=0');
  });
});
