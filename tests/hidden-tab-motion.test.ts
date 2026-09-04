import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT, MAX_CATCH_UP_TICKS, MAX_FRAME_DELTA, WALK_SPEED } from '../src/core/constants';
import { advanceFixedStep } from '../src/core/fixedStep';
import { worldSimulationActive } from '../src/core/gameplayModal';
import { PageVisibilityProbe } from '../src/debug/pageVisibilityProbe';
import type { MoveInput } from '../src/input/MoveInput';
import {
  evaluateHiddenTabResume,
  hiddenServerTravelMeters,
  maxResumeCatchUpTicks,
  resyncLocalPlayerAfterHiddenTab,
  shouldPausePrediction,
} from '../src/net/hiddenTabMotion';
import {
  createPredictionBuffer,
  inspectPredictedPlayer,
  predictedMoveFromInput,
  predictLocalMove,
  reconcilePredictedPlayer,
  type PredictionBuffer,
} from '../src/net/localPlayerPrediction';
import { PlayerController } from '../src/player';
import type { PlayerSnapshot } from '../shared/protocol';
import type { VoxelWorld } from '../src/world/World';

class TestWorld {
  readonly blocks = new Map<string, BlockId>();

  set(x: number, y: number, z: number, block: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, block);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    return this.blocks.get(`${x},${y},${z}`) ?? BlockId.Air;
  }

  getBlockState(): undefined {
    return undefined;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }
}

const idle: MoveInput = {
  forward: 0, right: 0, jump: false, sprint: false, sneak: false, descend: false, flySprint: false,
};
const walk: MoveInput = { ...idle, forward: 1 };
const flyDescend: MoveInput = { ...idle, forward: 1, descend: true };

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -64; z <= 64; z += 1) {
    for (let x = -64; x <= 64; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

function snapshotOf(player: PlayerController, seq: number): PlayerSnapshot {
  return {
    id: 'self',
    name: 'self',
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    yaw: player.yaw,
    pitch: player.pitch,
    vx: player.velocity.x,
    vy: player.velocity.y,
    vz: player.velocity.z,
    health: 20,
    gamemode: player.creativeFlightAllowed ? 'creative' : 'survival',
    sneaking: player.sneaking,
    sprinting: player.sprinting,
    onGround: player.onGround,
    selectedSlot: 0,
    flying: player.isFlying,
    inputSeq: seq,
  };
}

function source(movement: MoveInput) {
  return { yaw: 0, pitch: 0, locomotion: true, movement: () => movement };
}

function xzGap(a: PlayerController, b: PlayerController): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

interface HiddenTabSim {
  clientTicksWhileHidden: number;
  clientInputsWhileHidden: number;
  serverTicksWhileHidden: number;
  snapshotsWhileHidden: number;
  pendingSlots: number;
  uniquePendingSeqs: number;
  duplicateSeqIgnored: boolean;
  poseGapAtResume: number;
  resumeCatchUpTicks: number;
  droppedSeconds: number;
  correctionsAfterResume: number;
  snapsAfterResume: number;
  serverInputBurst: number;
  firstCorrectionDist: number;
}

function simulateHiddenTab(options: {
  policy: 'legacy' | 'resume';
  hiddenTicks?: number;
  resumeTicks?: number;
  movement?: MoveInput;
  flying?: boolean;
  clearKeysOnHide?: boolean;
}): HiddenTabSim {
  const hiddenTicks = options.hiddenTicks ?? 40;
  const resumeTicks = options.resumeTicks ?? 20;
  const held = options.movement ?? walk;
  const world = flatWorld() as unknown as VoxelWorld;
  const client = new PlayerController({ position: [0.5, 1, 0.5] });
  const server = new PlayerController({ position: [0.5, 1, 0.5] });
  client.creativeFlightAllowed = options.flying === true;
  server.creativeFlightAllowed = options.flying === true;
  client.isFlying = options.flying === true;
  server.isFlying = options.flying === true;
  client.tick(world, source(idle), FIXED_DT);
  server.tick(world, source(idle), FIXED_DT);
  const buffer: PredictionBuffer = createPredictionBuffer();
  buffer.lastAckedSeq = 0;
  let seq = 0;
  let lastInput = held;
  let lastSeq = 0;
  let pending: PlayerSnapshot | undefined;
  const pendingSeqs = new Set<number>();
  let snapshotsWhileHidden = 0;

  for (let i = 0; i < 8; i += 1) {
    seq += 1;
    lastSeq = seq;
    lastInput = held;
    predictLocalMove(client, world, buffer, predictedMoveFromInput(seq, held, { yaw: 0, pitch: 0 }, true));
    server.tick(world, source(held), FIXED_DT);
    reconcilePredictedPlayer(client, world, buffer, snapshotOf(server, seq), undefined, { physicsTicks: 1 });
  }

  const hideX = client.position.x;
  const hideZ = client.position.z;
  void hideX;
  void hideZ;

  let clientTicksWhileHidden = 0;
  let clientInputsWhileHidden = 0;

  if (options.policy === 'resume') {
    seq += 1;
    lastSeq = seq;
    lastInput = idle;
    clientInputsWhileHidden += 1;
    predictLocalMove(client, world, buffer, predictedMoveFromInput(seq, idle, { yaw: 0, pitch: 0 }, true));
    clientTicksWhileHidden += 1;
    server.tick(world, source(idle), FIXED_DT);
  }

  for (let i = 0; i < hiddenTicks; i += 1) {
    server.tick(world, source(lastInput), FIXED_DT);
    snapshotsWhileHidden += 1;
    pending = snapshotOf(server, lastSeq);
    pendingSeqs.add(lastSeq);
  }

  const inspect = pending
    ? inspectPredictedPlayer(buffer, pending, client, { world, physicsTicks: 1 })
    : undefined;
  const poseGapAtResume = xzGap(client, server) + Math.abs(client.position.y - server.position.y);
  const catchUp = advanceFixedStep(0, hiddenTicks * FIXED_DT, FIXED_DT, MAX_FRAME_DELTA, MAX_CATCH_UP_TICKS);
  let resumeCatchUpTicks = 0;
  let droppedSeconds = catchUp.droppedSeconds;
  let serverInputBurst = 0;

  if (options.policy === 'legacy') {
    resumeCatchUpTicks = catchUp.ticks;
    const catchUpMove = options.clearKeysOnHide === false ? held : idle;
    for (let i = 0; i < catchUp.ticks; i += 1) {
      seq += 1;
      lastSeq = seq;
      lastInput = catchUpMove;
      predictLocalMove(client, world, buffer, predictedMoveFromInput(seq, catchUpMove, { yaw: 0, pitch: 0 }, true));
      serverInputBurst += 1;
    }
    if (pending) reconcilePredictedPlayer(client, world, buffer, pending, undefined, { physicsTicks: 1 });
  } else {
    resumeCatchUpTicks = 0;
    droppedSeconds = 0;
    if (pending) {
      const yaw = client.yaw;
      const pitch = client.pitch;
      const synced = resyncLocalPlayerAfterHiddenTab({
        player: client,
        buffer,
        snapshot: pending,
        inputSeq: seq,
      });
      seq = synced.nextInputSeq;
      expect(client.yaw).toBe(yaw);
      expect(client.pitch).toBe(pitch);
    }
  }

  let correctionsAfterResume = 0;
  let snapsAfterResume = 0;
  let firstCorrectionDist = 0;
  const resumeMove = options.clearKeysOnHide === false || options.policy === 'resume' ? held : idle;
  for (let i = 0; i < resumeTicks; i += 1) {
    seq += 1;
    lastSeq = seq;
    lastInput = resumeMove;
    predictLocalMove(client, world, buffer, predictedMoveFromInput(seq, resumeMove, { yaw: 0, pitch: 0 }, true));
    server.tick(world, source(resumeMove), FIXED_DT);
    const result = reconcilePredictedPlayer(
      client,
      world,
      buffer,
      snapshotOf(server, seq),
      undefined,
      { physicsTicks: 1 },
    );
    if (result.kind === 'corrected' || result.kind === 'snapped') {
      if (correctionsAfterResume === 0) firstCorrectionDist = Math.sqrt(result.error.distSq);
      correctionsAfterResume += 1;
      if (result.kind === 'snapped') snapsAfterResume += 1;
    }
  }

  return {
    clientTicksWhileHidden,
    clientInputsWhileHidden,
    serverTicksWhileHidden: hiddenTicks,
    snapshotsWhileHidden,
    pendingSlots: pending ? 1 : 0,
    uniquePendingSeqs: pendingSeqs.size,
    duplicateSeqIgnored: inspect?.rejectReason === 'duplicate-seq',
    poseGapAtResume,
    resumeCatchUpTicks,
    droppedSeconds,
    correctionsAfterResume,
    snapsAfterResume,
    serverInputBurst,
    firstCorrectionDist,
  };
}

describe('hidden-tab page visibility', () => {
  it('pauses local prediction while BACKGROUND and does not pause PLAYING', () => {
    expect(worldSimulationActive('BACKGROUND')).toBe(false);
    expect(worldSimulationActive('PLAYING')).toBe(true);
    expect(shouldPausePrediction('BACKGROUND')).toBe(true);
    expect(shouldPausePrediction('PLAYING')).toBe(false);
  });

  it('sends idle on hide and resyncs on resume only for online PLAYING', () => {
    expect(evaluateHiddenTabResume({
      previousLifecycle: 'PLAYING', nextLifecycle: 'BACKGROUND', online: true,
    })).toMatchObject({ sendIdleOnHide: true, reason: 'hide-idle' });
    expect(evaluateHiddenTabResume({
      previousLifecycle: 'BACKGROUND', nextLifecycle: 'PLAYING', online: true,
    })).toMatchObject({ resetClockOnResume: true, forceAuthoritativeResync: true, reason: 'resume-resync' });
    expect(evaluateHiddenTabResume({
      previousLifecycle: 'PAUSED', nextLifecycle: 'BACKGROUND', online: true,
    }).sendIdleOnHide).toBe(false);
    expect(evaluateHiddenTabResume({
      previousLifecycle: 'BACKGROUND', nextLifecycle: 'PAUSED', online: true,
    })).toMatchObject({ resetClockOnResume: true, forceAuthoritativeResync: false });
  });

  it('clamps a 2s RAF freeze to 4 catch-up ticks and drops the rest', () => {
    const step = advanceFixedStep(0, 2.0);
    expect(step.elapsed).toBe(MAX_FRAME_DELTA);
    expect(step.ticks).toBe(MAX_CATCH_UP_TICKS);
    expect(step.ticks).toBe(maxResumeCatchUpTicks());
    expect(step.ticks).toBeLessThan(Math.floor(2 / FIXED_DT));
    expect(step.droppedSeconds).toBeGreaterThan(0);
  });

  it('legacy hide: 0 client ticks/inputs, server keeps walking, duplicate-seq ignores the frozen pose', () => {
    const result = simulateHiddenTab({
      policy: 'legacy',
      hiddenTicks: 40,
      clearKeysOnHide: true,
    });
    expect(result.clientTicksWhileHidden).toBe(0);
    expect(result.clientInputsWhileHidden).toBe(0);
    expect(result.serverTicksWhileHidden).toBe(40);
    expect(result.snapshotsWhileHidden).toBe(40);
    expect(result.pendingSlots).toBe(1);
    expect(result.uniquePendingSeqs).toBe(1);
    expect(result.duplicateSeqIgnored).toBe(true);
    expect(result.poseGapAtResume).toBeGreaterThan(hiddenServerTravelMeters(2) * 0.5);
    expect(result.resumeCatchUpTicks).toBe(MAX_CATCH_UP_TICKS);
    expect(result.droppedSeconds).toBeGreaterThan(0);
    expect(result.serverInputBurst).toBe(MAX_CATCH_UP_TICKS);
    expect(result.correctionsAfterResume).toBeGreaterThan(0);
    expect(result.firstCorrectionDist).toBeGreaterThan(0.2);
  });

  it('resume policy: one idle while hidden, no catch-up, no correction storm', () => {
    const result = simulateHiddenTab({
      policy: 'resume',
      hiddenTicks: 40,
      clearKeysOnHide: true,
    });
    expect(result.clientInputsWhileHidden).toBe(1);
    expect(result.clientTicksWhileHidden).toBe(1);
    expect(result.snapshotsWhileHidden).toBe(40);
    expect(result.pendingSlots).toBe(1);
    expect(result.resumeCatchUpTicks).toBe(0);
    expect(result.serverInputBurst).toBe(0);
    expect(result.correctionsAfterResume).toBe(0);
    expect(result.snapsAfterResume).toBe(0);
    expect(result.poseGapAtResume).toBeLessThan(0.05);
  });

  it('repeats the owner walk hide/show five times without a correction storm', () => {
    for (let trial = 0; trial < 5; trial += 1) {
      const result = simulateHiddenTab({ policy: 'resume', hiddenTicks: 40 });
      expect(result.correctionsAfterResume, `trial ${trial}`).toBe(0);
      expect(result.clientInputsWhileHidden).toBe(1);
      expect(result.resumeCatchUpTicks).toBe(0);
    }
  });

  it('flight + SHIFT hide/show resyncs without corrections', () => {
    const legacy = simulateHiddenTab({
      policy: 'legacy',
      movement: flyDescend,
      flying: true,
      clearKeysOnHide: true,
      hiddenTicks: 40,
    });
    expect(legacy.poseGapAtResume).toBeGreaterThan(1);
    expect(legacy.correctionsAfterResume).toBeGreaterThan(0);

    const fixed = simulateHiddenTab({
      policy: 'resume',
      movement: flyDescend,
      flying: true,
      hiddenTicks: 40,
    });
    expect(fixed.correctionsAfterResume).toBe(0);
    expect(fixed.resumeCatchUpTicks).toBe(0);
  });
});

describe('page visibility probe', () => {
  it('logs hidden/visible counters and F3 lines', () => {
    const probe = new PageVisibilityProbe();
    probe.notifyHidden(1000, {
      predSeq: 20, ackSeq: 18, pending: 2, accumulator: 0.01, alpha: 0.2,
    });
    expect(probe.visibility).toBe('hidden');
    probe.noteInputSent(1100);
    probe.noteTick(1100);
    probe.noteSnapshot(snapshotOf(new PlayerController({ position: [0.5, 1, 0.5] }), 20), 1200);
    probe.noteFrame(1.0, 1300);
    expect(probe.inputsWhileHidden).toBe(1);
    expect(probe.ticksWhileHidden).toBe(1);
    expect(probe.snapshotsWhileHidden).toBe(1);
    expect(probe.lastHiddenFrameDeltaMs).toBe(1000);

    probe.notifyVisible(3000, {
      predSeq: 21, ackSeq: 20, pending: 0, accumulator: 0, alpha: 0,
    });
    expect(probe.lastHiddenDurationMs).toBe(2000);
    expect(probe.formatHud()).toContain('visibility=visible');
    expect(probe.formatHud()).toContain('focus=1');
    expect(probe.formatHud()).toContain('hiddenDurationMs=2000');
    expect(probe.formatHud()).toContain('resumeTicks=0');
    expect(probe.formatHud()).toContain('resumeSnapshots=0');

    for (let i = 0; i < 20; i += 1) probe.noteFrame(1 / 60, 3000 + i);
    probe.noteTick(3050);
    probe.noteSnapshot(snapshotOf(new PlayerController({ position: [0.5, 1, 0.5] }), 21), 3100);
    expect(probe.resumeFrameDeltas.length).toBe(20);
    expect(probe.ticksAfterResume).toBe(1);
    expect(probe.snapshotsAfterResume).toBe(1);
    const rates = probe.hiddenRates(2000);
    expect(rates.inputsPerSec).toBeCloseTo(0.5, 5);
    expect(rates.ticksPerSec).toBeCloseTo(0.5, 5);
    expect(rates.snapsPerSec).toBeCloseTo(0.5, 5);
  });

  it('does not treat a second hidden notification as a new hide', () => {
    const probe = new PageVisibilityProbe();
    probe.notifyHidden(1, { predSeq: 1, ackSeq: 1, pending: 0, accumulator: 0, alpha: 0 });
    probe.noteInputSent();
    probe.notifyHidden(2, { predSeq: 9, ackSeq: 9, pending: 0, accumulator: 0, alpha: 0 });
    expect(probe.inputsWhileHidden).toBe(1);
    expect(probe.localPredSeq).toBe(1);
  });
});
