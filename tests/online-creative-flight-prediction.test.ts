import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import type { MoveInput } from '../src/input/MoveInput';
import {
  copyPredictionControllerConfig,
  createPredictionBuffer,
  inspectPredictedPlayer,
  predictedMoveFromInput,
  predictedStateFromCheckpoint,
  predictLocalMove,
  reconcilePredictedPlayer,
  seedPredictionCheckpoint,
  type PredictionBuffer,
} from '../src/net/localPlayerPrediction';
import { resyncLocalPlayerAfterHiddenTab } from '../src/net/hiddenTabMotion';
import {
  creativeFlightAllowedForGamemode,
  creativeFlightAllowedForPrediction,
  syncCreativeFlightAllowed,
} from '../src/player/creativeFlight';
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

function move(seq: number, extra: Partial<MoveInput> = {}): ReturnType<typeof predictedMoveFromInput> {
  return predictedMoveFromInput(seq, { ...idle, ...extra }, { yaw: 0, pitch: 0 }, true);
}

function airWorld(): VoxelWorld {
  return new TestWorld() as unknown as VoxelWorld;
}

function snapshotOf(
  player: PlayerController,
  seq: number,
  extras: Partial<PlayerSnapshot> = {},
): PlayerSnapshot {
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
    ...extras,
  };
}

function hoverOrigin(): PlayerController {
  const player = new PlayerController({ position: [0.5, 71.666, 0.5] });
  player.creativeFlightAllowed = true;
  player.isFlying = true;
  player.onGround = false;
  player.velocity.set(0, 0, 0);
  return player;
}

function tickLikeSingleplayer(
  player: PlayerController,
  world: VoxelWorld,
  gamemode: 'survival' | 'creative',
  input: MoveInput,
): void {
  syncCreativeFlightAllowed(player, gamemode);
  player.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => input }, FIXED_DT);
}

function tickLikeOnline(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  seq: number,
  gamemode: 'survival' | 'creative',
  input: Partial<MoveInput> = {},
): void {
  syncCreativeFlightAllowed(player, gamemode);
  predictLocalMove(player, world, buffer, move(seq, input));
}

describe('creative flight permission helpers', () => {
  it('allows flight only in creative', () => {
    expect(creativeFlightAllowedForGamemode('creative')).toBe(true);
    expect(creativeFlightAllowedForGamemode('survival')).toBe(false);
    expect(creativeFlightAllowedForGamemode(undefined)).toBe(false);
  });

  it('scratch uses live flag or authoritative creative gamemode', () => {
    expect(creativeFlightAllowedForPrediction({ creativeFlightAllowed: false }, 'creative')).toBe(true);
    expect(creativeFlightAllowedForPrediction({ creativeFlightAllowed: true }, 'survival')).toBe(true);
    expect(creativeFlightAllowedForPrediction({ creativeFlightAllowed: false }, 'survival')).toBe(false);
    expect(creativeFlightAllowedForPrediction(undefined, 'creative')).toBe(true);
    expect(creativeFlightAllowedForPrediction(undefined, undefined)).toBe(false);
  });
});

describe('prediction scratch copies Creative Flight permission', () => {
  it('clears flying and applies gravity when scratch has no permission', () => {
    const world = airWorld();
    const origin = hoverOrigin();
    const predicted = predictedStateFromCheckpoint(
      world,
      origin.captureMovementState(),
      move(1),
      1,
      { creativeFlightAllowed: false },
    );
    expect(predicted.isFlying).toBe(false);
    expect(predicted.vy).toBeLessThan(-1);
  });

  it('keeps hover when scratch receives the live controller permission', () => {
    const world = airWorld();
    const origin = hoverOrigin();
    const scratch = new PlayerController();
    copyPredictionControllerConfig(origin, scratch);
    expect(scratch.creativeFlightAllowed).toBe(true);
    const predicted = predictedStateFromCheckpoint(
      world,
      origin.captureMovementState(),
      move(1),
      1,
      { creativeFlightAllowed: origin.creativeFlightAllowed },
    );
    expect(predicted.isFlying).toBe(true);
    expect(predicted.vy).toBeCloseTo(0, 3);
    expect(predicted.y).toBeCloseTo(origin.position.y, 5);
  });

  it('inspect uses snapshot gamemode=creative even if the live flag was never synced', () => {
    const world = airWorld();
    const origin = hoverOrigin();
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, origin.captureMovementState(), 2162);
    buffer.lastAckedSeq = 10;
    buffer.lastAckedInput = move(10);

    const client = new PlayerController({ position: [0.5, 71.666, 0.5] });
    client.applyMovementState(origin.captureMovementState());
    expect(client.creativeFlightAllowed).toBe(false);
    predictLocalMove(client, world, buffer, move(11));

    const server = hoverOrigin();
    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => idle }, FIXED_DT);

    const inspect = inspectPredictedPlayer(buffer, snapshotOf(server, 11, { gamemode: 'creative' }), client, {
      world,
      physicsTicks: 1,
      serverTick: 2163,
    });
    expect(inspect.flight?.localAllowed).toBe(false);
    expect(inspect.flight?.scratchAllowed).toBe(true);
    expect(inspect.flight?.snapshotGamemode).toBe('creative');
    expect(inspect.comparable?.isFlying).toBe(true);
    expect(inspect.comparable?.vy).toBeCloseTo(0, 3);
    expect(inspect.kind).toBe('accepted');
  });
});

describe('singleplayer vs online Creative Flight permission', () => {
  it('matches SP hover when Online syncs permission from gamemode before tick', () => {
    const world = airWorld();
    const sp = hoverOrigin();
    const online = hoverOrigin();
    online.creativeFlightAllowed = false;
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, online.captureMovementState(), 0);

    for (let i = 1; i <= 200; i += 1) {
      tickLikeSingleplayer(sp, world, 'creative', idle);
      tickLikeOnline(online, world, buffer, i, 'creative');
    }

    expect(sp.creativeFlightAllowed).toBe(true);
    expect(online.creativeFlightAllowed).toBe(true);
    expect(sp.isFlying).toBe(true);
    expect(online.isFlying).toBe(true);
    expect(sp.velocity.y).toBeCloseTo(0, 3);
    expect(online.velocity.y).toBeCloseTo(0, 3);
    expect(online.position.y).toBeCloseTo(sp.position.y, 5);
  });

  it('reproduces the live dump: unsynced local prediction falls while the server hovers', () => {
    const world = airWorld();
    const client = hoverOrigin();
    client.creativeFlightAllowed = false;
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 2162);
    predictLocalMove(client, world, buffer, move(11));
    predictLocalMove(client, world, buffer, move(12));

    expect(client.creativeFlightAllowed).toBe(false);
    expect(client.isFlying).toBe(false);
    expect(client.velocity.y).toBeLessThan(-1);
    expect(client.position.y).toBeLessThan(71.666);

    const server = hoverOrigin();
    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => idle }, FIXED_DT);
    expect(server.creativeFlightAllowed).toBe(true);
    expect(server.isFlying).toBe(true);
    expect(server.velocity.y).toBeCloseTo(0, 3);
    expect(server.position.y).toBeCloseTo(71.666, 3);
  });
});

describe('stationary Creative Flight prediction', () => {
  it('hover 10s with corr/s=0 when permission is synced', () => {
    const world = airWorld();
    const client = hoverOrigin();
    const server = hoverOrigin();
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    let corrections = 0;

    for (let seq = 1; seq <= 200; seq += 1) {
      tickLikeOnline(client, world, buffer, seq, 'creative');
      syncCreativeFlightAllowed(server, 'creative');
      server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => idle }, FIXED_DT);
      const result = reconcilePredictedPlayer(client, world, buffer, snapshotOf(server, seq), undefined, {
        physicsTicks: 1,
        serverTick: seq,
      });
      if (result.kind === 'corrected' || result.kind === 'snapped') corrections += 1;
    }

    expect(server.isFlying).toBe(true);
    expect(client.isFlying).toBe(true);
    expect(server.velocity.y).toBeCloseTo(0, 3);
    expect(client.velocity.y).toBeCloseTo(0, 3);
    expect(client.position.y).toBeCloseTo(server.position.y, 5);
    expect(corrections).toBe(0);
  });

  it('flight forward, SHIFT descend, and stop stay accepted', () => {
    const world = airWorld();
    const client = hoverOrigin();
    const server = hoverOrigin();
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    let seq = 0;
    const step = (input: Partial<MoveInput>, ticks: number): void => {
      for (let i = 0; i < ticks; i += 1) {
        seq += 1;
        tickLikeOnline(client, world, buffer, seq, 'creative', input);
        syncCreativeFlightAllowed(server, 'creative');
        server.tick(world, {
          yaw: 0, pitch: 0, locomotion: true,
          movement: () => ({ ...idle, ...input }),
        }, FIXED_DT);
        const result = reconcilePredictedPlayer(client, world, buffer, snapshotOf(server, seq), undefined, {
          physicsTicks: 1,
          serverTick: seq,
        });
        expect(result.kind, `seq=${seq}`).toBe('accepted');
      }
    };

    step({ forward: 1 }, 10);
    expect(client.isFlying).toBe(true);
    step({ sneak: true, descend: true }, 10);
    expect(client.isFlying).toBe(true);
    step(idle, 10);
    expect(client.isFlying).toBe(true);
    expect(client.velocity.y).toBeCloseTo(server.velocity.y, 3);
  });

  it('re-enters flight after reconnect-style controller init', () => {
    const world = airWorld();
    const welcomeGamemode = 'creative' as const;
    const client = new PlayerController({ position: [0.5, 71.666, 0.5] });
    syncCreativeFlightAllowed(client, welcomeGamemode);
    expect(client.creativeFlightAllowed).toBe(true);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), -1);
    predictLocalMove(client, world, buffer, move(1, { jump: true }));
    predictLocalMove(client, world, buffer, move(2));
    predictLocalMove(client, world, buffer, move(3, { jump: true }));
    expect(client.isFlying).toBe(true);
    for (let seq = 4; seq <= 24; seq += 1) {
      tickLikeOnline(client, world, buffer, seq, welcomeGamemode);
    }
    expect(client.creativeFlightAllowed).toBe(true);
    expect(client.isFlying).toBe(true);
    expect(Math.abs(client.velocity.y)).toBeLessThan(0.4);
  });

  it('keeps flight after alt-tab resume when permission is synced', () => {
    const world = airWorld();
    const client = hoverOrigin();
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 10);
    predictLocalMove(client, world, buffer, move(11, { forward: 1 }));
    const snapshot = snapshotOf(client, 11, { gamemode: 'creative', flying: true });
    resyncLocalPlayerAfterHiddenTab({
      player: client,
      buffer,
      snapshot,
      inputSeq: 11,
      serverTick: 20,
    });
    syncCreativeFlightAllowed(client, 'creative');
    tickLikeOnline(client, world, buffer, 12, 'creative');
    expect(client.isFlying).toBe(true);
    expect(client.velocity.y).toBeCloseTo(0, 2);
  });
});

describe('walk/sprint/jump still match without Creative Flight', () => {
  it('survival walk does not enable flight', () => {
    const ground = new TestWorld();
    for (let z = -4; z <= 4; z += 1) {
      for (let x = -4; x <= 4; x += 1) ground.set(x, 0, z, BlockId.Stone);
    }
    const voxel = ground as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    syncCreativeFlightAllowed(client, 'survival');
    client.tick(voxel, { yaw: 0, pitch: 0, locomotion: true, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    syncCreativeFlightAllowed(server, 'survival');
    server.applyMovementState(client.captureMovementState());

    for (let seq = 1; seq <= 12; seq += 1) {
      tickLikeOnline(client, voxel, buffer, seq, 'survival', { forward: 1 });
      syncCreativeFlightAllowed(server, 'survival');
      server.tick(voxel, {
        yaw: 0, pitch: 0, locomotion: true,
        movement: () => ({ ...idle, forward: 1 }),
      }, FIXED_DT);
      const result = reconcilePredictedPlayer(client, voxel, buffer, snapshotOf(server, seq), undefined, {
        physicsTicks: 1,
        serverTick: seq,
      });
      expect(result.kind).toBe('accepted');
    }
    expect(client.isFlying).toBe(false);
    expect(client.creativeFlightAllowed).toBe(false);
  });

  it('survival jump is accepted', () => {
    const ground = new TestWorld();
    for (let z = -4; z <= 4; z += 1) {
      for (let x = -4; x <= 4; x += 1) ground.set(x, 0, z, BlockId.Stone);
    }
    const voxel = ground as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    syncCreativeFlightAllowed(client, 'survival');
    client.tick(voxel, { yaw: 0, pitch: 0, locomotion: true, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    syncCreativeFlightAllowed(server, 'survival');
    server.applyMovementState(client.captureMovementState());

    tickLikeOnline(client, voxel, buffer, 1, 'survival', { jump: true });
    server.tick(voxel, {
      yaw: 0, pitch: 0, locomotion: true,
      movement: () => ({ ...idle, jump: true }),
    }, FIXED_DT);
    expect(reconcilePredictedPlayer(client, voxel, buffer, snapshotOf(server, 1), undefined, {
      physicsTicks: 1,
      serverTick: 1,
    }).kind).toBe('accepted');
    expect(client.isFlying).toBe(false);
    expect(client.velocity.y).toBeGreaterThan(0);
  });
});
