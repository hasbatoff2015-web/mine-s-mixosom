import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import gameSource from '../src/core/Game.ts?raw';
import inputSource from '../src/input/InputManager.ts?raw';
import type { MoveInput } from '../src/input/MoveInput';
import {
  MOBILE_SNEAK_IDLE,
  mobileSneakAfterFlight,
  mobileSneakAfterPointer,
  mobileSneakFlightHold,
  mobileSneakIntent,
  mobileSneakRelease,
  sneakButtonActive,
  type MobileSneakState,
} from '../src/input/mobileTouch';
import {
  createPredictionBuffer,
  predictLocalMove,
  predictedMoveFromInput,
  reconcilePredictedPlayer,
  replayUnackedMoves,
  seedPredictionCheckpoint,
} from '../src/net/localPlayerPrediction';
import { PlayerController } from '../src/player';
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
    return this.getBlock(x, y, z) !== BlockId.Air;
  }
}

function ground(): TestWorld {
  const world = new TestWorld();
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -2; z <= 2; z += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

function tick(player: PlayerController, world: TestWorld, movement: MoveInput): void {
  player.tick(world as unknown as VoxelWorld, {
    yaw: 0,
    pitch: 0,
    movement: () => movement,
  }, FIXED_DT);
}

function move(intent: { sneak: boolean; descend: boolean }, extra: Partial<MoveInput> = {}): MoveInput {
  return {
    forward: 0,
    right: 0,
    jump: false,
    manualJump: false,
    sprint: false,
    sneak: intent.sneak,
    descend: intent.descend,
    ...extra,
  };
}

function down(state: MobileSneakState, pointerId = 1): MobileSneakState {
  return mobileSneakAfterPointer(state, { type: 'down', pointerId });
}

function up(state: MobileSneakState, pointerId = 1): MobileSneakState {
  return mobileSneakAfterPointer(state, { type: 'up', pointerId });
}

function flyingPlayer(): PlayerController {
  const player = new PlayerController({ position: [0.5, 12, 0.5] });
  player.creativeFlightAllowed = true;
  player.isFlying = true;
  player.velocity.set(0, 0, 0);
  return player;
}

describe('mobile crouch latch vs flight descend', () => {
  it('latches survival crouch across release and clears it on the next tap', () => {
    expect(mobileSneakFlightHold('survival', false)).toBe(false);
    const world = ground();
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    let state = down(MOBILE_SNEAK_IDLE);
    state = up(state);
    expect(state.latched).toBe(true);
    expect(state.pressed).toBe(false);
    expect(sneakButtonActive(state)).toBe(true);
    const held = mobileSneakIntent(state, false);
    expect(held).toEqual({ sneak: true, descend: false });
    tick(player, world, move(held));
    expect(player.sneaking).toBe(true);
    expect(player.isFlying).toBe(false);

    state = up(down(state));
    expect(state.latched).toBe(false);
    expect(sneakButtonActive(state)).toBe(false);
    const released = mobileSneakIntent(state, false);
    expect(released.sneak).toBe(false);
    tick(player, world, move(released));
    expect(player.sneaking).toBe(false);
  });

  it('keeps grounded creative crouch as a toggle', () => {
    expect(mobileSneakFlightHold('creative', false)).toBe(false);
    let state = mobileSneakAfterFlight(MOBILE_SNEAK_IDLE, false);
    state = up(down(state));
    expect(state.mode).toBe('toggle');
    expect(state.latched).toBe(true);
    expect(mobileSneakIntent(state, false).descend).toBe(false);
    state = up(down(state));
    expect(state.latched).toBe(false);
    expect(sneakButtonActive(state)).toBe(false);
  });

  it('holds descend only while the finger is down in flight, including cancel and a second tap', () => {
    expect(mobileSneakFlightHold('creative', true)).toBe(true);
    const world = new TestWorld();
    const player = flyingPlayer();
    let state = mobileSneakAfterFlight(MOBILE_SNEAK_IDLE, true);
    state = down(state);
    expect(state.latched).toBe(false);
    expect(sneakButtonActive(state)).toBe(true);
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: false, descend: true });
    tick(player, world, move(mobileSneakIntent(state, false)));
    const falling = player.velocity.y;
    expect(falling).toBeLessThan(0);
    expect(player.isFlying).toBe(true);

    tick(player, world, move(mobileSneakIntent(state, false)));
    const deepest = player.velocity.y;
    expect(deepest).toBeLessThan(falling);

    state = up(state);
    expect(state.pressed).toBe(false);
    expect(sneakButtonActive(state)).toBe(false);
    tick(player, world, move(mobileSneakIntent(state, false)));
    const released = player.velocity.y;
    expect(released).toBeGreaterThan(deepest);

    state = down(state);
    const again = player.velocity.y;
    tick(player, world, move(mobileSneakIntent(state, false)));
    expect(player.velocity.y).toBeLessThan(again);
    state = up(state);
    expect(state.latched).toBe(false);
    expect(mobileSneakIntent(state, false).descend).toBe(false);
    const beforeRecover = player.velocity.y;
    tick(player, world, move(mobileSneakIntent(state, false)));
    expect(player.velocity.y).toBeGreaterThan(beforeRecover);
    expect(player.isFlying).toBe(true);
  });

  it('treats pointer cancel as a release and ignores a second finger', () => {
    let state = mobileSneakAfterFlight(MOBILE_SNEAK_IDLE, true);
    state = down(state, 4);
    state = down(state, 9);
    expect(state.pointerId).toBe(4);
    expect(state.pressed).toBe(true);
    state = up(state, 9);
    expect(state.pressed).toBe(true);
    state = up(state, 4);
    expect(state.pressed).toBe(false);
    expect(mobileSneakIntent(state, false).descend).toBe(false);
    expect(inputSource).toContain("button.addEventListener('pointercancel', up)");
    expect(inputSource).toContain("else if (action === 'sneak') this.releaseSneak(event.pointerId)");
  });

  it('clears a ground latch when flight starts so the player does not descend', () => {
    const world = new TestWorld();
    const player = flyingPlayer();
    let state = up(down(MOBILE_SNEAK_IDLE));
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: true, descend: false });
    tick(player, world, move(mobileSneakIntent(state, false)));
    expect(player.velocity.y).toBeCloseTo(0, 5);

    state = mobileSneakAfterFlight(state, true);
    expect(state.latched).toBe(false);
    expect(state.mode).toBe('flight-hold');
    expect(sneakButtonActive(state)).toBe(false);
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: false, descend: false });
    tick(player, world, move(mobileSneakIntent(state, false)));
    expect(player.velocity.y).toBeCloseTo(0, 5);
    expect(player.isFlying).toBe(true);
  });

  it('does not turn a flight press into a ground latch after landing', () => {
    const world = ground();
    const player = new PlayerController({ position: [0.5, 2.2, 0.5] });
    player.creativeFlightAllowed = true;
    player.isFlying = true;
    let state = mobileSneakAfterFlight(MOBILE_SNEAK_IDLE, true);
    state = down(state);
    let guard = 0;
    while (player.isFlying && guard < 40) {
      tick(player, world, move(mobileSneakIntent(state, false)));
      guard += 1;
    }
    expect(player.isFlying).toBe(false);
    expect(guard).toBeGreaterThan(0);

    state = mobileSneakAfterFlight(state, player.isFlying);
    expect(state.mode).toBe('toggle');
    expect(state.latched).toBe(false);
    expect(state.pressed).toBe(true);
    expect(mobileSneakIntent(state, false).sneak).toBe(false);
    state = up(state);
    expect(state.latched).toBe(false);
    expect(sneakButtonActive(state)).toBe(false);
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: false, descend: false });

    const grounded = new PlayerController({ position: [0.5, 1, 0.5] });
    state = up(down(state));
    expect(state.latched).toBe(true);
    tick(grounded, world, move(mobileSneakIntent(state, false)));
    expect(grounded.sneaking).toBe(true);
    expect(grounded.isFlying).toBe(false);
  });

  it('drops the finger and the latch together on a full reset', () => {
    let state = up(down(MOBILE_SNEAK_IDLE));
    state = mobileSneakRelease(state);
    expect(state.latched).toBe(false);
    expect(state.pressed).toBe(false);
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: false, descend: false });
    expect(inputSource).toContain('this.sneak = mobileSneakRelease(this.sneak)');
    expect(inputSource).toContain('this.syncSneakButton()');
  });

  it('keeps desktop Shift as sneak and descend without a mobile latch', () => {
    const desktop = mobileSneakIntent(MOBILE_SNEAK_IDLE, true);
    expect(desktop).toEqual({ sneak: true, descend: true });
    const world = new TestWorld();
    const player = flyingPlayer();
    tick(player, world, move(desktop));
    const falling = player.velocity.y;
    expect(falling).toBeLessThan(0);
    tick(player, world, move(mobileSneakIntent(MOBILE_SNEAK_IDLE, false)));
    expect(player.velocity.y).toBeGreaterThan(falling);
    expect(player.isFlying).toBe(true);

    const walker = new PlayerController({ position: [0.5, 1, 0.5] });
    tick(walker, ground(), move(desktop));
    expect(walker.sneaking).toBe(true);
    expect(walker.isFlying).toBe(false);
    tick(walker, ground(), move(mobileSneakIntent(MOBILE_SNEAK_IDLE, false)));
    expect(walker.sneaking).toBe(false);
  });
});

describe('flight descend stays aligned online', () => {
  function snapshot(player: PlayerController, seq: number) {
    return {
      id: 'self',
      name: 'self',
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw: 0,
      pitch: 0,
      vx: player.velocity.x,
      vy: player.velocity.y,
      vz: player.velocity.z,
      health: 20,
      gamemode: 'creative' as const,
      sneaking: player.sneaking,
      sprinting: player.sprinting,
      onGround: player.onGround,
      selectedSlot: 0,
      flying: player.isFlying,
      inputSeq: seq,
    };
  }

  it('accepts descend false, true, then false, and a replay does not keep descending', () => {
    const world = new TestWorld() as unknown as VoxelWorld;
    const client = flyingPlayer();
    const server = flyingPlayer();
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    const samples = [false, true, false];
    const moves = samples.map((descend, index) => predictedMoveFromInput(
      index + 1,
      move({ sneak: false, descend }),
      { yaw: 0, pitch: 0 },
      true,
    ));
    let falling = 0;
    moves.forEach((predicted, index) => {
      predictLocalMove(client, world, buffer, predicted);
      server.tick(world, {
        yaw: 0,
        pitch: 0,
        movement: () => move({ sneak: false, descend: samples[index]! }),
      }, FIXED_DT);
      if (samples[index]) falling = server.velocity.y;
      const result = reconcilePredictedPlayer(client, world, buffer, snapshot(server, index + 1), undefined, {
        physicsTicks: 1,
        serverTick: index + 1,
      });
      expect(result.kind).toBe('accepted');
      expect(client.isFlying).toBe(server.isFlying);
      expect(client.velocity.y).toBeCloseTo(server.velocity.y, 5);
    });
    expect(falling).toBeLessThan(0);
    expect(server.velocity.y).toBeGreaterThan(falling);
    expect(server.isFlying).toBe(true);

    const replayed = flyingPlayer();
    const replayBuffer = createPredictionBuffer();
    seedPredictionCheckpoint(replayBuffer, replayed.captureMovementState(), 0);
    replayUnackedMoves(replayed, world, moves);
    expect(replayed.velocity.y).toBeCloseTo(server.velocity.y, 5);
    expect(replayed.isFlying).toBe(true);
    const afterRelease = replayed.velocity.y;
    tick(replayed, new TestWorld(), move({ sneak: false, descend: false }));
    expect(replayed.velocity.y).toBeGreaterThan(afterRelease);
  });

  it('syncs the flight-hold mode after the tick, the prediction, and the reconcile', () => {
    const online = gameSource.slice(gameSource.indexOf('private tickOnline('), gameSource.indexOf('private tick():'));
    expect(online.indexOf('predictLocalMove')).toBeLessThan(online.indexOf('this.syncMobileSneakMode(session)'));
    const players = gameSource.slice(gameSource.indexOf('tickPlayers: () => {'), gameSource.indexOf('tickPlayerActions: () => {'));
    expect(players.indexOf('session.player.tick')).toBeLessThan(players.indexOf('this.syncMobileSneakMode(session)'));
    const apply = gameSource.slice(
      gameSource.indexOf('private applyLocalPlayerSnapshot('),
      gameSource.indexOf('private noteLocalSnapshotTiming('),
    );
    expect(apply.indexOf('reconcilePredictedPlayer')).toBeLessThan(apply.indexOf('this.syncMobileSneakMode(session)'));
    expect(gameSource).toContain('mobileSneakFlightHold(gamemode, session.player.isFlying)');
  });
});

/** The inventory handler applies this before it returns. No player tick in between. */
function afterAuthoritativeGamemode(
  state: MobileSneakState,
  gamemode: string,
  isFlying: boolean,
): MobileSneakState {
  return mobileSneakAfterFlight(state, mobileSneakFlightHold(gamemode, isFlying));
}

describe('authoritative gamemode updates the crouch policy before the next sample', () => {
  it('turns creative flight-hold into a survival toggle before any tick, so the next tap latches', () => {
    let state = afterAuthoritativeGamemode(MOBILE_SNEAK_IDLE, 'creative', true);
    expect(state.mode).toBe('flight-hold');
    expect(state.latched).toBe(false);

    state = afterAuthoritativeGamemode(state, 'survival', true);
    expect(state.mode).toBe('toggle');
    expect(state.latched).toBe(false);
    expect(mobileSneakFlightHold('survival', true)).toBe(false);

    state = up(down(state));
    expect(state.latched).toBe(true);
    expect(state.pressed).toBe(false);
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: true, descend: false });
  });

  it('keeps a finger that was already down from becoming a latch when survival arrives', () => {
    let state = down(afterAuthoritativeGamemode(MOBILE_SNEAK_IDLE, 'creative', true));
    expect(state.mode).toBe('flight-hold');
    expect(state.pressed).toBe(true);
    expect(mobileSneakIntent(state, false).descend).toBe(true);

    state = afterAuthoritativeGamemode(state, 'survival', true);
    expect(state.mode).toBe('toggle');
    expect(state.latched).toBe(false);
    expect(state.pressed).toBe(true);
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: false, descend: true });

    state = up(state);
    expect(state.pressed).toBe(false);
    expect(state.latched).toBe(false);
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: false, descend: false });

    state = up(down(state));
    expect(state.latched).toBe(true);
    expect(mobileSneakIntent(state, false)).toEqual({ sneak: true, descend: false });
  });

  it('keeps grounded creative on the toggle, then clears the latch when flight actually starts', () => {
    let state = up(down(MOBILE_SNEAK_IDLE));
    expect(state.latched).toBe(true);
    state = afterAuthoritativeGamemode(state, 'creative', false);
    expect(state.mode).toBe('toggle');
    expect(state.latched).toBe(true);

    let clean = afterAuthoritativeGamemode(MOBILE_SNEAK_IDLE, 'creative', false);
    expect(clean.mode).toBe('toggle');
    clean = up(down(clean));
    expect(clean.latched).toBe(true);
    expect(mobileSneakIntent(clean, false).descend).toBe(false);

    clean = afterAuthoritativeGamemode(clean, 'creative', true);
    expect(clean.mode).toBe('flight-hold');
    expect(clean.latched).toBe(false);
    expect(sneakButtonActive(clean)).toBe(false);
    expect(mobileSneakIntent(clean, false)).toEqual({ sneak: false, descend: false });
  });

  it('applies the sneak policy inside the inventory gamemode handler before movement is sampled', () => {
    const inventory = gameSource.slice(gameSource.indexOf("case 'inventory':"), gameSource.indexOf("case 'error':"));
    const assigned = inventory.indexOf('session.summary.mode = message.gamemode');
    const synced = inventory.indexOf('this.syncLocalCreativeFlight(session, message.gamemode)');
    expect(assigned).toBeGreaterThanOrEqual(0);
    expect(synced).toBeGreaterThan(assigned);
    expect(inventory).not.toContain('this.input.movement()');
    expect(inventory.indexOf('return;')).toBeGreaterThan(synced);

    const sync = gameSource.slice(
      gameSource.indexOf('private syncLocalCreativeFlight('),
      gameSource.indexOf('private syncMobileSneakMode('),
    );
    expect(sync.indexOf('syncCreativeFlightAllowed(session.player, gamemode)'))
      .toBeLessThan(sync.indexOf('this.input.setJumpLockAllowed(gamemode !== \'creative\')'));
    expect(sync.indexOf('this.input.setJumpLockAllowed(gamemode !== \'creative\')'))
      .toBeLessThan(sync.indexOf('this.syncMobileSneakMode(session, gamemode)'));

    const sneak = gameSource.slice(
      gameSource.indexOf('private syncMobileSneakMode('),
      gameSource.indexOf('private setGameMode('),
    );
    expect(sneak).toContain('mobileSneakFlightHold(gamemode, session.player.isFlying)');
    const writer = gameSource.slice(
      gameSource.indexOf('private recordLocalNetWrite('),
      gameSource.indexOf('private noteWorldNearPlayer('),
    );
    expect(writer.indexOf('apply();')).toBeGreaterThanOrEqual(0);
    expect(writer.indexOf('apply();')).toBeLessThan(writer.indexOf('return;'));
  });
});
