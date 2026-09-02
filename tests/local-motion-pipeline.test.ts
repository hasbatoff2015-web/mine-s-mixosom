import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import { advanceFixedStep } from '../src/core/fixedStep';
import type { MoveInput } from '../src/input/MoveInput';
import {
  applyPredictedTick,
  createPredictionBuffer,
  predictedMoveFromInput,
  predictLocalMove,
  reconcilePredictedPlayer,
  type PredictedMove,
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface FrameSample {
  ticks: number;
  alpha: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  renderX: number;
  renderZ: number;
  distPrev: number;
}

interface RunStats {
  samples: FrameSample[];
  ticks: number;
  snapshots: number;
  accepts: number;
  corrections: number;
  snaps: number;
  ignored: number;
  acceptMutations: number;
  collapsedLerp: number;
}

function sampleFrame(player: PlayerController, ticks: number, alpha: number): FrameSample {
  return {
    ticks,
    alpha,
    x: player.position.x,
    z: player.position.z,
    prevX: player.previousPosition.x,
    prevZ: player.previousPosition.z,
    renderX: lerp(player.previousPosition.x, player.position.x, alpha),
    renderZ: lerp(player.previousPosition.z, player.position.z, alpha),
    distPrev: Math.hypot(
      player.position.x - player.previousPosition.x,
      player.position.z - player.previousPosition.z,
    ),
  };
}

function statsOf(run: RunStats) {
  const moving = run.samples.filter((sample) => sample.distPrev > 1e-4);
  const renderSteps = [];
  for (let i = 1; i < run.samples.length; i += 1) {
    const dx = run.samples[i]!.renderX - run.samples[i - 1]!.renderX;
    const dz = run.samples[i]!.renderZ - run.samples[i - 1]!.renderZ;
    renderSteps.push(Math.hypot(dx, dz));
  }
  const mean = renderSteps.reduce((sum, value) => sum + value, 0) / Math.max(1, renderSteps.length);
  const variance = renderSteps.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / Math.max(1, renderSteps.length);
  const maxStep = Math.max(0, ...renderSteps);
  const zeroLerpWhileMoving = moving.filter((sample) => sample.distPrev < 1e-6).length;
  const ticksPerFrame = run.samples.map((sample) => sample.ticks);
  const multiTickFrames = ticksPerFrame.filter((ticks) => ticks > 1).length;
  return {
    ticks: run.ticks,
    snapshots: run.snapshots,
    accepts: run.accepts,
    corrections: run.corrections,
    snaps: run.snaps,
    ignored: run.ignored,
    acceptMutations: run.acceptMutations,
    collapsedLerp: run.collapsedLerp,
    meanStep: mean,
    stdStep: Math.sqrt(variance),
    maxStep,
    zeroLerpWhileMoving,
    multiTickFrames,
  };
}

function grounded(world: VoxelWorld): PlayerController {
  const player = new PlayerController({ position: [0.5, 1, 0.5] });
  player.tick(world, { yaw: 0, pitch: 0, movement: () => ({ ...walk, forward: 0 }) }, FIXED_DT);
  return player;
}

function runSingleplayer(seconds: number, frameDt: number): RunStats {
  const world = flatWorld() as unknown as VoxelWorld;
  const player = grounded(world);
  let accumulator = 0;
  const samples: FrameSample[] = [];
  let ticks = 0;
  for (let time = 0; time < seconds; time += frameDt) {
    const stepped = advanceFixedStep(accumulator, frameDt);
    accumulator = stepped.nextAccumulator;
    for (let i = 0; i < stepped.ticks; i += 1) {
      player.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
      ticks += 1;
    }
    samples.push(sampleFrame(player, stepped.ticks, accumulator / FIXED_DT));
  }
  return {
    samples, ticks, snapshots: 0, accepts: 0, corrections: 0, snaps: 0, ignored: 0,
    acceptMutations: 0, collapsedLerp: 0,
  };
}

function reconcileCounted(
  client: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  counters: RunStats,
): void {
  const before = {
    x: client.position.x,
    y: client.position.y,
    z: client.position.z,
    px: client.previousPosition.x,
    py: client.previousPosition.y,
    pz: client.previousPosition.z,
    vx: client.velocity.x,
    vy: client.velocity.y,
    vz: client.velocity.z,
  };
  const distPrevBefore = Math.hypot(
    client.position.x - client.previousPosition.x,
    client.position.z - client.previousPosition.z,
  );
  const result = reconcilePredictedPlayer(client, world, buffer, snapshot);
  const distPrevAfter = Math.hypot(
    client.position.x - client.previousPosition.x,
    client.position.z - client.previousPosition.z,
  );
  if (result.kind === 'accepted') {
    counters.accepts += 1;
    if (
      client.position.x !== before.x
      || client.position.y !== before.y
      || client.position.z !== before.z
      || client.previousPosition.x !== before.px
      || client.previousPosition.y !== before.py
      || client.previousPosition.z !== before.pz
      || client.velocity.x !== before.vx
      || client.velocity.y !== before.vy
      || client.velocity.z !== before.vz
    ) counters.acceptMutations += 1;
  } else if (result.kind === 'corrected') {
    counters.corrections += 1;
    if (distPrevBefore > 1e-4 && distPrevAfter < 1e-6) counters.collapsedLerp += 1;
  } else if (result.kind === 'snapped') counters.snaps += 1;
  else counters.ignored += 1;
}

function runOnline(options: {
  seconds: number;
  frameDt: number;
  serverDt: number;
  mode: 'lockstep' | 'coalesce' | 'queue';
  serverPhase?: number;
}): RunStats {
  const world = flatWorld() as unknown as VoxelWorld;
  const client = grounded(world);
  const server = grounded(world);
  const buffer: PredictionBuffer = createPredictionBuffer();
  let accumulator = 0;
  let seq = 0;
  const pendingInputs: PredictedMove[] = [];
  let lastInput = predictedMoveFromInput(0, walk, { yaw: 0, pitch: 0 }, true);
  let serverAcc = options.serverPhase ?? 0;
  const counters: RunStats = {
    samples: [],
    ticks: 0,
    snapshots: 0,
    accepts: 0,
    corrections: 0,
    snaps: 0,
    ignored: 0,
    acceptMutations: 0,
    collapsedLerp: 0,
  };

  const flushServer = (dt: number): void => {
    serverAcc += dt;
    while (serverAcc + 1e-12 >= options.serverDt) {
      serverAcc -= options.serverDt;
      if (options.mode === 'queue') {
        const next = pendingInputs.shift();
        if (!next) continue;
        lastInput = next;
        applyPredictedTick(server, world, next);
        counters.snapshots += 1;
        reconcileCounted(client, world, buffer, snapshotOf(server, next.seq), counters);
      } else {
        applyPredictedTick(server, world, lastInput);
        counters.snapshots += 1;
        reconcileCounted(client, world, buffer, snapshotOf(server, lastInput.seq), counters);
      }
    }
  };

  for (let time = 0; time < options.seconds; time += options.frameDt) {
    const stepped = advanceFixedStep(accumulator, options.frameDt);
    accumulator = stepped.nextAccumulator;
    for (let i = 0; i < stepped.ticks; i += 1) {
      seq += 1;
      lastInput = predictedMoveFromInput(seq, walk, { yaw: 0, pitch: 0 }, true);
      if (options.mode === 'queue') pendingInputs.push(lastInput);
      predictLocalMove(client, world, buffer, lastInput);
      counters.ticks += 1;
      if (options.mode === 'lockstep') flushServer(FIXED_DT);
    }
    if (options.mode !== 'lockstep') flushServer(options.frameDt);
    counters.samples.push(sampleFrame(client, stepped.ticks, accumulator / FIXED_DT));
  }
  return counters;
}

describe('local motion pipeline SP vs Online', () => {
  it('singleplayer 60fps walk interpolates between 20 TPS poses', () => {
    const run = runSingleplayer(2, 1 / 60);
    const summary = statsOf(run);
    expect(summary.ticks).toBe(40);
    expect(summary.meanStep).toBeGreaterThan(0.04);
    expect(summary.meanStep).toBeLessThan(0.10);
    expect(summary.maxStep).toBeLessThan(0.12);
    expect(summary.zeroLerpWhileMoving).toBe(0);
    expect(summary.multiTickFrames).toBe(0);
    const withTicks = run.samples.filter((sample) => sample.ticks > 0);
    for (const sample of withTicks) {
      expect(sample.distPrev).toBeGreaterThan(0.001);
    }
  });

  it('online 1:1 snapshots accept without mutating live pose and match SP render steps', () => {
    const sp = statsOf(runSingleplayer(2, 1 / 60));
    const run = runOnline({ seconds: 2, frameDt: 1 / 60, serverDt: FIXED_DT, mode: 'lockstep' });
    const summary = statsOf(run);
    expect(summary.ticks).toBe(40);
    expect(summary.corrections).toBe(0);
    expect(summary.snaps).toBe(0);
    expect(summary.acceptMutations).toBe(0);
    expect(summary.collapsedLerp).toBe(0);
    expect(summary.accepts).toBeGreaterThan(30);
    expect(summary.maxStep).toBeLessThan(0.12);
    expect(Math.abs(summary.meanStep - sp.meanStep)).toBeLessThan(0.002);
  });

  it('legacy lastInput coalescing used to collapse lerp; small corrections now keep previousPosition', () => {
    const online = runOnline({
      seconds: 2,
      frameDt: 1 / 60,
      serverDt: 0.1,
      mode: 'coalesce',
    });
    const summary = statsOf(online);
    expect(summary.ticks).toBe(40);
    expect(summary.acceptMutations).toBe(0);
    // Coalescing rewinds the live pose onto the previous tick, which is
    // exactly previousPosition — render lerp collapses even if we do not
    // copy previousPosition = position. Queueing inputs is the real fix.
    expect(summary.corrections).toBeGreaterThan(0);
    expect(summary.collapsedLerp).toBeGreaterThan(0);
  });

  it('queued server inputs stay in lockstep with client history (0 corrections)', () => {
    const sp = statsOf(runSingleplayer(2, 1 / 60));
    const online = runOnline({
      seconds: 2,
      frameDt: 1 / 60,
      serverDt: 0.05,
      mode: 'queue',
      serverPhase: 0.03,
    });
    const summary = statsOf(online);
    expect(summary.ticks).toBe(40);
    expect(summary.corrections).toBe(0);
    expect(summary.snaps).toBe(0);
    expect(summary.acceptMutations).toBe(0);
    expect(summary.collapsedLerp).toBe(0);
    expect(Math.abs(summary.meanStep - sp.meanStep)).toBeLessThan(0.002);
  });

  it('multiple fixed ticks in one render frame keep previousPosition from the latest tick', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const sp = grounded(world);
    const online = grounded(world);
    const buffer: PredictionBuffer = createPredictionBuffer();
    sp.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
    sp.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
    predictLocalMove(online, world, buffer, predictedMoveFromInput(1, walk, { yaw: 0, pitch: 0 }, true));
    predictLocalMove(online, world, buffer, predictedMoveFromInput(2, walk, { yaw: 0, pitch: 0 }, true));
    expect(online.previousPosition.z).toBeCloseTo(sp.previousPosition.z, 5);
    expect(online.position.z).toBeCloseTo(sp.position.z, 5);
    const alpha = 0.4;
    const spRender = lerp(sp.previousPosition.z, sp.position.z, alpha);
    const onRender = lerp(online.previousPosition.z, online.position.z, alpha);
    expect(onRender).toBeCloseTo(spRender, 5);
  });
});
