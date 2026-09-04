import { isDevRuntime } from './predIsolation';
import type { RemoteInterpDiagnostics, RemoteInterpSample } from './remotePlayerInterpolation';

function queryFlag(name: string, search: string): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const value = params.get(name);
  return value === '1' || value === 'true';
}

export function isRemoteDiagQueryEnabled(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean {
  if (!isDevRuntime()) return false;
  return queryFlag('remoteDiag', search) || queryFlag('remotediag', search);
}

export function formatRemoteInterpHud(
  label: string,
  diag: RemoteInterpDiagnostics,
): string {
  return (
    `Remote ${label} tick=${diag.serverTick} render=${diag.renderTick.toFixed(2)} ${diag.mode} `
    + `buf=${diag.bufferDepth}/${diag.bufferTargetDepth.toFixed(1)} n=${diag.sampleCount} `
    + `bufMs=${(diag.bufferDepthMs ?? 0).toFixed(0)} delay=${diag.renderDelayMs.toFixed(0)}ms `
    + `snap/s=${diag.snapshotsPerSecond} `
    + `arr=${diag.interArrivalMs.toFixed(0)}ms jitter=${diag.jitterMs.toFixed(0)}/${(diag.jitterP50Ms ?? 0).toFixed(0)}/${(diag.jitterP95Ms ?? 0).toFixed(0)}ms `
    + `under/s=${diag.underflowsPerSecond} extrap=${diag.extrapolationMs.toFixed(0)}ms `
    + `extrap/s=${diag.extrapolationEventsPerSecond} late/s=${diag.lateSnapshotsPerSecond} stale/s=${diag.staleSnapshotsPerSecond} `
    + `rec=${diag.recovering ? '1' : '0'}/${(diag.recoveryMs ?? 0).toFixed(0)}ms step=${diag.maxVisualStep.toFixed(2)}`
  );
}

export function formatRemoteTimeline(samples: readonly RemoteInterpSample[]): string {
  if (samples.length === 0) return '  (empty)';
  return samples.map((sample) => (
    `  tick=${sample.serverTick} xyz=${sample.x.toFixed(3)},${sample.y.toFixed(3)},${sample.z.toFixed(3)} `
    + `recv=${sample.receivedAt.toFixed(0)} ground=${sample.onGround} sprint=${sample.sprinting}`
  )).join('\n');
}

let lastTimelineLogAt = 0;

export function maybeLogRemoteTimeline(
  label: string,
  samples: readonly RemoteInterpSample[],
  diag: RemoteInterpDiagnostics,
  now: number,
): void {
  if (!isRemoteDiagQueryEnabled() || typeof console === 'undefined') return;
  if (now - lastTimelineLogAt < 1000) return;
  lastTimelineLogAt = now;
  console.info(
    `[remoteDiag] ${formatRemoteInterpHud(label, diag)}\n${formatRemoteTimeline(samples)}`,
  );
}
