import { describe, expect, it } from 'vitest';
import { FIXED_DT, WALK_SPEED } from '../src/core/constants';
import {
  formatTimelineSample,
  ownerWalkGap2Timeline,
  runLatestInputTimeline,
  walkStep,
} from '../src/net/predictionTimeline';
import { simulationTicksFromServerTick } from '../src/net/localPlayerPrediction';

const STEP = WALK_SPEED * FIXED_DT;

describe('prediction timeline simulator (latest-input, not FIFO)', () => {
  it('inputSeq is not a physics tick: unknown serverTick uses packet physicsTicks', () => {
    expect(simulationTicksFromServerTick(-1, 100, 1)).toBe(1);
    expect(simulationTicksFromServerTick(-1, undefined, 2)).toBe(2);
    expect(simulationTicksFromServerTick(10, undefined, 2)).toBe(2);
    expect(simulationTicksFromServerTick(10, 12, 1)).toBe(2);
    expect(simulationTicksFromServerTick(10, 10, 1)).toBe(0);
  });

  it('reproduces owner dump seq=545 gap=2 physicsTicks=1: history would correct, checkpoint would not', () => {
    const result = ownerWalkGap2Timeline();
    expect(result.samples).toHaveLength(1);
    const sample = result.firstHistoryCorrection;
    expect(sample, formatTimelineSample(result.samples[0]!)).toBeDefined();
    expect(sample!.inputSeqServer).toBe(5);
    expect(sample!.seqGap).toBe(2);
    expect(sample!.physicsTicks).toBe(1);
    expect(sample!.historyWouldCorrect).toBe(true);
    expect(sample!.checkpointWouldCorrect).toBe(false);
    expect(sample!.historyDist).toBeGreaterThan(STEP * 0.6);
    expect(sample!.historyDist).toBeLessThan(STEP * 1.4);
    expect(sample!.checkpointDist).toBeLessThan(1e-6);
    expect(result.checkpointCorrections).toBe(0);
    expect(walkStep()).toBeCloseTo(STEP, 10);
  });

  it('1:1 deliveries keep history and checkpoint at zero corrections', () => {
    const result = runLatestInputTimeline({
      warmup: 0,
      input: { forward: 1 },
      deliveries: [[1], [2], [3], [4], [5], [6], [7], [8]],
    });
    expect(result.historyCorrections).toBe(0);
    expect(result.checkpointCorrections).toBe(0);
    for (const sample of result.samples) {
      expect(sample.checkpointDist, formatTimelineSample(sample)).toBeLessThan(1e-6);
    }
  });

  it('phased batches [[1],[2,3],[4],[5,6]] false-correct on history[N] and accept on checkpoint', () => {
    const result = runLatestInputTimeline({
      warmup: 0,
      input: { forward: 1 },
      deliveries: [[1], [2, 3], [4], [5, 6]],
    });
    expect(result.checkpointCorrections).toBe(0);
    expect(result.historyCorrections).toBeGreaterThan(0);
    const coalesced = result.samples.filter((sample) => sample.seqGap > 1 && sample.serverTick > 1);
    expect(coalesced.length).toBe(2);
    for (const sample of coalesced) {
      expect(sample.physicsTicks).toBe(1);
      expect(sample.historyWouldCorrect).toBe(true);
      expect(sample.checkpointWouldCorrect).toBe(false);
      expect(sample.historyDist).toBeGreaterThan(STEP * 0.6);
      expect(sample.checkpointDist).toBeLessThan(1e-6);
    }
  });

  it('timer phase offset does not make the checkpoint model non-deterministic', () => {
    const phases = [
      [[1], [2], [3], [4], [5], [6]],
      [[1, 2], [3], [4, 5], [6]],
      [[1], [2, 3, 4], [5], [6]],
      [[1, 2, 3], [4, 5, 6]],
    ];
    for (const deliveries of phases) {
      const result = runLatestInputTimeline({ warmup: 0, input: { forward: 1 }, deliveries });
      expect(result.checkpointCorrections, JSON.stringify(deliveries)).toBe(0);
    }
  });

  it('stationary flight 2-vs-1 client ticks does not false-correct the checkpoint', () => {
    const result = runLatestInputTimeline({
      warmup: 2,
      flying: true,
      input: {},
      deliveries: [[3, 4]],
    });
    expect(result.samples).toHaveLength(1);
    expect(result.checkpointCorrections).toBe(0);
    expect(result.samples[0]!.checkpointDist).toBeLessThan(1e-6);
    expect(Math.abs(result.samples[0]!.server.vy)).toBeLessThan(0.05);
  });

  it('flight + SHIFT 2-vs-1: history[N] is one descend step ahead, checkpoint matches', () => {
    const result = runLatestInputTimeline({
      warmup: 2,
      flying: true,
      input: { sneak: true, descend: true },
      deliveries: [[3, 4]],
    });
    const sample = result.samples[0]!;
    expect(sample.seqGap).toBe(2);
    expect(sample.checkpointWouldCorrect).toBe(false);
    expect(sample.checkpointDist).toBeLessThan(1e-6);
    expect(sample.historyWouldCorrect).toBe(true);
    expect(Math.abs(sample.historyDist)).toBeGreaterThan(0.05);
  });
});
