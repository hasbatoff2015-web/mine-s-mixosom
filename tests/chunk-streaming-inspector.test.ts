import { describe, expect, it } from 'vitest';
import {
  categorizeChunk,
  categoryColor,
  computeDurations,
  computePlayerVisibleLatency,
  countHorizon,
  describeChunkBlocker,
  formatLastSlowVisibleChunkLines,
  formatLastSpike,
  formatQueueRank,
  formatDurationMs,
  formatHistogramMs,
  formatReadyMeshStarvationLine,
  formatWantedStateLines,
  openReadyWantedWaitMs,
  queueRank,
  readyWantedToMeshSampleMs,
  resolveInspectedChunk,
  selectFrontMissingChunk,
  shouldCaptureSlowChunk,
  shouldCaptureSlowVisibleChunk,
  shouldRecordWantedVisibleSample,
  shouldWarnReadyMeshWait,
  summarizeQueueLane,
  syncWantedPeriod,
  toggleInspectFreeze,
  wantedToVisibleSampleMs,
  type ChunkDebugFacts,
  type ChunkTimestamps,
  type HaloNeighborFact,
} from '../src/debug/chunkStreamingInspector';
import { ChunkStreamingTrace } from '../src/debug/chunkStreamingTrace';

function facts(overrides: Partial<ChunkDebugFacts> = {}): ChunkDebugFacts {
  return {
    cx: 0,
    cz: 0,
    requested: true,
    generated: true,
    lightingQueued: false,
    lightingActive: false,
    lightingReady: true,
    lightContextReady: true,
    meshQueued: false,
    meshActive: false,
    meshed: true,
    meshLightCurrent: true,
    visible: true,
    dirty: false,
    pendingMesh: false,
    pendingLight: false,
    inMeshRadius: true,
    inGenerateRadius: true,
    floodOwnerIsOther: false,
    meshSkippedDueToGenSeparation: false,
    lightingOnlyDueToBudget: false,
    meshReadyButOverBudget: false,
    ...overrides,
  };
}

describe('chunk streaming inspector (diagnostic mapping)', () => {
  it('maps real flags to overlay categories and colors', () => {
    expect(categorizeChunk(facts({ requested: false, generated: false, visible: false, meshed: false }))).toBe('absent');
    expect(categoryColor('absent')).toBe(0x8a8a8a);
    expect(categorizeChunk(facts({ generated: false, requested: true, visible: false, meshed: false }))).toBe('waiting_generation');
    expect(categoryColor('waiting_generation')).toBe(0x3b82f6);
    expect(categorizeChunk(facts({ lightingReady: false, lightingQueued: true, visible: false, meshed: false }))).toBe('waiting_light');
    expect(categoryColor('waiting_light')).toBe(0x22d3ee);
    expect(categorizeChunk(facts({ lightingReady: false, lightingActive: true, visible: false, meshed: false }))).toBe('lighting');
    expect(categoryColor('lighting')).toBe(0xeab308);
    expect(categorizeChunk(facts({ visible: false, meshed: false, meshQueued: true }))).toBe('waiting_mesh');
    expect(categoryColor('waiting_mesh')).toBe(0xf97316);
    expect(categorizeChunk(facts({ visible: false, meshed: false, meshActive: true }))).toBe('meshing');
    expect(categoryColor('meshing')).toBe(0xc084fc);
    expect(categorizeChunk(facts())).toBe('visible');
    expect(categoryColor('visible')).toBe(0x22c55e);
    expect(categorizeChunk(facts({ visible: true, meshLightCurrent: false }))).toBe('blocked');
    expect(categorizeChunk(facts({
      visible: false,
      meshed: false,
      lightContextReady: false,
    }))).toBe('blocked');
    expect(categoryColor('blocked')).toBe(0xef4444);
  });

  it('describes blockers from scheduler conditions, not category names', () => {
    expect(describeChunkBlocker(facts({ generated: false, visible: false, meshed: false }))).toBe('waiting generation');
    expect(describeChunkBlocker(facts({ lightingReady: false, lightingActive: true, visible: false, meshed: false }))).toBe('lighting job active');
    expect(describeChunkBlocker(facts({ lightingReady: false, lightingQueued: true, visible: false, meshed: false }))).toBe('lighting job pending');
    expect(describeChunkBlocker(facts({ inMeshRadius: false, visible: false, meshed: false }))).toBe('outside activation rule');
    expect(describeChunkBlocker(facts({
      visible: false,
      meshed: false,
      meshSkippedDueToGenSeparation: true,
    }))).toBe('waiting generation-frame separation');
    expect(describeChunkBlocker(facts({
      visible: false,
      meshed: false,
      lightingOnlyDueToBudget: true,
    }))).toBe('waiting mesh budget');

    const halo: HaloNeighborFact[] = [
      { dir: 'N', cx: 0, cz: -1, required: true, present: true, lightingReady: true, stateLabel: 'READY' },
      { dir: 'S', cx: 0, cz: 1, required: true, present: true, lightingReady: true, stateLabel: 'READY' },
      { dir: 'E', cx: 1, cz: 0, required: true, present: true, lightingReady: false, stateLabel: 'GENERATED / WAIT_LIGHT' },
      { dir: 'W', cx: -1, cz: 0, required: true, present: true, lightingReady: true, stateLabel: 'READY' },
    ];
    expect(describeChunkBlocker(facts({
      visible: false,
      meshed: false,
      lightContextReady: false,
    }), halo)).toBe('neighbor (1,0) not lit');
    expect(describeChunkBlocker(facts({
      visible: false,
      meshed: false,
      lightContextReady: false,
    }), [
      { dir: 'N', cx: 0, cz: -1, required: true, present: false, lightingReady: false, stateLabel: 'MISSING' },
      { dir: 'S', cx: 0, cz: 1, required: true, present: true, lightingReady: true, stateLabel: 'READY' },
      { dir: 'E', cx: 1, cz: 0, required: true, present: true, lightingReady: true, stateLabel: 'READY' },
      { dir: 'W', cx: -1, cz: 0, required: true, present: true, lightingReady: true, stateLabel: 'READY' },
    ])).toBe('neighbor (0,-1) missing');
    expect(describeChunkBlocker(facts({ visible: true, meshLightCurrent: false }))).toBe('mesh version stale');
    expect(describeChunkBlocker(facts({ visible: false, meshed: false, meshQueued: true, dirty: true }))).toBe('mesh queued');
    expect(describeChunkBlocker(facts())).toBe('none');
  });

  it('computes queue rank from a read-only ordered snapshot', () => {
    const ordered = ['2,0', '1,0', '0,0', '3,1'];
    const copy = [...ordered];
    expect(queueRank('0,0', ordered)).toBe(2);
    expect(queueRank('9,9', ordered)).toBeNull();
    expect(formatQueueRank(null)).toBe('not queued');
    expect(formatQueueRank(0)).toBe('0');
    expect(ordered).toEqual(copy);
  });

  it('counts wanted / missing / obsolete jobs without mutating queues', () => {
    const wanted = ['0,0', '1,0', '0,1', '1,1'];
    const present = new Set(['0,0', '1,0']);
    const gen = ['0,1', '8,8'];
    const light = ['1,0', '9,0'];
    const mesh = ['0,0', '12,12', '13,13'];
    const counts = countHorizon({
      wantedKeys: wanted,
      presentKeys: present,
      genQueueKeys: gen,
      lightQueueKeys: light,
      meshQueueKeys: mesh,
    });
    expect(counts.wantedNow).toBe(4);
    expect(counts.missingWanted).toBe(2);
    expect(counts.queuedObsoleteGen).toBe(1);
    expect(counts.queuedObsoleteLight).toBe(1);
    expect(counts.queuedObsoleteMesh).toBe(2);
    expect(counts.queuedObsolete).toBe(4);
    expect(gen).toEqual(['0,1', '8,8']);
  });

  it('does not treat lighting-halo jobs as obsolete mesh work', () => {
    const meshWanted = ['0,0'];
    const generateWanted = ['0,0', '1,0'];
    const counts = countHorizon({
      wantedKeys: meshWanted,
      presentKeys: new Set(['0,0', '1,0']),
      genQueueKeys: ['1,0'],
      lightQueueKeys: ['1,0'],
      meshQueueKeys: ['0,0'],
      genWantedKeys: generateWanted,
      lightWantedKeys: generateWanted,
      meshWantedKeys: meshWanted,
    });
    expect(counts.queuedObsoleteGen).toBe(0);
    expect(counts.queuedObsoleteLight).toBe(0);
    expect(counts.queuedObsoleteMesh).toBe(0);
  });

  it('counts pendingMesh keys outside wanted as obsolete, not dirty-only halo', () => {
    const counts = countHorizon({
      wantedKeys: ['0,0', '1,0'],
      presentKeys: new Set(['0,0', '1,0', '2,0']),
      genQueueKeys: [],
      lightQueueKeys: [],
      meshQueueKeys: ['0,0', '9,9', '10,0'],
      meshWantedKeys: ['0,0', '1,0'],
    });
    expect(counts.queuedObsoleteMesh).toBe(2);
    expect(counts.queuedObsolete).toBe(2);
  });

  it('computes stage durations including an open lit→meshStart stall', () => {
    const durations = computeDurations({
      requestedAt: 1000,
      generationStartedAt: 1010,
      generatedAt: 1014,
      lightingStartedAt: 1020,
      litAt: 1500,
    }, 9700);
    expect(durations.requestToGenerateMs).toBe(14);
    expect(durations.generateDurationMs).toBe(4);
    expect(durations.generatedToLitMs).toBe(486);
    expect(durations.litToMeshStartMs).toBe(8200);
    expect(durations.meshDurationMs).toBeNull();
    expect(durations.ageMs).toBe(8700);
    expect(formatDurationMs(8200)).toBe('8.20s');
    expect(formatDurationMs(14)).toBe('14 ms');
  });

  it('freezes the inspected chunk until toggled again', () => {
    const selected = { cx: 13, cz: -8 };
    const frozen = toggleInspectFreeze(null, selected);
    expect(frozen).toEqual({ frozen: true, cx: 13, cz: -8 });
    expect(resolveInspectedChunk(frozen, { cx: 20, cz: 4 })).toEqual({ cx: 13, cz: -8 });
    expect(toggleInspectFreeze(frozen, { cx: 20, cz: 4 })).toBeNull();
    expect(resolveInspectedChunk(null, { cx: 20, cz: 4 })).toEqual({ cx: 20, cz: 4 });
  });

  it('fires the slow-chunk detector after the 2s threshold once per stall', () => {
    expect(shouldCaptureSlowChunk(true, false, 1999, false)).toBe(false);
    expect(shouldCaptureSlowChunk(true, false, 2000, false)).toBe(true);
    expect(shouldCaptureSlowChunk(true, false, 8000, true)).toBe(false);
    expect(shouldCaptureSlowChunk(true, true, 8000, false)).toBe(false);
    expect(shouldCaptureSlowChunk(false, false, 8000, false)).toBe(false);
  });

  it('formats LAST SPIKE with age so a stale hitch is not read as current', () => {
    expect(formatLastSpike(39.5, 37_800)).toBe('LAST SPIKE 39.5 ms (37.8s ago)');
    expect(formatLastSpike(12, 400)).toBe('LAST SPIKE 12.0 ms (400ms ago)');
  });

  it('summarizes ready vs blocked head without touching the queue array', () => {
    const keys = ['0,0', '1,0', '2,0'];
    const snapshot = summarizeQueueLane({
      keys,
      ready: ['2,0'],
      blocked: ['0,0', '1,0'],
      agesMs: new Map([['0,0', 7800], ['1,0', 400]]),
      headState: 'BLOCKED',
    });
    expect(snapshot.pending).toBe(3);
    expect(snapshot.ready).toBe(1);
    expect(snapshot.blocked).toBe(2);
    expect(snapshot.headKey).toBe('0,0');
    expect(snapshot.headBlocked).toBe(true);
    expect(snapshot.oldestAgeMs).toBe(7800);
    expect(keys).toEqual(['0,0', '1,0', '2,0']);
  });

  it('stores a bounded per-chunk event history', () => {
    const trace = new ChunkStreamingTrace();
    for (let i = 0; i < 20; i += 1) {
      trace.mark('lightYielded', 3, -1, 1000 + i * 10);
    }
    const events = trace.get(3, -1)?.events ?? [];
    expect(events.length).toBe(12);
    expect(events[0]?.kind).toBe('lightYielded');
    trace.mark('requested', 3, -1, 500);
    expect(trace.timestamps(3, -1).requestedAt).toBe(500);
    trace.mark('requested', 3, -1, 900);
    expect(trace.timestamps(3, -1).requestedAt).toBe(500);
  });

  it('selects a missing chunk ahead of the player unless freeze is set', () => {
    const candidates = [
      { cx: 0, cz: 0, visible: true, generated: true, inMeshRadius: true, inGenerateRadius: true },
      { cx: 1, cz: 0, visible: false, generated: true, inMeshRadius: true, inGenerateRadius: true },
      { cx: -2, cz: 0, visible: false, generated: false, inMeshRadius: true, inGenerateRadius: true },
    ];
    const front = selectFrontMissingChunk({
      freeze: null,
      playerCx: 0,
      playerCz: 0,
      dirX: 1,
      dirZ: 0,
      candidates,
    });
    expect(front).toEqual({ cx: 1, cz: 0, source: 'front-missing' });
    const frozen = selectFrontMissingChunk({
      freeze: { frozen: true, cx: 9, cz: 9 },
      playerCx: 0,
      playerCz: 0,
      dirX: 1,
      dirZ: 0,
      candidates,
    });
    expect(frozen).toEqual({ cx: 9, cz: 9, source: 'freeze' });
  });

  it('warns when a ready-wanted mesh waits more than 500 ms', () => {
    expect(shouldWarnReadyMeshWait(499, false)).toBe(false);
    expect(shouldWarnReadyMeshWait(500, false)).toBe(true);
    expect(formatHistogramMs('READY-WANTED→MESH', 40, 120, 400, 8)).toContain('p50');
    expect(formatHistogramMs('WANTED→VISIBLE', 0, 0, 0, 0)).toBe('WANTED→VISIBLE —');
  });
});

const readyWantedInput = (now: number, overrides: Partial<Parameters<typeof syncWantedPeriod>[1]> = {}) => ({
  inMeshWanted: true,
  inGenerationWanted: true,
  inLightHalo: false,
  generated: true,
  lightingReady: true,
  lightContextReady: true,
  visible: false,
  distance: 2,
  now,
  ...overrides,
});

describe('player-visible chunk latency (wanted vs prefetch)', () => {
  it('keeps huge lit→meshStart for a 40s prefetch but READY-WANTED→MESH is small', () => {
    const stamps: ChunkTimestamps = {
      requestedAt: 0,
      generatedAt: 10,
      litAt: 20,
    };
    syncWantedPeriod(stamps, readyWantedInput(40_000));
    stamps.meshStartedAt = 40_100;
    stamps.meshedAt = 40_114;
    stamps.visibleAt = 40_115;
    const durations = computeDurations(stamps, 40_115);
    const latency = computePlayerVisibleLatency(stamps, { wantedNow: true, visible: true, now: 40_115 });
    expect(durations.litToMeshStartMs).toBe(40_080);
    expect(latency.readyWantedToMeshStartMs).toBe(100);
    expect(latency.wantedToVisibleMs).toBe(115);
    expect(latency.litAgeBeforeWantedMs).toBe(39_980);
    expect(shouldWarnReadyMeshWait(latency.readyWantedWaitMs ?? 0, false)).toBe(false);
    expect(shouldWarnReadyMeshWait(durations.litToMeshStartMs ?? 0, false)).toBe(true);
  });

  it('sets enteredMeshWantedAt when the chunk enters mesh wanted radius', () => {
    const stamps: ChunkTimestamps = {};
    const result = syncWantedPeriod(stamps, readyWantedInput(1_200, { lightingReady: false, lightContextReady: false }));
    expect(result.enteredMeshWanted).toBe(true);
    expect(stamps.enteredMeshWantedAt).toBe(1_200);
    expect(stamps.readyToMeshWhileWantedAt).toBeUndefined();
  });

  it('stops the live wanted timer when the chunk leaves mesh wanted radius', () => {
    const stamps: ChunkTimestamps = { litAt: 0 };
    syncWantedPeriod(stamps, readyWantedInput(100));
    const whileWanted = computePlayerVisibleLatency(stamps, { wantedNow: true, visible: false, now: 400 });
    expect(whileWanted.wantedAgeMs).toBe(300);
    expect(whileWanted.readyWantedWaitMs).toBe(300);
    const left = syncWantedPeriod(stamps, readyWantedInput(500, { inMeshWanted: false, inGenerationWanted: false }));
    expect(left.leftMeshWanted).toBe(true);
    expect(stamps.enteredMeshWantedAt).toBeUndefined();
    const later = computePlayerVisibleLatency(stamps, { wantedNow: false, visible: false, now: 8_000 });
    expect(later.wantedAgeMs).toBeNull();
    expect(later.readyWantedWaitMs).toBeNull();
    expect(later.currentlyNotWanted).toBe(true);
    expect(later.lastWantedDurationMs).toBe(400);
    expect(later.wantedAgeMs).toBeNull();
  });

  it('starts a new wanted period on re-enter', () => {
    const stamps: ChunkTimestamps = {};
    syncWantedPeriod(stamps, readyWantedInput(100));
    syncWantedPeriod(stamps, readyWantedInput(400, { inMeshWanted: false }));
    expect(stamps.lastEnteredMeshWantedAt).toBe(100);
    const reenter = syncWantedPeriod(stamps, readyWantedInput(900));
    expect(reenter.enteredMeshWanted).toBe(true);
    expect(stamps.enteredMeshWantedAt).toBe(900);
    expect(stamps.enteredMeshWantedAt).not.toBe(stamps.lastEnteredMeshWantedAt);
    const latency = computePlayerVisibleLatency(stamps, { wantedNow: true, visible: false, now: 950 });
    expect(latency.wantedAgeMs).toBe(50);
  });

  it('does not fire SLOW VISIBLE CHUNK for an old prefetched chunk outside wanted radius', () => {
    expect(shouldCaptureSlowVisibleChunk({
      inMeshWanted: false,
      visible: false,
      wantedToVisibleMs: 40_000,
      alreadyCaptured: false,
    })).toBe(false);
    expect(shouldCaptureSlowChunk(false, false, 40_000, false)).toBe(false);
  });

  it('fires SLOW VISIBLE CHUNK when wanted→visible exceeds 2 s inside wanted radius', () => {
    expect(shouldCaptureSlowVisibleChunk({
      inMeshWanted: true,
      visible: false,
      wantedToVisibleMs: 1_999,
      alreadyCaptured: false,
    })).toBe(false);
    expect(shouldCaptureSlowVisibleChunk({
      inMeshWanted: true,
      visible: false,
      wantedToVisibleMs: 2_000,
      alreadyCaptured: false,
    })).toBe(true);
    expect(shouldCaptureSlowChunk(true, false, 2_000, false)).toBe(true);
  });

  it('READY MESH STARVATION uses readyWanted timestamp, not litAt', () => {
    const stamps: ChunkTimestamps = { generatedAt: 0, litAt: 0 };
    syncWantedPeriod(stamps, readyWantedInput(40_000));
    const early = computePlayerVisibleLatency(stamps, { wantedNow: true, visible: false, now: 40_080 });
    expect(early.readyWantedWaitMs).toBe(80);
    expect(computeDurations(stamps, 40_080).litToMeshStartMs).toBe(40_080);
    expect(shouldWarnReadyMeshWait(early.readyWantedWaitMs ?? 0, false)).toBe(false);
    expect(openReadyWantedWaitMs(early)).toBe(80);
    const starving = computePlayerVisibleLatency(stamps, { wantedNow: true, visible: false, now: 40_501 });
    expect(starving.readyWantedWaitMs).toBe(501);
    expect(shouldWarnReadyMeshWait(starving.readyWantedWaitMs ?? 0, false)).toBe(true);
    expect(formatReadyMeshStarvationLine({ cx: 3, cz: -1, waitMs: 501, atMs: 40_501 }, 40_501)).toContain('READY MESH STARVATION');
    expect(formatReadyMeshStarvationLine({ cx: 3, cz: -1, waitMs: 501, atMs: 40_501 }, 40_501)).not.toContain('READY MESH WAIT');
  });

  it('frozen F9 target outside radius shows CURRENTLY NOT WANTED and last wanted durations', () => {
    const stamps: ChunkTimestamps = { generatedAt: 0, litAt: 10 };
    syncWantedPeriod(stamps, readyWantedInput(100, { distance: 3 }));
    stamps.meshStartedAt = 140;
    stamps.meshedAt = 154;
    stamps.visibleAt = 155;
    syncWantedPeriod(stamps, readyWantedInput(200, { inMeshWanted: false, visible: true, distance: 27 }));
    const frozenLater = computePlayerVisibleLatency(stamps, { wantedNow: false, visible: false, now: 5_200 });
    expect(frozenLater.currentlyNotWanted).toBe(true);
    expect(frozenLater.wantedAgeMs).toBeNull();
    expect(frozenLater.readyWantedWaitMs).toBeNull();
    expect(frozenLater.lastWantedDurationMs).toBe(100);
    expect(frozenLater.lastWantedToVisibleMs).toBe(55);
    expect(frozenLater.lastReadyWantedToMeshStartMs).toBe(40);
    const lines = formatWantedStateLines({
      latency: frozenLater,
      meshStarted: false,
      visible: false,
      frozen: true,
    }).join('\n');
    expect(lines).toContain('CURRENT STATE (F9 freeze)');
    expect(lines).toContain('CURRENTLY NOT WANTED');
    expect(lines).toContain('LAST WANTED PERIOD');
    expect(lines).toContain('WANTED AGE — (timer stopped)');
    expect(lines).toContain('READY-WANTED WAIT — (timer stopped)');
    expect(lines).toContain('duration 100 ms');
    expect(lines).toContain('WANTED→VISIBLE 55 ms');
    const slowLines = formatLastSlowVisibleChunkLines({
      atMs: 200,
      cx: 10,
      cz: 0,
      state: 'WAITING_MESH',
      blocker: 'waiting mesh budget',
      genRank: null,
      lightRank: null,
      meshRank: 8,
      durations: computeDurations(stamps, 5_200),
      wantedNow: 81,
      missingWanted: 1,
      queuedObsolete: 0,
      genPending: 0,
      lightPending: 0,
      meshPending: 4,
      wantedToVisibleMs: 3_400,
      wantedToReadyMs: 42,
      readyWantedToMeshStartMs: 3_300,
      meshDurationMs: null,
      maxDistanceWhileWanted: 4,
    }, 5_200).join('\n');
    expect(slowLines).toContain('LAST SLOW VISIBLE CHUNK');
    expect(slowLines).not.toContain('LAST SLOW CHUNK 10');
    expect(slowLines).toContain('WANTED→VISIBLE 3.40s');
  });

  it('rolling stats include only chunks that actually entered mesh wanted radius', () => {
    const haloOnly: ChunkTimestamps = { generatedAt: 0, litAt: 10, meshStartedAt: 40_000, visibleAt: 40_020 };
    expect(shouldRecordWantedVisibleSample(haloOnly)).toBe(false);
    expect(wantedToVisibleSampleMs(haloOnly, 40_020)).toBeNull();
    expect(readyWantedToMeshSampleMs(haloOnly)).toBeNull();

    const wanted: ChunkTimestamps = {
      generatedAt: 0,
      litAt: 10,
      enteredMeshWantedAt: 40_000,
      readyToMeshWhileWantedAt: 40_000,
      meshStartedAt: 40_080,
      visibleAt: 40_100,
    };
    expect(shouldRecordWantedVisibleSample(wanted)).toBe(true);
    expect(wantedToVisibleSampleMs(wanted, 40_100)).toBe(100);
    expect(readyWantedToMeshSampleMs(wanted)).toBe(80);
  });

  it('does not mutate production scheduler queues while updating wanted stamps', () => {
    const keys = ['0,0', '1,0'];
    const stamps: ChunkTimestamps = {};
    syncWantedPeriod(stamps, readyWantedInput(50));
    expect(keys).toEqual(['0,0', '1,0']);
    expect(stamps.enteredMeshWantedAt).toBe(50);
  });

  it('self-QA A: 40s lit prefetch then 100ms wanted→visible is not slow', () => {
    const stamps: ChunkTimestamps = { generatedAt: 0, litAt: 100 };
    syncWantedPeriod(stamps, readyWantedInput(40_000));
    stamps.meshStartedAt = 40_040;
    stamps.meshedAt = 40_090;
    stamps.visibleAt = 40_100;
    const latency = computePlayerVisibleLatency(stamps, { wantedNow: true, visible: true, now: 40_100 });
    expect(latency.wantedToVisibleMs).toBe(100);
    expect(shouldCaptureSlowVisibleChunk({
      inMeshWanted: true,
      visible: true,
      wantedToVisibleMs: latency.wantedToVisibleMs ?? 0,
      alreadyCaptured: false,
    })).toBe(false);
    expect(shouldCaptureSlowVisibleChunk({
      inMeshWanted: true,
      visible: false,
      wantedToVisibleMs: 100,
      alreadyCaptured: false,
    })).toBe(false);
  });

  it('self-QA B: wanted + ready for 3s is a real READY MESH STARVATION', () => {
    const stamps: ChunkTimestamps = { generatedAt: 0, litAt: 50 };
    syncWantedPeriod(stamps, readyWantedInput(1_000));
    const latency = computePlayerVisibleLatency(stamps, { wantedNow: true, visible: false, now: 4_400 });
    expect(latency.wantedAgeMs).toBe(3_400);
    expect(latency.readyWantedWaitMs).toBe(3_400);
    expect(openReadyWantedWaitMs(latency)).toBe(3_400);
    expect(shouldWarnReadyMeshWait(latency.readyWantedWaitMs ?? 0, false)).toBe(true);
    expect(shouldCaptureSlowVisibleChunk({
      inMeshWanted: true,
      visible: false,
      wantedToVisibleMs: latency.wantedToVisibleMs ?? 0,
      alreadyCaptured: false,
    })).toBe(true);
  });
});
