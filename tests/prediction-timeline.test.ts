import { describe, expect, it } from 'vitest';
import { FIXED_DT, WALK_SPEED } from '../src/core/constants';
import {
  formatTimelineSample,
  ownerWalkGap2Timeline,
  runFifoTimeline,
  runLatestInputTimeline,
  walkStep,
} from '../src/net/predictionTimeline';
import { simulationTicksFromServerTick } from '../src/net/localPlayerPrediction';

const STEP = WALK_SPEED * FIXED_DT;

describe('obsolete latest-input timeline (not the production contract)', () => {
  it('documents why history[latest] false-corrects when two seqs share one tick', () => {
    const result = ownerWalkGap2Timeline();
    expect(result.samples).toHaveLength(1);
    const sample = result.firstHistoryCorrection;
    expect(sample, formatTimelineSample(result.samples[0]!)).toBeDefined();
    expect(sample!.seqGap).toBe(2);
    expect(sample!.historyWouldCorrect).toBe(true);
    expect(sample!.checkpointWouldCorrect).toBe(false);
    expect(walkStep()).toBeCloseTo(STEP, 10);
  });
});

describe('FIFO command timeline (production contract)', () => {
  it('serverTick delta still measures catch-up extras, not command identity', () => {
    expect(simulationTicksFromServerTick(-1, 100, 1)).toBe(1);
    expect(simulationTicksFromServerTick(10, 12, 1)).toBe(2);
    expect(simulationTicksFromServerTick(10, 10, 1)).toBe(0);
  });

  it('1:1 deliveries ACK each command with zero history corrections', () => {
    const result = runFifoTimeline({
      warmup: 0,
      input: { forward: 1 },
      deliveries: [[1], [2], [3], [4], [5], [6], [7], [8]],
    });
    expect(result.historyCorrections).toBe(0);
    for (const sample of result.samples) {
      expect(sample.historyDist, formatTimelineSample(sample)).toBeLessThan(1e-6);
      expect(sample.inputSeqServer).toBe(sample.serverTick);
    }
  });

  it('two packets before a tick apply the first queued command', () => {
    const result = runFifoTimeline({
      warmup: 0,
      input: { forward: 1 },
      deliveries: [[1, 2]],
    });
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]!.inputSeqServer).toBe(1);
    expect(result.historyCorrections).toBe(0);
    expect(result.samples[0]!.historyDist).toBeLessThan(1e-6);
  });

  it('phased batches ACK FIFO order, not latest packet', () => {
    const result = runFifoTimeline({
      warmup: 0,
      input: { forward: 1 },
      deliveries: [[1], [2, 3], [4], [5, 6]],
    });
    expect(result.historyCorrections).toBe(0);
    expect(result.samples.map((sample) => sample.inputSeqServer)).toEqual([1, 2, 3, 4]);
    for (const sample of result.samples) {
      expect(sample.historyDist, formatTimelineSample(sample)).toBeLessThan(1e-6);
    }
  });

  it('phase offsets keep FIFO history deterministic', () => {
    const phases = [
      [[1], [2], [3], [4], [5], [6]],
      [[1, 2], [3], [4, 5], [6]],
      [[1], [2, 3, 4], [5], [6]],
      [[1, 2, 3], [4, 5, 6]],
    ];
    for (const deliveries of phases) {
      const result = runFifoTimeline({ warmup: 0, input: { forward: 1 }, deliveries });
      expect(result.historyCorrections, JSON.stringify(deliveries)).toBe(0);
    }
  });

  it('stationary flight burst still matches history[ack]', () => {
    const result = runFifoTimeline({
      warmup: 2,
      flying: true,
      input: {},
      deliveries: [[3, 4]],
    });
    expect(result.samples).toHaveLength(1);
    expect(result.historyCorrections).toBe(0);
    expect(result.samples[0]!.historyDist).toBeLessThan(1e-6);
    expect(Math.abs(result.samples[0]!.server.vy)).toBeLessThan(0.05);
  });

  it('flight + SHIFT burst ACKs the first queued descend command', () => {
    const result = runFifoTimeline({
      warmup: 2,
      flying: true,
      input: { sneak: true, descend: true },
      deliveries: [[3, 4]],
    });
    expect(result.samples[0]!.inputSeqServer).toBe(3);
    expect(result.historyCorrections).toBe(0);
    expect(result.samples[0]!.historyDist).toBeLessThan(1e-6);
  });
});
