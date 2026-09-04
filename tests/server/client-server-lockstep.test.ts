import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, ServerPlayer } from '../../server/WorldInstance';
import { getBlockDefinition } from '../../src/blocks';
import { CHUNK_SIZE, PLAYER_WIDTH, chunkKey, floorDiv } from '../../src/core/constants';
import type { MoveInput } from '../../src/input/MoveInput';
import {
  buildCorrectionDiag,
  formatCorrectionDiag,
  resetFirstCorrectionDump,
  sampleCollisionHint,
} from '../../src/net/correctionDiagnostics';
import {
  createPredictionBuffer,
  inspectPredictedPlayer,
  predictLocalMove,
  predictedMoveFromInput,
  reconcilePredictedPlayer,
  seedPredictionCheckpoint,
  type PredictionBuffer,
} from '../../src/net/localPlayerPrediction';
import { PlayerController } from '../../src/player/PlayerController';
import { dumpControllerTicks, formatPoseDump } from '../../src/player/moveSimCompare';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { Chunk } from '../../src/world/Chunk';
import { VoxelWorld } from '../../src/world/World';
import type { ClientInputMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-lockstep-'));
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '2',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 2,
    persistIntervalMs: 60_000,
  };
}

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function moveInput(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input',
    seq,
    forward: 0,
    right: 0,
    jump: false,
    sneak: false,
    sprint: false,
    descend: false,
    flySprint: false,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    ...extra,
  };
}

function cloneController(from: PlayerController): PlayerController {
  const copy = new PlayerController({
    position: [from.position.x, from.position.y, from.position.z],
    yaw: from.yaw,
    pitch: from.pitch,
  });
  copy.applyMovementState(from.captureMovementState());
  copy.creativeFlightAllowed = from.creativeFlightAllowed;
  copy.previousPosition.copy(from.previousPosition);
  return copy;
}

function copyCollisionWorld(source: VoxelWorld): VoxelWorld {
  const copy = new VoxelWorld(source.seed);
  copy.timeOfDay = source.timeOfDay;
  for (const [key, src] of source.chunks) {
    const dst = new Chunk(src.x, src.z);
    dst.blocks.set(src.blocks);
    dst.occupancyTop = src.occupancyTop;
    dst.generated = true;
    copy.chunks.set(key, dst);
  }
  for (const [key, state] of source.blockStates) copy.blockStates.set(key, state);
  return copy;
}

interface LockstepMode {
  readonly name: string;
  readonly ticks: number;
  readonly input: Partial<ClientInputMessage>;
  readonly flying?: boolean;
  readonly copyWorld?: boolean;
}

interface LockstepTickPose {
  readonly tick: number;
  readonly seq: number;
  readonly client: ReturnType<PlayerController['captureMovementState']>;
  readonly server: ReturnType<PlayerController['captureMovementState']>;
  readonly inspectKind: string;
  readonly firstDiff?: string;
  readonly physicsTicks: number;
  readonly extraTicks: number;
  readonly comparePath: string;
  readonly seqGap: number;
  readonly dump?: string;
}

function runLockstep(
  world: WorldInstance,
  player: ServerPlayer,
  mode: LockstepMode,
): LockstepTickPose[] {
  const server = player.controller;
  if (mode.flying) {
    player.gamemode = 'creative';
    server.creativeFlightAllowed = true;
    server.isFlying = true;
    server.velocity.set(0, 0, 0);
  }
  for (let settle = 0; settle < 8; settle += 1) world.tick();

  const clientWorld = mode.copyWorld ? copyCollisionWorld(world.world) : world.world;
  const client = cloneController(server);
  const buffer: PredictionBuffer = createPredictionBuffer();
  seedPredictionCheckpoint(buffer, client.captureMovementState(), world.tickNumber);
  const poses: LockstepTickPose[] = [];
  const sampleAt = new Set([1, 2, 3, 10, 20].filter((tick) => tick <= mode.ticks));
  let seq = Math.max(0, player.lastInputSeq) + 1;

  for (let tick = 1; tick <= mode.ticks; tick += 1) {
    const packet = moveInput(seq, mode.input);
    const predicted = predictedMoveFromInput(
      seq,
      {
        forward: packet.forward,
        right: packet.right,
        jump: packet.jump,
        sneak: packet.sneak,
        sprint: packet.sprint,
        descend: packet.descend,
        flySprint: packet.flySprint,
      } satisfies MoveInput,
      { yaw: packet.yaw, pitch: packet.pitch },
      true,
    );
    expect(world.applyInput(player, packet)).toBe(true);
    predictLocalMove(client, clientWorld, buffer, predicted);
    world.tick();
    const snapshot = player.snapshot();
    const inspect = inspectPredictedPlayer(buffer, snapshot, client, {
      world: clientWorld,
      physicsTicks: Math.max(1, world.lastPhysicsTicksThisLoop),
      serverTick: world.tickNumber,
    });
    if (inspect.kind === 'accepted') {
      reconcilePredictedPlayer(client, clientWorld, buffer, snapshot, undefined, {
        physicsTicks: Math.max(1, world.lastPhysicsTicksThisLoop),
        serverTick: world.tickNumber,
      });
    }
    const wantDump = inspect.kind === 'corrected' || inspect.kind === 'snapped' || sampleAt.has(tick);
    let dump: string | undefined;
    if (wantDump && (inspect.kind === 'corrected' || inspect.kind === 'snapped')) {
      const px = inspect.predicted ?? inspect.comparable;
      const collision = sampleCollisionHint(
        (x, y, z) => ({ name: getBlockDefinition(clientWorld.getBlock(x, y, z, false)).name }),
        px ?? client.captureMovementState(),
        {
          yaw: predicted.yaw,
          width: PLAYER_WIDTH,
          height: client.height,
          chunkLoaded: clientWorld.chunks.has(chunkKey(
            floorDiv(Math.floor(client.position.x), CHUNK_SIZE),
            floorDiv(Math.floor(client.position.z), CHUNK_SIZE),
          )),
          mutationMarks: clientWorld.mutationMarks,
        },
      );
      dump = formatCorrectionDiag(buildCorrectionDiag({
        snapshot,
        buffer,
        predicted: inspect.predicted,
        predictedInput: predicted,
        player: client,
        error: inspect.error,
        reject: inspect.rejectReason,
        serverTick: world.tickNumber,
        lastStateTick: world.tickNumber - 1,
        physicsTicks: inspect.physicsTicks,
        physicsTicksThisLoop: world.lastPhysicsTicksThisLoop,
        firstDiff: inspect.firstDiff,
        rawFirstDiff: inspect.rawFirstDiff,
        extraTicks: inspect.extraTicks,
        comparePath: inspect.comparePath,
        seqGap: inspect.seqGap,
        history: inspect.predicted,
        comparable: inspect.comparable,
        world: {
          feetBlock: collision.feetBlock,
          belowBlock: collision.belowBlock,
          aheadBlock: collision.aheadBlock,
          aabbBlocks: collision.aabbBlocks,
          chunkKey: collision.chunkKey,
          chunkLoaded: collision.chunkLoaded,
          mutationMarks: collision.mutationMarks,
          msSinceBlockMutation: -1,
          msSinceChunkUpdate: -1,
          ticksThisFrame: 1,
          onGroundBefore: client.onGround,
          onGroundAfterPredicted: inspect.predicted?.onGround ?? client.onGround,
          jump: predicted.jump,
          flyingToggle: false,
          descend: predicted.descend,
          visibility: 'visible',
        },
      }));
    }
    if (sampleAt.has(tick) || dump) {
      poses.push({
        tick,
        seq,
        client: client.captureMovementState(),
        server: server.captureMovementState(),
        inspectKind: inspect.kind,
        firstDiff: inspect.firstDiff,
        physicsTicks: inspect.physicsTicks,
        extraTicks: inspect.extraTicks,
        comparePath: inspect.comparePath,
        seqGap: inspect.seqGap,
        dump,
      });
    }
    seq += 1;
  }
  return poses;
}

describe('client predictLocalMove vs WorldInstance tick lockstep', { timeout: 30_000 }, () => {
  const worlds: WorldInstance[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    return world;
  }

  function join(world: WorldInstance) {
    const joined = world.join({ sink: new MemorySink(), name: 'Lockstep' });
    if ('error' in joined) throw new Error(joined.error);
    return joined.player;
  }

  it('prints PlayerController lockstep poses at 1/2/3/10/20 ticks', () => {
    const lines = [
      ...formatPoseDump('stationary', dumpControllerTicks([1, 2, 3, 10, 20], {})),
      ...formatPoseDump('walk', dumpControllerTicks([1, 2, 3, 10, 20], { forward: 1 })),
      ...formatPoseDump('strafe', dumpControllerTicks([1, 2, 3, 10, 20], { right: 1 })),
      ...formatPoseDump('jump', dumpControllerTicks([1, 2, 3, 10, 20], { jump: true })),
      ...formatPoseDump('flight-hover', dumpControllerTicks([1, 2, 3, 10, 20], {}, { flying: true, startY: 8 })),
      ...formatPoseDump('flight-descend', dumpControllerTicks([1, 2, 3, 10, 20], { descend: true }, { flying: true, startY: 8 })),
    ];
    for (const line of lines) console.info(line);
    expect(lines.some((line) => line.includes('t=20'))).toBe(true);
  });

  it('1:1 Anarchy walk on the same VoxelWorld matches history[N]', async () => {
    resetFirstCorrectionDump();
    const world = await boot();
    const player = join(world);
    const poses = runLockstep(world, player, { name: 'walk-same', ticks: 20, input: { forward: 1 } });
    const firstCorr = poses.find((pose) => pose.dump);
    if (firstCorr?.dump) {
      console.info('\n[corrDiag:lockstep-same-world] FIRST WALK CORRECTION\n' + firstCorr.dump);
    }
    expect(firstCorr, firstCorr?.dump ?? 'same-world walk produced a positional correction').toBeUndefined();
    const last = poses[poses.length - 1]!;
    expect(last.inspectKind).toBe('accepted');
    expect(last.physicsTicks).toBe(1);
    expect(last.comparePath).toBe('applied-timeline');
    expect(Math.hypot(last.client.x - last.server.x, last.client.y - last.server.y, last.client.z - last.server.z))
      .toBeLessThan(1e-6);
  });

  it('1:1 Anarchy walk on a copied collision world (client world.tick never runs) matches or dumps', async () => {
    resetFirstCorrectionDump();
    const world = await boot();
    const player = join(world);
    const poses = runLockstep(world, player, {
      name: 'walk-copy',
      ticks: 20,
      input: { forward: 1 },
      copyWorld: true,
    });
    const firstCorr = poses.find((pose) => pose.dump);
    if (firstCorr?.dump) {
      console.info('\n[corrDiag:lockstep-copied-world] FIRST WALK CORRECTION — client collision is a frozen copy\n' + firstCorr.dump);
      expect(firstCorr.dump).toContain('SEQ:');
      expect(firstCorr.dump).toContain('PHYSICS:');
      expect(firstCorr.dump).toContain('firstDiff=');
      expect(firstCorr.physicsTicks).toBe(1);
    } else {
      const last = poses[poses.length - 1]!;
      expect(last.inspectKind).toBe('accepted');
    }
  });

  it('stationary / strafe / jump / flight hover / flight+SHIFT either match or dump the first corrDiag', async () => {
    const world = await boot();
    const player = join(world);
    const modes: LockstepMode[] = [
      { name: 'idle', ticks: 20, input: {} },
      { name: 'strafe', ticks: 20, input: { right: 1 } },
      { name: 'jump', ticks: 12, input: { jump: true } },
      { name: 'flight-hover', ticks: 20, input: {}, flying: true },
      { name: 'flight-descend', ticks: 20, input: { descend: true }, flying: true },
    ];
    const dumps: string[] = [];
    for (const mode of modes) {
      const poses = runLockstep(world, player, { ...mode, copyWorld: true });
      const firstCorr = poses.find((pose) => pose.dump);
      if (firstCorr?.dump) {
        dumps.push(`\n[${mode.name}]\n${firstCorr.dump}`);
      }
    }
    if (dumps.length > 0) console.info(dumps.join('\n'));
    expect(dumps.length === 0 || dumps[0]!.includes('[corrDiag]')).toBe(true);
  });

  it('accepts two client seqs vs one latest-input server tick (owner dump pattern)', async () => {
    resetFirstCorrectionDump();
    const world = await boot();
    const player = join(world);
    for (let settle = 0; settle < 8; settle += 1) world.tick();
    const client = cloneController(player.controller);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), world.tickNumber);
    expect(world.applyInput(player, moveInput(1, { forward: 1 }))).toBe(true);
    predictLocalMove(client, world.world, buffer, predictedMoveFromInput(
      1,
      { forward: 1, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false },
      { yaw: 0, pitch: 0 },
      true,
    ));
    world.tick();
    const first = inspectPredictedPlayer(buffer, player.snapshot(), client, {
      world: world.world,
      physicsTicks: 1,
      serverTick: world.tickNumber,
    });
    expect(first.kind).toBe('accepted');
    expect(first.comparePath).toBe('applied-timeline');
    reconcilePredictedPlayer(client, world.world, buffer, player.snapshot(), undefined, {
      physicsTicks: 1,
      serverTick: world.tickNumber,
    });

    predictLocalMove(client, world.world, buffer, predictedMoveFromInput(
      2,
      { forward: 1, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false },
      { yaw: 0, pitch: 0 },
      true,
    ));
    predictLocalMove(client, world.world, buffer, predictedMoveFromInput(
      3,
      { forward: 1, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false },
      { yaw: 0, pitch: 0 },
      true,
    ));
    expect(world.applyInput(player, moveInput(2, { forward: 1 }))).toBe(true);
    expect(world.applyInput(player, moveInput(3, { forward: 1 }))).toBe(true);
    world.tick();
    const snapshot = player.snapshot();
    const inspect = inspectPredictedPlayer(buffer, snapshot, client, {
      world: world.world,
      physicsTicks: 1,
      serverTick: world.tickNumber,
    });
    expect(inspect.kind).toBe('accepted');
    expect(inspect.physicsTicks).toBe(1);
    expect(inspect.seqGap).toBe(2);
    expect(inspect.simTicks).toBe(1);
    expect(inspect.comparePath).toBe('applied-timeline');
    expect(inspect.predicted).toBeDefined();
    expect(Math.hypot(
      inspect.predicted!.x - snapshot.x,
      inspect.predicted!.z - snapshot.z,
    )).toBeGreaterThan(0.12);
  });

  it('physicsTicks=2 catch-up on Anarchy is comparable via checkpoint simTicks', async () => {
    const world = await boot();
    const player = join(world);
    for (let settle = 0; settle < 8; settle += 1) world.tick();
    const client = cloneController(player.controller);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), world.tickNumber);
    const idle = predictedMoveFromInput(
      1,
      { forward: 0, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false },
      { yaw: 0, pitch: 0 },
      true,
    );
    expect(world.applyInput(player, moveInput(1))).toBe(true);
    predictLocalMove(client, world.world, buffer, idle);
    world.tick();
    const idleSnap = player.snapshot();
    const idleInspect = inspectPredictedPlayer(buffer, idleSnap, client, {
      world: world.world,
      physicsTicks: 1,
      serverTick: world.tickNumber,
    });
    expect(idleInspect.kind).toBe('accepted');
    reconcilePredictedPlayer(client, world.world, buffer, idleSnap, undefined, {
      physicsTicks: 1,
      serverTick: world.tickNumber,
    });

    const predicted = predictedMoveFromInput(
      2,
      { forward: 1, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false },
      { yaw: 0, pitch: 0 },
      true,
    );
    expect(world.applyInput(player, moveInput(2, { forward: 1 }))).toBe(true);
    predictLocalMove(client, world.world, buffer, predicted);
    world.tickCatchUp(2);
    const snapshot = player.snapshot();
    expect(world.lastPhysicsTicksThisLoop).toBe(2);
    const asOne = inspectPredictedPlayer(buffer, snapshot, client, { world: world.world, physicsTicks: 1 });
    const asTwo = inspectPredictedPlayer(buffer, snapshot, client, { world: world.world, physicsTicks: 2 });
    const asTick = inspectPredictedPlayer(buffer, snapshot, client, {
      world: world.world,
      physicsTicks: 1,
      serverTick: world.tickNumber,
    });
    expect(asOne.seqGap).toBe(1);
    expect(asOne.comparePath).toBe('checkpoint');
    expect(asOne.simTicks).toBe(1);
    expect(asTwo.comparePath).toBe('checkpoint');
    expect(asTwo.simTicks).toBe(2);
    expect(asTick.simTicks).toBe(2);
    expect(asTick.comparePath).toBe('applied-timeline');
    expect(asOne.kind).toBe('corrected');
    expect(asTwo.kind).toBe('accepted');
    expect(asTick.kind).toBe('accepted');
  });
});
