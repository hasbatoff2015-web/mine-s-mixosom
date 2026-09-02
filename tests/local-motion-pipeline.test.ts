import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT, WALK_SPEED } from '../src/core/constants';
import {
  advanceFixedStep,
  interpolationAlpha,
  interpolateAfterFixedTicks,
  restoreInterpolationOrigin,
} from '../src/core/fixedStep';
import type { MoveInput } from '../src/input/MoveInput';
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
  const twoTickSteps = [];
  for (let i = 1; i < run.samples.length; i += 1) {
    const dx = run.samples[i]!.renderX - run.samples[i - 1]!.renderX;
    const dz = run.samples[i]!.renderZ - run.samples[i - 1]!.renderZ;
    const dist = Math.hypot(dx, dz);
    renderSteps.push(dist);
    if (run.samples[i]!.ticks > 1) twoTickSteps.push(dist);
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
    twoTickMaxStep: Math.max(0, ...twoTickSteps),
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
    const origin = { x: player.position.x, y: player.position.y, z: player.position.z };
    for (let i = 0; i < stepped.ticks; i += 1) {
      player.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
      ticks += 1;
    }
    restoreInterpolationOrigin(player.previousPosition, origin, stepped.ticks);
    samples.push(sampleFrame(player, stepped.ticks, interpolationAlpha(accumulator)));
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
  mode: 'lockstep' | 'coalesce';
  serverPhase?: number;
}): RunStats {
  const world = flatWorld() as unknown as VoxelWorld;
  const client = grounded(world);
  const server = grounded(world);
  const buffer: PredictionBuffer = createPredictionBuffer();
  let accumulator = 0;
  let seq = 0;
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
      applyPredictedTick(server, world, lastInput);
      counters.snapshots += 1;
      reconcileCounted(client, world, buffer, snapshotOf(server, lastInput.seq), counters);
    }
  };

  for (let time = 0; time < options.seconds; time += options.frameDt) {
    const stepped = advanceFixedStep(accumulator, options.frameDt);
    accumulator = stepped.nextAccumulator;
    const origin = { x: client.position.x, y: client.position.y, z: client.position.z };
    for (let i = 0; i < stepped.ticks; i += 1) {
      seq += 1;
      lastInput = predictedMoveFromInput(seq, walk, { yaw: 0, pitch: 0 }, true);
      predictLocalMove(client, world, buffer, lastInput);
      counters.ticks += 1;
      if (options.mode === 'lockstep') flushServer(FIXED_DT);
    }
    restoreInterpolationOrigin(client.previousPosition, origin, stepped.ticks);
    if (options.mode !== 'lockstep') flushServer(options.frameDt);
    counters.samples.push(sampleFrame(client, stepped.ticks, interpolationAlpha(accumulator)));
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
    // copy previousPosition = position. A FIFO of stale movement is not
    // the fix; latest-input at 20 TPS is.
    expect(summary.corrections).toBeGreaterThan(0);
    expect(summary.collapsedLerp).toBeGreaterThan(0);
  });

  it('online latest-input 20Hz with phase offset does not accumulate a movement backlog', () => {
    const online = runOnline({
      seconds: 2,
      frameDt: 1 / 60,
      serverDt: 0.05,
      mode: 'coalesce',
      serverPhase: 0.03,
    });
    const summary = statsOf(online);
    expect(summary.ticks).toBe(40);
    expect(summary.acceptMutations).toBe(0);
    expect(summary.snaps).toBe(0);
    expect(summary.snapshots).toBeGreaterThan(30);
    expect(summary.snapshots).toBeLessThanOrEqual(40);
  });

  it('multiple fixed ticks in one render frame keep previousPosition from before the first tick', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const sp = grounded(world);
    const online = grounded(world);
    const buffer: PredictionBuffer = createPredictionBuffer();
    const originZ = sp.position.z;
    expect(online.position.z).toBeCloseTo(originZ, 5);

    const spOrigin = { x: sp.position.x, y: sp.position.y, z: sp.position.z };
    sp.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
    sp.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
    restoreInterpolationOrigin(sp.previousPosition, spOrigin, 2);

    const onlineOrigin = { x: online.position.x, y: online.position.y, z: online.position.z };
    predictLocalMove(online, world, buffer, predictedMoveFromInput(1, walk, { yaw: 0, pitch: 0 }, true));
    predictLocalMove(online, world, buffer, predictedMoveFromInput(2, walk, { yaw: 0, pitch: 0 }, true));
    restoreInterpolationOrigin(online.previousPosition, onlineOrigin, 2);

    expect(sp.previousPosition.z).toBeCloseTo(originZ, 5);
    expect(online.previousPosition.z).toBeCloseTo(originZ, 5);
    expect(online.position.z).toBeCloseTo(sp.position.z, 5);
    const leftover = 0.02;
    const spRender = interpolateAfterFixedTicks(sp.previousPosition, sp.position, leftover);
    const onRender = interpolateAfterFixedTicks(online.previousPosition, online.position, leftover);
    expect(onRender.z).toBeCloseTo(spRender.z, 5);
    expect(spRender.alpha).toBeCloseTo(leftover / FIXED_DT, 8);
  });

  it('two-tick hitch with leftover/dt does not step a full physics tick while corr/s=0', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = grounded(world);
    for (let i = 0; i < 8; i += 1) {
      const origin = { x: player.position.x, y: player.position.y, z: player.position.z };
      player.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
      restoreInterpolationOrigin(player.previousPosition, origin, 1);
    }

    const lastRender = interpolateAfterFixedTicks(player.previousPosition, player.position, 0.049);
    const tickDistance = Math.hypot(
      player.position.x - player.previousPosition.x,
      player.position.z - player.previousPosition.z,
    );
    expect(tickDistance).toBeGreaterThan(0.15);

    const hitch = advanceFixedStep(0.049, 0.055);
    expect(hitch.ticks).toBe(2);
    expect(hitch.nextAccumulator).toBeLessThan(0.01);

    const origin = { x: player.position.x, y: player.position.y, z: player.position.z };
    player.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
    const afterFirstPrevZ = player.previousPosition.z;
    player.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
    const naive = interpolateAfterFixedTicks(
      player.previousPosition,
      player.position,
      hitch.nextAccumulator,
    );
    restoreInterpolationOrigin(player.previousPosition, origin, hitch.ticks);
    expect(player.previousPosition.z).toBeCloseTo(origin.z, 8);
    expect(afterFirstPrevZ).toBeCloseTo(origin.z, 5);

    const corrected = interpolateAfterFixedTicks(
      player.previousPosition,
      player.position,
      hitch.nextAccumulator,
    );
    const naiveStep = Math.hypot(naive.x - lastRender.x, naive.z - lastRender.z);
    const correctedStep = Math.hypot(corrected.x - lastRender.x, corrected.z - lastRender.z);

    expect(naiveStep).toBeGreaterThan(tickDistance * 0.8);
    expect(correctedStep).toBeLessThan(tickDistance * 0.35);
    expect(corrected.alpha).toBeCloseTo(hitch.nextAccumulator / FIXED_DT, 8);
    expect(corrected.z).toBeCloseTo(lerp(origin.z, player.position.z, corrected.alpha), 8);

    const follow = advanceFixedStep(hitch.nextAccumulator, 1 / 60);
    expect(follow.ticks).toBe(0);
    const followRender = interpolateAfterFixedTicks(
      player.previousPosition,
      player.position,
      follow.nextAccumulator,
    );
    const followStep = Math.hypot(followRender.x - corrected.x, followRender.z - corrected.z);
    const alongZ = Math.sign(player.position.z - origin.z) || 1;
    expect((followRender.z - corrected.z) * alongZ).toBeGreaterThan(0);
    expect(followStep).toBeLessThan(tickDistance);
    expect(followStep).toBeGreaterThan(0);
  });

  it('60 Hz walk with occasional 55 ms hitch matches SP and Online without a one-tick teleport', () => {
    const frameDts: number[] = [];
    for (let i = 0; i < 120; i += 1) frameDts.push(i % 12 === 11 ? 0.055 : 1 / 60);

    const run = (online: boolean): RunStats => {
      const world = flatWorld() as unknown as VoxelWorld;
      const player = grounded(world);
      const server = online ? grounded(world) : undefined;
      const buffer = online ? createPredictionBuffer() : undefined;
      let accumulator = 0;
      let seq = 0;
      let lastInput = predictedMoveFromInput(0, walk, { yaw: 0, pitch: 0 }, true);
      const samples: FrameSample[] = [];
      let ticks = 0;
      let snapshots = 0;
      let corrections = 0;
      for (const frameDt of frameDts) {
        const stepped = advanceFixedStep(accumulator, frameDt);
        accumulator = stepped.nextAccumulator;
        const origin = { x: player.position.x, y: player.position.y, z: player.position.z };
        for (let i = 0; i < stepped.ticks; i += 1) {
          if (online && buffer && server) {
            seq += 1;
            lastInput = predictedMoveFromInput(seq, walk, { yaw: 0, pitch: 0 }, true);
            predictLocalMove(player, world, buffer, lastInput);
            applyPredictedTick(server, world, lastInput);
            snapshots += 1;
            const result = reconcilePredictedPlayer(player, world, buffer, snapshotOf(server, lastInput.seq));
            if (result.kind === 'corrected' || result.kind === 'snapped') corrections += 1;
          } else {
            player.tick(world, { yaw: 0, pitch: 0, movement: () => walk }, FIXED_DT);
          }
          ticks += 1;
        }
        restoreInterpolationOrigin(player.previousPosition, origin, stepped.ticks);
        samples.push(sampleFrame(player, stepped.ticks, interpolationAlpha(accumulator)));
      }
      return {
        samples, ticks, snapshots, accepts: 0, corrections, snaps: 0, ignored: 0,
        acceptMutations: 0, collapsedLerp: 0,
      };
    };

    const sp = statsOf(run(false));
    const online = statsOf(run(true));
    expect(sp.multiTickFrames).toBeGreaterThan(0);
    expect(online.multiTickFrames).toBe(sp.multiTickFrames);
    // A 55 ms frame may legally cover ~WALK_SPEED*0.055 of walk. The regression
    // is that ticks>=2 must not add an extra physics-step teleport on top.
    expect(sp.maxStep).toBeLessThan(WALK_SPEED * 0.055 * 1.15);
    expect(online.maxStep).toBeLessThan(WALK_SPEED * 0.055 * 1.15);
    expect(sp.twoTickMaxStep).toBeLessThan(0.12);
    expect(online.twoTickMaxStep).toBeLessThan(0.12);
    expect(online.corrections).toBe(0);
    expect(Math.abs(sp.meanStep - online.meanStep)).toBeLessThan(0.002);
  });
});
