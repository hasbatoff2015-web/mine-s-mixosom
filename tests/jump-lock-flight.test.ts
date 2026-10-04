import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import type { MoveInput } from '../src/input/MoveInput';
import { mobileAutoJumpArmed } from '../src/input/mobileTouch';
import {
  JUMP_LOCK_IDLE,
  jumpInputActive,
  jumpLockAfterPolicy,
  jumpLockPolicyAfterMode,
  type JumpLockState,
} from '../src/input/touchGesture';
import {
  createPredictionBuffer,
  predictLocalMove,
  predictedMoveFromInput,
  reconcilePredictedPlayer,
  replayUnackedMoves,
  seedPredictionCheckpoint,
} from '../src/net/localPlayerPrediction';
import { PlayerController } from '../src/player';
import { manualJumpLevel } from '../src/player/creativeFlight';
import { blockCollisionBoxes } from '../src/world/collision';
import type { VoxelWorld } from '../src/world/World';
import { parseClientMessage } from '../shared/protocol';

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

interface Gesture {
  allowed: boolean;
  pressed: boolean;
  lock: JumpLockState;
  downAt: number;
}

const idleMove: MoveInput = {
  forward: 0, right: 0, jump: false, manualJump: false, sprint: false, sneak: false,
};

function freshGesture(allowed = true): Gesture {
  return { allowed, pressed: false, lock: JUMP_LOCK_IDLE, downAt: 0 };
}

function allow(gesture: Gesture, allowed: boolean): Gesture {
  const policy = jumpLockPolicyAfterMode(gesture.allowed, allowed);
  if (!policy.clearGesture) return { ...gesture, allowed: policy.allowed };
  return { ...gesture, allowed: policy.allowed, lock: JUMP_LOCK_IDLE, downAt: 0 };
}

function press(gesture: Gesture, now: number): Gesture {
  return { ...gesture, pressed: true, downAt: now };
}

function release(gesture: Gesture, now: number, cancelled = false): Gesture {
  const next = jumpLockAfterPolicy(gesture.allowed, gesture.lock, gesture.downAt, now, cancelled);
  return { ...gesture, pressed: false, lock: next.lock, downAt: next.downAt };
}

function sample(gesture: Gesture, extra: { autoJump?: boolean; space?: boolean } = {}): MoveInput {
  const space = extra.space === true;
  const manualJump = space || gesture.pressed;
  return {
    ...idleMove,
    manualJump,
    jump: jumpInputActive({
      space,
      pressed: gesture.pressed,
      locked: gesture.allowed && gesture.lock.locked,
      autoJump: extra.autoJump === true,
    }),
  };
}

function flat(): TestWorld {
  const world = new TestWorld();
  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

function tick(player: PlayerController, world: TestWorld, movement: MoveInput, yaw = 0): void {
  player.tick(world as unknown as VoxelWorld, {
    yaw,
    pitch: 0,
    movement: () => movement,
  }, FIXED_DT);
}

function pulse(player: PlayerController, world: TestWorld, movement: MoveInput): void {
  tick(player, world, movement);
  tick(player, world, { ...movement, jump: false, manualJump: false });
}

describe('survival mobile jump lock', () => {
  it('jumps on the first tap, latches on the second, and a later double tap unlocks', () => {
    const world = flat();
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.creativeFlightAllowed = false;
    let gesture = freshGesture(true);

    gesture = press(gesture, 1_000);
    tick(player, world, sample(gesture));
    expect(player.velocity.y).toBeGreaterThan(0);
    expect(player.isFlying).toBe(false);
    gesture = release(gesture, 1_080);
    expect(gesture.lock.locked).toBe(false);

    gesture = press(gesture, 1_200);
    tick(player, world, sample(gesture));
    gesture = release(gesture, 1_260);
    expect(gesture.lock.locked).toBe(true);
    expect(player.isFlying).toBe(false);

    tick(player, world, sample(gesture));
    expect(sample(gesture).jump).toBe(true);
    expect(sample(gesture).manualJump).toBe(false);
    expect(player.isFlying).toBe(false);

    gesture = press(gesture, 2_000);
    gesture = release(gesture, 2_080);
    gesture = press(gesture, 2_200);
    gesture = release(gesture, 2_260);
    expect(gesture.lock.locked).toBe(false);
    expect(sample(gesture).jump).toBe(false);
  });

  it('holds jump without latching, and pointercancel does not latch', () => {
    const world = flat();
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    let gesture = press(freshGesture(true), 1_000);
    tick(player, world, sample(gesture));
    tick(player, world, sample(gesture));
    expect(player.velocity.y).toBeGreaterThan(0);
    expect(gesture.lock.locked).toBe(false);
    gesture = release(gesture, 1_000 + 400);
    expect(gesture.lock.locked).toBe(false);

    gesture = press(gesture, 2_000);
    gesture = release(gesture, 2_080, true);
    gesture = press(gesture, 2_200);
    gesture = release(gesture, 2_260, true);
    expect(gesture.lock.locked).toBe(false);
  });
});

describe('creative mobile jump does not latch', () => {
  it('a single tap jumps and leaves flight and the latch off', () => {
    const world = flat();
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.creativeFlightAllowed = true;
    let gesture = allow(freshGesture(true), false);
    gesture = press(gesture, 1_000);
    tick(player, world, sample(gesture));
    expect(player.velocity.y).toBeGreaterThan(0);
    gesture = release(gesture, 1_080);
    expect(player.isFlying).toBe(false);
    expect(gesture.lock.locked).toBe(false);
    expect(sample(gesture).jump).toBe(false);
  });

  it('two manual taps inside the flight window toggle flight and never latch', () => {
    const world = flat();
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.creativeFlightAllowed = true;
    let gesture = allow(freshGesture(true), false);

    gesture = press(gesture, 1_000);
    tick(player, world, sample(gesture));
    gesture = release(gesture, 1_080);
    tick(player, world, sample(gesture));
    expect(player.isFlying).toBe(false);
    expect(gesture.lock.locked).toBe(false);

    gesture = press(gesture, 1_200);
    tick(player, world, sample(gesture));
    gesture = release(gesture, 1_260);
    expect(player.isFlying).toBe(true);
    expect(gesture.lock.locked).toBe(false);
    expect(sample(gesture).jump).toBe(false);

    tick(player, world, sample(gesture));
    gesture = press(gesture, 2_000);
    tick(player, world, sample(gesture));
    gesture = release(gesture, 2_060);
    tick(player, world, sample(gesture));
    gesture = press(gesture, 2_160);
    tick(player, world, sample(gesture));
    gesture = release(gesture, 2_220);
    expect(player.isFlying).toBe(false);
    expect(gesture.lock.locked).toBe(false);
  });

  it('cannot create a jump latch while creative, even from two fast taps', () => {
    let gesture = allow(freshGesture(true), false);
    gesture = press(gesture, 5_000);
    gesture = release(gesture, 5_040);
    gesture = press(gesture, 5_100);
    gesture = release(gesture, 5_140);
    expect(gesture.lock).toEqual(JUMP_LOCK_IDLE);
    expect(sample(gesture).jump).toBe(false);
  });
});

describe('gamemode switch clears the latch', () => {
  it('drops a survival latch immediately when creative begins', () => {
    let gesture = freshGesture(true);
    gesture = press(gesture, 1_000);
    gesture = release(gesture, 1_080);
    gesture = press(gesture, 1_200);
    gesture = release(gesture, 1_260);
    expect(gesture.lock.locked).toBe(true);
    expect(sample(gesture).jump).toBe(true);

    gesture = allow(gesture, false);
    expect(gesture.lock.locked).toBe(false);
    expect(gesture.downAt).toBe(0);
    expect(sample(gesture).jump).toBe(false);
    expect(sample(gesture).manualJump).toBe(false);
  });

  it('does not inherit a creative press as the first survival tap', () => {
    let gesture = allow(freshGesture(true), false);
    gesture = press(gesture, 1_000);
    gesture = allow(gesture, true);
    gesture = release(gesture, 1_080);
    expect(gesture.lock.locked).toBe(false);
    expect(gesture.lock.lastTapAt).toBe(0);

    gesture = press(gesture, 1_200);
    gesture = release(gesture, 1_260);
    expect(gesture.lock.locked).toBe(false);
    gesture = press(gesture, 1_400);
    gesture = release(gesture, 1_460);
    expect(gesture.lock.locked).toBe(true);
  });
});

describe('creative auto-jump is not a flight tap', () => {
  it('hops a one-block wall, and one later manual tap does not start flight', () => {
    const world = flat();
    world.set(1, 1, 0, BlockId.Stone);
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.creativeFlightAllowed = true;
    const yaw = -Math.PI / 2;
    let armed = false;
    let jumped = 0;
    for (let i = 0; i < 8 && jumped === 0; i += 1) {
      const jump = armed;
      armed = false;
      tick(player, world, {
        forward: 1, right: 0, jump, manualJump: false, sprint: false, sneak: false,
      }, yaw);
      if (player.velocity.y > 1) jumped += 1;
      armed = mobileAutoJumpArmed({
        touchLayout: true,
        onGround: player.onGround,
        sneaking: player.sneaking,
        flying: player.isFlying,
        inWater: player.inWater,
        inLava: player.inLava,
        onLadder: player.onLadder,
        yaw,
        forward: 1,
        right: 0,
        feetX: player.position.x,
        feetY: player.position.y,
        feetZ: player.position.z,
        boxesAt: (x, y, z) => blockCollisionBoxes(world as unknown as VoxelWorld, x, y, z),
      });
    }
    expect(jumped).toBeGreaterThan(0);
    expect(player.isFlying).toBe(false);

    tick(player, world, { ...idleMove, jump: true, manualJump: true }, yaw);
    expect(player.isFlying).toBe(false);
    tick(player, world, idleMove, yaw);
    tick(player, world, { ...idleMove, jump: true, manualJump: true }, yaw);
    expect(player.isFlying).toBe(true);
  });

  it('treats an omitted manual bit as the legacy jump edge', () => {
    expect(manualJumpLevel({ jump: true })).toBe(true);
    expect(manualJumpLevel({ jump: true, manualJump: false })).toBe(false);
    const world = flat();
    const legacy = new PlayerController({ position: [0.5, 1, 0.5] });
    legacy.creativeFlightAllowed = true;
    pulse(legacy, world, { ...idleMove, jump: true, manualJump: undefined });
    pulse(legacy, world, { ...idleMove, jump: true, manualJump: undefined });
    expect(legacy.isFlying).toBe(true);

    const desktop = new PlayerController({ position: [0.5, 1, 0.5] });
    desktop.creativeFlightAllowed = true;
    pulse(desktop, world, { ...idleMove, jump: true, manualJump: true });
    pulse(desktop, world, { ...idleMove, jump: true, manualJump: true });
    expect(desktop.isFlying).toBe(true);

    const survival = new PlayerController({ position: [0.5, 1, 0.5] });
    survival.creativeFlightAllowed = false;
    pulse(survival, world, { ...idleMove, jump: true, manualJump: true });
    pulse(survival, world, { ...idleMove, jump: true, manualJump: true });
    expect(survival.isFlying).toBe(false);
  });
});

describe('online creative flight follows the manual edge', () => {
  function ground(): VoxelWorld {
    return flat() as unknown as VoxelWorld;
  }

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

  function pair() {
    const world = ground();
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.creativeFlightAllowed = true;
    server.creativeFlightAllowed = true;
    tick(client, flat(), idleMove);
    server.applyMovementState(client.captureMovementState());
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    const step = (seq: number, movement: MoveInput) => {
      predictLocalMove(client, world, buffer, predictedMoveFromInput(seq, movement, { yaw: 0, pitch: 0 }, true));
      server.tick(world, { yaw: 0, pitch: 0, movement: () => movement }, FIXED_DT);
      const result = reconcilePredictedPlayer(client, world, buffer, snapshot(server, seq), undefined, {
        physicsTicks: 1,
        serverTick: seq,
      });
      expect(result.kind, `seq ${seq}`).toBe('accepted');
      expect(client.isFlying).toBe(server.isFlying);
    };
    return { world, client, server, buffer, step };
  }

  it('does not toggle when auto-jump is followed by one manual press', () => {
    const { step, client } = pair();
    step(1, { ...idleMove, forward: 1, jump: true, manualJump: false });
    step(2, { ...idleMove, jump: true, manualJump: true });
    expect(client.isFlying).toBe(false);
    step(3, idleMove);
    step(4, { ...idleMove, jump: true, manualJump: true });
    expect(client.isFlying).toBe(true);
  });

  it('replays a held manual jump once and does not toggle twice', () => {
    const world = ground();
    const client = new PlayerController({ position: [0.5, 4, 0.5] });
    const server = new PlayerController({ position: [0.5, 4, 0.5] });
    client.creativeFlightAllowed = true;
    server.creativeFlightAllowed = true;
    client.isFlying = false;
    const held = { ...idleMove, jump: true, manualJump: true };
    const moves = [1, 2, 3].map((seq) => predictedMoveFromInput(seq, held, { yaw: 0, pitch: 0 }, true));
    for (const move of moves) {
      predictLocalMove(client, world, createPredictionBuffer(), move);
      server.tick(world, { yaw: 0, pitch: 0, movement: () => held }, FIXED_DT);
    }
    expect(server.isFlying).toBe(false);
    expect(client.isFlying).toBe(false);

    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    const rewind = new PlayerController({ position: [0.5, 4, 0.5] });
    rewind.creativeFlightAllowed = true;
    predictLocalMove(rewind, world, buffer, moves[0]!);
    const armed = rewind.captureMovementState();
    expect(armed.jumpHeld).toBe(true);
    expect(armed.isFlying).toBe(false);
    rewind.applyMovementState(armed);
    replayUnackedMoves(rewind, world, [moves[1]!, moves[2]!]);
    expect(rewind.isFlying).toBe(false);
    expect(rewind.captureMovementState().jumpHeld).toBe(true);
  });
});

describe('manual jump on the wire', () => {
  it('keeps a boolean manualJump and rejects a forged one', () => {
    const parsed = parseClientMessage({
      type: 'input',
      seq: 4,
      forward: 0,
      right: 0,
      jump: true,
      manualJump: false,
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      yaw: 0,
      pitch: 0,
      selectedSlot: 0,
    });
    expect(parsed).toMatchObject({ jump: true, manualJump: false });
    expect(parseClientMessage({
      type: 'input',
      seq: 4,
      forward: 0,
      right: 0,
      jump: true,
      manualJump: 'yes',
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      yaw: 0,
      pitch: 0,
      selectedSlot: 0,
    })).toEqual({ error: 'input.manualJump invalid' });
  });
});
