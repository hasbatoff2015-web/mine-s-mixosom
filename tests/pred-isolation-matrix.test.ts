import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT, WALK_SPEED } from '../src/core/constants';
import { advanceFixedStep } from '../src/core/fixedStep';
import { LocalPlayerRenderState } from '../src/core/localPlayerRenderState';
import type { MoveInput } from '../src/input/MoveInput';
import { motionProbe } from '../src/net/localMotionDiagnostics';
import {
  captureMotionFull,
  diffMotionFull,
  formatFirstBadEvent,
  formatMotionFieldMutation,
  localNetTrace,
} from '../src/net/localPlayerNetTrace';
import {
  applyPredictedTick,
  createPredictionBuffer,
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

const walk: MoveInput = { forward: 1, right: 0, jump: false, sprint: false, sneak: false };

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -32; z <= 32; z += 1) {
    for (let x = -32; x <= 32; x += 1) world.set(x, 0, z, BlockId.Stone);
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
    gamemode: 'survival',
    sneaking: player.sneaking,
    sprinting: player.sprinting,
    onGround: player.onGround,
    selectedSlot: 0,
    flying: player.isFlying,
    inputSeq: seq,
  };
}

function grounded(world: VoxelWorld): PlayerController {
  const player = new PlayerController({ position: [0.5, 1, 0.5] });
  player.tick(world, { yaw: 0, pitch: 0, movement: () => ({ ...walk, forward: 0 }) }, FIXED_DT);
  return player;
}

interface ModeStats {
  ticks: number;
  sends: number;
  states: number;
  accepts: number;
  corrections: number;
  snaps: number;
  ignored: number;
  acceptMutations: number;
  meanStep: number;
  maxStep: number;
  negative: number;
  large: number;
}

type IsolationMode = 'normal' | 'noState' | 'noSend' | 'noNet';

function runMode(mode: IsolationMode, seconds = 2, frameDt = 1 / 60): ModeStats {
  const world = flatWorld() as unknown as VoxelWorld;
  const client = grounded(world);
  const server = grounded(world);
  const buffer: PredictionBuffer = createPredictionBuffer();
  buffer.lastAckedSeq = 0;
  const render = new LocalPlayerRenderState();
  render.reset({
    x: client.position.x, y: client.position.y, z: client.position.z,
    vx: client.velocity.x, vy: client.velocity.y, vz: client.velocity.z,
  });
  let accumulator = 0;
  let seq = 0;
  let lastInput = predictedMoveFromInput(0, walk, { yaw: 0, pitch: 0 }, true);
  let serverAcc = 0;
  const applyState = mode === 'normal' || mode === 'noSend';
  const send = mode === 'normal' || mode === 'noState';
  const stats = {
    ticks: 0,
    sends: 0,
    states: 0,
    accepts: 0,
    corrections: 0,
    snaps: 0,
    ignored: 0,
    acceptMutations: 0,
  };
  const samples: Array<{ x: number; z: number }> = [];

  const flushServer = (): void => {
    serverAcc += FIXED_DT;
    if (serverAcc + 1e-12 < FIXED_DT) return;
    serverAcc -= FIXED_DT;
    if (send) applyPredictedTick(server, world, lastInput);
    else applyPredictedTick(server, world, predictedMoveFromInput(0, { ...walk, forward: 0 }, { yaw: 0, pitch: 0 }, true));
    if (!applyState) return;
    stats.states += 1;
    const before = captureMotionFull(client);
    const result = reconcilePredictedPlayer(client, world, buffer, snapshotOf(server, send ? lastInput.seq : 0));
    if (result.kind === 'accepted') {
      stats.accepts += 1;
      if (diffMotionFull(before, captureMotionFull(client)).length > 0) stats.acceptMutations += 1;
    } else if (result.kind === 'corrected') stats.corrections += 1;
    else if (result.kind === 'snapped') stats.snaps += 1;
    else stats.ignored += 1;
  };

  for (let time = 0; time < seconds; time += frameDt) {
    const stepped = advanceFixedStep(accumulator, frameDt);
    accumulator = stepped.nextAccumulator;
    for (let i = 0; i < stepped.ticks; i += 1) {
      seq += 1;
      lastInput = predictedMoveFromInput(seq, walk, { yaw: 0, pitch: 0 }, true);
      if (send) stats.sends += 1;
      predictLocalMove(client, world, buffer, lastInput);
      render.pushAfterTick({
        x: client.position.x, y: client.position.y, z: client.position.z,
        vx: client.velocity.x, vy: client.velocity.y, vz: client.velocity.z,
      });
      stats.ticks += 1;
      flushServer();
    }
    const sampled = render.sample(accumulator);
    samples.push({ x: sampled.x, z: sampled.z });
  }

  const deltas: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    deltas.push(Math.hypot(samples[i]!.x - samples[i - 1]!.x, samples[i]!.z - samples[i - 1]!.z));
  }
  const meanStep = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
  return {
    ...stats,
    meanStep,
    maxStep: Math.max(0, ...deltas),
    negative: 0,
    large: deltas.filter((value) => value > WALK_SPEED * frameDt * 2.5).length,
  };
}

describe('pred isolation 4-mode matrix', () => {
  it('normal lockstep accepts without mutating live motion', () => {
    const normal = runMode('normal');
    expect(normal.sends).toBe(normal.ticks);
    expect(normal.states).toBeGreaterThan(0);
    expect(normal.corrections).toBe(0);
    expect(normal.acceptMutations).toBe(0);
    expect(normal.maxStep).toBeLessThan(WALK_SPEED * (1 / 60) * 2.5);
  });

  it('predNoState keeps sending and matches noNet render', () => {
    const noState = runMode('noState');
    const noNet = runMode('noNet');
    expect(noState.sends).toBe(noState.ticks);
    expect(noState.states).toBe(0);
    expect(noNet.sends).toBe(0);
    expect(noNet.states).toBe(0);
    expect(Math.abs(noState.meanStep - noNet.meanStep)).toBeLessThan(0.002);
    expect(noState.corrections).toBe(0);
    expect(noNet.corrections).toBe(0);
  });

  it('predNoSend still receives idle snapshots; duplicates must not rewind a walking predictor', () => {
    const noSend = runMode('noSend');
    const noNet = runMode('noNet');
    expect(noSend.sends).toBe(0);
    expect(noSend.states).toBeGreaterThan(0);
    expect(noSend.corrections).toBe(0);
    expect(noSend.acceptMutations).toBe(0);
    expect(Math.abs(noSend.meanStep - noNet.meanStep)).toBeLessThan(0.002);
  });

  it('predNoNet equals send+state isolation (no snapshots, no sends)', () => {
    const noNet = runMode('noNet');
    expect(noNet.sends).toBe(0);
    expect(noNet.states).toBe(0);
    expect(noNet.corrections).toBe(0);
  });
});

describe('incoming player_state velocity/flag mismatch', () => {
  it('normal Online matching-pose snapshots with wrong vy do not rewind or jitter render', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = grounded(world);
    const server = grounded(world);
    const buffer: PredictionBuffer = createPredictionBuffer();
    buffer.lastAckedSeq = 0;
    const render = new LocalPlayerRenderState();
    render.reset({
      x: client.position.x, y: client.position.y, z: client.position.z,
      vx: client.velocity.x, vy: client.velocity.y, vz: client.velocity.z,
    });
    let accumulator = 0;
    let seq = 0;
    let lastInput = predictedMoveFromInput(0, walk, { yaw: 0, pitch: 0 }, true);
    let corrections = 0;
    let acceptMutations = 0;
    let accepts = 0;
    const samples: number[] = [];
    for (let time = 0; time < 2; time += 1 / 60) {
      const stepped = advanceFixedStep(accumulator, 1 / 60);
      accumulator = stepped.nextAccumulator;
      for (let i = 0; i < stepped.ticks; i += 1) {
        seq += 1;
        lastInput = predictedMoveFromInput(seq, walk, { yaw: 0, pitch: 0 }, true);
        predictLocalMove(client, world, buffer, lastInput);
        applyPredictedTick(server, world, lastInput);
        const snap = { ...snapshotOf(server, lastInput.seq), vy: server.velocity.y + 7.5 };
        const before = captureMotionFull(client);
        const result = reconcilePredictedPlayer(client, world, buffer, snap);
        if (result.kind === 'accepted') {
          accepts += 1;
          if (diffMotionFull(before, captureMotionFull(client)).length > 0) acceptMutations += 1;
        } else if (result.kind === 'corrected' || result.kind === 'snapped') corrections += 1;
        render.pushAfterTick({
          x: client.position.x, y: client.position.y, z: client.position.z,
          vx: client.velocity.x, vy: client.velocity.y, vz: client.velocity.z,
        });
      }
      samples.push(render.sample(accumulator).z);
    }
    expect(accepts).toBeGreaterThan(0);
    expect(corrections).toBe(0);
    expect(acceptMutations).toBe(0);
    const deltas: number[] = [];
    for (let i = 1; i < samples.length; i += 1) {
      deltas.push(Math.abs(samples[i]! - samples[i - 1]!));
    }
    expect(Math.max(0, ...deltas)).toBeLessThan(WALK_SPEED * (1 / 60) * 2.5);
  });
});

describe('accepted snapshot invisibility', () => {
  it('matching ack leaves every local motion field untouched', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = grounded(world);
    const buffer = createPredictionBuffer();
    for (let seq = 1; seq <= 4; seq += 1) {
      predictLocalMove(player, world, buffer, predictedMoveFromInput(seq, walk, { yaw: 0, pitch: 0 }, true));
    }
    const before = captureMotionFull(player);
    const ack = snapshotOf(player, 2);
    const lookChanged = {
      ...ack,
      yaw: player.yaw + 0.5,
      pitch: player.pitch - 0.2,
    };
    const result = reconcilePredictedPlayer(player, world, buffer, {
      ...lookChanged,
      x: buffer.entries.find((entry) => entry.seq === 2)!.state.x,
      y: buffer.entries.find((entry) => entry.seq === 2)!.state.y,
      z: buffer.entries.find((entry) => entry.seq === 2)!.state.z,
      vx: buffer.entries.find((entry) => entry.seq === 2)!.state.vx,
      vy: buffer.entries.find((entry) => entry.seq === 2)!.state.vy,
      vz: buffer.entries.find((entry) => entry.seq === 2)!.state.vz,
      onGround: buffer.entries.find((entry) => entry.seq === 2)!.state.onGround,
      flying: buffer.entries.find((entry) => entry.seq === 2)!.state.isFlying,
    });
    expect(result.kind).toBe('accepted');
    expect(result.acceptMutated).toBe(false);
    expect(diffMotionFull(before, captureMotionFull(player))).toEqual([]);
  });
});

describe('first bad event capture', () => {
  it('dumps the first online render jump with mutation context', () => {
    motionProbe.reset();
    localNetTrace.reset();
    motionProbe.recordRender({
      now: 1000,
      online: true,
      fps: 60,
      ticks: 1,
      alpha: 0.2,
      position: { x: 0, y: 1, z: 0 },
      previous: { x: 0, y: 1, z: -0.2 },
      render: { x: 0, y: 1, z: 0 },
    });
    localNetTrace.noteMutation({
      at: 1008,
      source: 'player_state:corrected',
      frameIndex: 1,
      changed: ['x', 'z'],
      before: captureMotionFull(grounded(flatWorld() as unknown as VoxelWorld)),
      after: captureMotionFull(grounded(flatWorld() as unknown as VoxelWorld)),
    });
    motionProbe.recordRender({
      now: 1016,
      online: true,
      fps: 60,
      ticks: 1,
      alpha: 0.2,
      position: { x: 0, y: 1, z: 0.4 },
      previous: { x: 0, y: 1, z: 0 },
      render: { x: 0, y: 1, z: 0.4 },
    });
    expect(localNetTrace.firstBadEvent).toBeDefined();
    expect(localNetTrace.firstBadEvent!.renderDelta).toBeGreaterThan(0.12);
    expect(localNetTrace.firstBadEvent!.mutations.some((entry) => entry.source.includes('player_state'))).toBe(true);
    expect(formatFirstBadEvent(localNetTrace.firstBadEvent!)).toContain('frame=');
    expect(formatFirstBadEvent(localNetTrace.firstBadEvent!)).toContain('soft=');
  });
});

describe('player_state field mutation log', () => {
  it('prints source, field, old, new, seq, and timestamp', () => {
    const text = formatMotionFieldMutation({
      source: 'player_state:accepted',
      field: 'vy',
      oldValue: -7.5,
      newValue: 0,
      inputSeq: 12,
      predictedSeq: 18,
      at: 1234.5,
    });
    expect(text).toContain('[player_state:accepted]');
    expect(text).toContain('vy');
    expect(text).toContain('-7.5');
    expect(text).toContain('0');
    expect(text).toContain('snapshot inputSeq=12');
    expect(text).toContain('local predicted seq=18');
    expect(text).toContain('timestamp=1234.500');
  });
});
