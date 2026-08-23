import { describe, expect, it } from 'vitest';
import {
  categorizeChunk,
  categoryColor,
  computeDurations,
  countHorizon,
  describeChunkBlocker,
  formatLastSpike,
  formatQueueRank,
  formatDurationMs,
  queueRank,
  resolveInspectedChunk,
  selectFrontMissingChunk,
  shouldCaptureSlowChunk,
  summarizeQueueLane,
  toggleInspectFreeze,
  type ChunkDebugFacts,
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
});
