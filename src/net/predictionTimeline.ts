import { FIXED_DT, WALK_SPEED } from '../core/constants';
import type { MoveInput } from '../input/MoveInput';
import { PlayerController, type PlayerMovementState } from '../player/PlayerController';
import type { VoxelWorld } from '../world/World';
import type { PlayerSnapshot } from '../../shared/protocol';
import {
  applyPredictedTick,
  createPredictionBuffer,
  predictedMoveFromInput,
  predictLocalMove,
  predictedStateFromCheckpoint,
  seedPredictionCheckpoint,
  simulationTicksFromServerTick,
  type PredictedMove,
  type PredictionBuffer,
} from './localPlayerPrediction';

const idle: MoveInput = {
  forward: 0, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false,
};

export function walkStep(): number {
  return WALK_SPEED * FIXED_DT;
}

export interface TimelineMove {
  readonly forward?: number;
  readonly right?: number;
  readonly jump?: boolean;
  readonly sneak?: boolean;
  readonly sprint?: boolean;
  readonly descend?: boolean;
  readonly flySprint?: boolean;
  readonly yaw?: number;
  readonly pitch?: number;
}

function toMove(input: TimelineMove): MoveInput {
  return {
    ...idle,
    forward: input.forward ?? 0,
    right: input.right ?? 0,
    jump: input.jump === true,
    sneak: input.sneak === true,
    sprint: input.sprint === true,
    descend: input.descend === true,
    flySprint: input.flySprint === true,
  };
}

export interface TimelineSample {
  readonly clientPredTick: number;
  readonly inputSeqLocal: number;
  readonly serverTick: number;
  readonly inputSeqServer: number;
  readonly physicsTicks: number;
  readonly seqGap: number;
  readonly client: PlayerMovementState;
  readonly server: PlayerMovementState;
  readonly historyAtInputSeq: PlayerMovementState | undefined;
  readonly checkpoint: PlayerMovementState;
  readonly historyDist: number;
  readonly checkpointDist: number;
  readonly historyWouldCorrect: boolean;
  readonly checkpointWouldCorrect: boolean;
}

export interface TimelineResult {
  readonly samples: TimelineSample[];
  readonly historyCorrections: number;
  readonly checkpointCorrections: number;
  readonly firstHistoryCorrection: TimelineSample | undefined;
  readonly firstCheckpointCorrection: TimelineSample | undefined;
}

class FlatTimelineWorld {
  getBlock(_x: number, y: number, _z: number): number {
    if (y < 0) return 7;
    if (y === 0) return 1;
    return 0;
  }

  getBlockState(): undefined {
    return undefined;
  }

  isSolid(_x: number, y: number, _z: number): boolean {
    return y <= 0;
  }
}

function poseError(a: PlayerMovementState, b: PlayerMovementState): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function snapshotOf(player: PlayerController, inputSeq: number): PlayerSnapshot {
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
    gamemode: 'survival',
    sneaking: player.sneaking,
    sprinting: player.sprinting,
    onGround: player.onGround,
    selectedSlot: 0,
    flying: player.isFlying,
    inputSeq,
  };
}

function controller(flying: boolean, y: number): PlayerController {
  const player = new PlayerController({ position: [0.5, y, 0.5] });
  if (flying) {
    player.creativeFlightAllowed = true;
    player.isFlying = true;
  }
  return player;
}

export interface TimelineOptions {
  /** Seq batches delivered to the server before each server physics tick. */
  readonly deliveries: readonly (readonly number[])[];
  readonly input?: TimelineMove;
  readonly flying?: boolean;
  readonly startY?: number;
  readonly warmup?: number;
  readonly acceptXz?: number;
  readonly acceptY?: number;
}

/**
 * Client predicts one physics tick per input seq. Server simulates one physics
 * tick per delivery batch using only the latest received input state.
 *
 * `deliveries: [[544], [545]]` is 1:1. `[[544, 545]]` is the owner dump:
 * seq=545, gap=2, physicsTicks=1.
 */
export function runLatestInputTimeline(options: TimelineOptions): TimelineResult {
  const world = new FlatTimelineWorld() as unknown as VoxelWorld;
  const flying = options.flying === true;
  const startY = options.startY ?? (flying ? 8 : 1);
  const client = controller(flying, startY);
  const server = controller(flying, startY);
  const settle = toMove({});
  client.tick(world, {
    yaw: 0, pitch: 0, locomotion: true,
    movement: () => settle,
  }, FIXED_DT);
  server.tick(world, {
    yaw: 0, pitch: 0, locomotion: true,
    movement: () => settle,
  }, FIXED_DT);
  if (flying) {
    client.creativeFlightAllowed = true;
    server.creativeFlightAllowed = true;
    client.isFlying = true;
    server.isFlying = true;
    client.velocity.set(0, 0, 0);
    server.velocity.set(0, 0, 0);
  }

  const buffer: PredictionBuffer = createPredictionBuffer();
  seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
  const warmup = options.warmup ?? 0;
  const move = toMove(options.input ?? { forward: 1 });
  let seq = 0;
  let lastMove: PredictedMove | undefined;
  let lastAckedSeq = buffer.lastAckedSeq;

  for (let i = 0; i < warmup; i += 1) {
    seq += 1;
    lastMove = predictedMoveFromInput(seq, move, { yaw: options.input?.yaw ?? 0, pitch: options.input?.pitch ?? 0 }, true);
    predictLocalMove(client, world, buffer, lastMove);
    applyPredictedTick(server, world, lastMove);
    seedPredictionCheckpoint(buffer, server.captureMovementState(), i + 1);
    buffer.lastAckedSeq = seq;
    buffer.entries = buffer.entries.filter((entry) => entry.seq > seq);
    lastAckedSeq = seq;
  }

  const allSeqs = options.deliveries.flat();
  const predicted = new Map<number, PredictedMove>();
  const samples: TimelineSample[] = [];
  const acceptXz = options.acceptXz ?? 0.03;
  const acceptY = options.acceptY ?? 0.05;
  let checkpoint = server.captureMovementState();
  let checkpointTick = warmup;
  let serverTick = warmup;

  for (const seq of allSeqs) {
    if (predicted.has(seq)) continue;
    const packet = predictedMoveFromInput(
      seq,
      move,
      { yaw: options.input?.yaw ?? 0, pitch: options.input?.pitch ?? 0 },
      true,
    );
    predicted.set(seq, packet);
    predictLocalMove(client, world, buffer, packet);
    lastMove = packet;
  }

  let deliveredMax = lastAckedSeq;
  for (const batch of options.deliveries) {
    if (batch.length === 0) continue;
    const latest = batch[batch.length - 1]!;
    const latestMove = predicted.get(latest);
    if (!latestMove) continue;
    applyPredictedTick(server, world, latestMove);
    serverTick += 1;
    deliveredMax = Math.max(deliveredMax, latest);
    const physicsTicks = 1;
    const seqGap = latest - lastAckedSeq;
    const historyEntry = buffer.entries.find((entry) => entry.seq === latest);
    const simTicks = simulationTicksFromServerTick(checkpointTick, serverTick, physicsTicks);
    const comparable = predictedStateFromCheckpoint(world, checkpoint, latestMove, simTicks, {
      creativeFlightAllowed: flying,
    });
    const serverState = server.captureMovementState();
    const clientState = client.captureMovementState();
    const historyDist = historyEntry ? poseError(historyEntry.state, serverState) : Number.NaN;
    const checkpointDist = poseError(comparable, serverState);
    const sample: TimelineSample = {
      clientPredTick: buffer.nextPredTick,
      inputSeqLocal: lastMove?.seq ?? latest,
      serverTick,
      inputSeqServer: latest,
      physicsTicks,
      seqGap,
      client: clientState,
      server: serverState,
      historyAtInputSeq: historyEntry?.state,
      checkpoint: comparable,
      historyDist,
      checkpointDist,
      historyWouldCorrect: !Number.isFinite(historyDist)
        || Math.hypot(historyEntry!.state.x - serverState.x, historyEntry!.state.z - serverState.z) > acceptXz
        || Math.abs((historyEntry?.state.y ?? 0) - serverState.y) > acceptY,
      checkpointWouldCorrect: Math.hypot(comparable.x - serverState.x, comparable.z - serverState.z) > acceptXz
        || Math.abs(comparable.y - serverState.y) > acceptY,
    };
    samples.push(sample);
    checkpoint = serverState;
    checkpointTick = serverTick;
    lastAckedSeq = latest;
  }

  return {
    samples,
    historyCorrections: samples.filter((sample) => sample.historyWouldCorrect).length,
    checkpointCorrections: samples.filter((sample) => sample.checkpointWouldCorrect).length,
    firstHistoryCorrection: samples.find((sample) => sample.historyWouldCorrect),
    firstCheckpointCorrection: samples.find((sample) => sample.checkpointWouldCorrect),
  };
}

/** Owner dump: lastAck=543, seq=545, gap=2, physicsTicks=1. */
export function ownerWalkGap2Timeline(): TimelineResult {
  const warmup = 3;
  return runLatestInputTimeline({
    warmup,
    input: { forward: 1 },
    deliveries: [[warmup + 1, warmup + 2]],
  });
}

export function formatTimelineSample(sample: TimelineSample): string {
  return (
    `seq=${sample.inputSeqServer} lastAckGap=${sample.seqGap} serverTick=${sample.serverTick} `
    + `phys=${sample.physicsTicks} histDist=${sample.historyDist.toFixed(4)} `
    + `ckptDist=${sample.checkpointDist.toFixed(4)} `
    + `histCorr=${sample.historyWouldCorrect} ckptCorr=${sample.checkpointWouldCorrect}`
  );
}

export { snapshotOf };
