import { BlockId, getBlockDefinition } from '../blocks';
import { FIXED_DT, WALK_SPEED } from '../core/constants';
import type { MoveInput } from '../input/MoveInput';
import type { VoxelWorld } from '../world/World';
import { PlayerController, type PlayerInputSource, type PlayerMovementState } from './PlayerController';

class FlatProbeWorld {
  readonly floorY: number;

  constructor(floorY = 0) {
    this.floorY = floorY;
  }

  getBlock(_x: number, y: number, _z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    if (y === this.floorY) return BlockId.Stone;
    return BlockId.Air;
  }

  getBlockState(): undefined {
    return undefined;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }
}

const idleMove: MoveInput = {
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  sneak: false,
  descend: false,
  flySprint: false,
};

export function walkStepDistance(): number {
  return WALK_SPEED * FIXED_DT;
}

export interface MoveSimInput {
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

export interface MoveSimTickDiff {
  readonly tick: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly dvx: number;
  readonly dvy: number;
  readonly dvz: number;
  readonly onGroundA: boolean;
  readonly onGroundB: boolean;
  readonly flyingA: boolean;
  readonly flyingB: boolean;
  readonly dist: number;
}

export interface MoveSimCompareResult {
  readonly identical: boolean;
  readonly firstDivergedTick: number | null;
  readonly ticks: number;
  readonly diffs: MoveSimTickDiff[];
  readonly a: PlayerMovementState;
  readonly b: PlayerMovementState;
}

function sourceFrom(input: MoveSimInput): PlayerInputSource {
  const movement: MoveInput = {
    ...idleMove,
    forward: input.forward ?? 0,
    right: input.right ?? 0,
    jump: input.jump === true,
    sneak: input.sneak === true,
    sprint: input.sprint === true,
    descend: input.descend === true,
    flySprint: input.flySprint === true,
  };
  return {
    yaw: input.yaw ?? 0,
    pitch: input.pitch ?? 0,
    locomotion: true,
    movement: () => movement,
  };
}

function groundedController(world: VoxelWorld, y = 1): PlayerController {
  const player = new PlayerController({ position: [0.5, y, 0.5] });
  player.tick(world, sourceFrom({}), FIXED_DT);
  return player;
}

function stateError(a: PlayerController, b: PlayerController): Omit<MoveSimTickDiff, 'tick'> {
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const dz = b.position.z - a.position.z;
  const dvx = b.velocity.x - a.velocity.x;
  const dvy = b.velocity.y - a.velocity.y;
  const dvz = b.velocity.z - a.velocity.z;
  return {
    dx, dy, dz, dvx, dvy, dvz,
    onGroundA: a.onGround,
    onGroundB: b.onGround,
    flyingA: a.isFlying,
    flyingB: b.isFlying,
    dist: Math.hypot(dx, dy, dz),
  };
}

const EPS = 1e-9;

function diverged(diff: Omit<MoveSimTickDiff, 'tick'>): boolean {
  return diff.dist > EPS
    || Math.hypot(diff.dvx, diff.dvy, diff.dvz) > EPS
    || diff.onGroundA !== diff.onGroundB
    || diff.flyingA !== diff.flyingB;
}

/**
 * Same PlayerController, same flat world, same input, same dt.
 * If this diverges, client/server physics code is not deterministic.
 */
export function compareLockstepControllers(
  ticks = 20,
  input: MoveSimInput = { forward: 1 },
  dt = FIXED_DT,
): MoveSimCompareResult {
  const world = new FlatProbeWorld() as unknown as VoxelWorld;
  const a = groundedController(world);
  const b = groundedController(world);
  const source = sourceFrom(input);
  const diffs: MoveSimTickDiff[] = [];
  let firstDivergedTick: number | null = null;
  for (let tick = 1; tick <= ticks; tick += 1) {
    a.tick(world, source, dt);
    b.tick(world, source, dt);
    const error = stateError(a, b);
    if (diverged(error)) {
      diffs.push({ tick, ...error });
      if (firstDivergedTick === null) firstDivergedTick = tick;
    }
  }
  return {
    identical: firstDivergedTick === null,
    firstDivergedTick,
    ticks,
    diffs,
    a: a.captureMovementState(),
    b: b.captureMovementState(),
  };
}

export interface LatestInputCoalesceResult {
  readonly clientTicks: number;
  readonly serverTicks: number;
  readonly xz: number;
  readonly y: number;
  readonly dist: number;
  readonly walkStep: number;
}

/**
 * Client predicts `clientTicks` of held WASD; server simulates `serverTicks`
 * of the same latest input. This is latest-input coalescing, not a second
 * physics implementation.
 */
export function compareLatestInputCoalesce(
  clientTicks = 2,
  serverTicks = 1,
  input: MoveSimInput = { forward: 1 },
  warmup = 10,
): LatestInputCoalesceResult {
  const world = new FlatProbeWorld() as unknown as VoxelWorld;
  const client = groundedController(world);
  const server = groundedController(world);
  const source = sourceFrom(input);
  for (let i = 0; i < warmup; i += 1) {
    client.tick(world, source, FIXED_DT);
    server.tick(world, source, FIXED_DT);
  }
  for (let i = 0; i < clientTicks; i += 1) client.tick(world, source, FIXED_DT);
  for (let i = 0; i < serverTicks; i += 1) server.tick(world, source, FIXED_DT);
  const dx = server.position.x - client.position.x;
  const dy = server.position.y - client.position.y;
  const dz = server.position.z - client.position.z;
  return {
    clientTicks,
    serverTicks,
    xz: Math.hypot(dx, dz),
    y: Math.abs(dy),
    dist: Math.hypot(dx, dy, dz),
    walkStep: walkStepDistance(),
  };
}

export function formatMoveSimCompare(result: MoveSimCompareResult): string[] {
  const lines = [
    `lockstep ticks=${result.ticks} identical=${result.identical ? 'yes' : 'NO'} `
    + `first=${result.firstDivergedTick ?? 'none'}`,
  ];
  if (!result.identical) {
    const first = result.diffs[0]!;
    lines.push(
      `first dx=${first.dx.toFixed(6)} dy=${first.dy.toFixed(6)} dz=${first.dz.toFixed(6)} `
      + `dv=(${first.dvx.toFixed(6)},${first.dvy.toFixed(6)},${first.dvz.toFixed(6)}) `
      + `ground ${first.onGroundA}/${first.onGroundB} fly ${first.flyingA}/${first.flyingB}`,
    );
  }
  return lines;
}

export function formatLatestInputCoalesce(result: LatestInputCoalesceResult): string[] {
  return [
    `coalesce clientTicks=${result.clientTicks} serverTicks=${result.serverTicks} `
    + `xz=${result.xz.toFixed(4)} y=${result.y.toFixed(4)} dist=${result.dist.toFixed(4)} `
    + `walkStep=${result.walkStep.toFixed(4)}`,
  ];
}

export interface MoveSimModeOptions {
  readonly flying?: boolean;
  readonly startY?: number;
  readonly ticks?: readonly number[];
}

export interface PoseTickDump {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly onGround: boolean;
  readonly flying: boolean;
}

function flyingController(world: VoxelWorld, y: number): PlayerController {
  const player = new PlayerController({ position: [0.5, y, 0.5] });
  player.creativeFlightAllowed = true;
  player.isFlying = true;
  player.tick(world, sourceFrom({}), FIXED_DT);
  player.creativeFlightAllowed = true;
  player.isFlying = true;
  player.velocity.set(0, 0, 0);
  return player;
}

function controllerForMode(world: VoxelWorld, options: MoveSimModeOptions): PlayerController {
  if (options.flying) return flyingController(world, options.startY ?? 8);
  return groundedController(world, options.startY ?? 1);
}

export function dumpControllerTicks(
  ticks: readonly number[],
  input: MoveSimInput,
  options: MoveSimModeOptions = {},
  dt = FIXED_DT,
): PoseTickDump[] {
  const world = new FlatProbeWorld() as unknown as VoxelWorld;
  const player = controllerForMode(world, options);
  const source = sourceFrom(input);
  const wanted = new Set(ticks);
  const maxTick = Math.max(0, ...ticks);
  const dumps: PoseTickDump[] = [];
  dumps.push({
    tick: 0,
    x: player.position.x, y: player.position.y, z: player.position.z,
    vx: player.velocity.x, vy: player.velocity.y, vz: player.velocity.z,
    onGround: player.onGround, flying: player.isFlying,
  });
  for (let tick = 1; tick <= maxTick; tick += 1) {
    player.tick(world, source, dt);
    if (options.flying) {
      player.creativeFlightAllowed = true;
    }
    if (wanted.has(tick)) {
      dumps.push({
        tick,
        x: player.position.x, y: player.position.y, z: player.position.z,
        vx: player.velocity.x, vy: player.velocity.y, vz: player.velocity.z,
        onGround: player.onGround, flying: player.isFlying,
      });
    }
  }
  return dumps;
}

export function compareLockstepModes(
  ticks = 20,
  dt = FIXED_DT,
): Record<string, MoveSimCompareResult> {
  const walk = compareLockstepControllers(ticks, { forward: 1 }, dt);
  const strafe = compareLockstepControllers(ticks, { right: 1 }, dt);
  const jump = compareLockstepControllers(12, { jump: true }, dt);
  const idle = compareLockstepControllers(ticks, {}, dt);
  const world = new FlatProbeWorld() as unknown as VoxelWorld;
  const flyA = flyingController(world, 8);
  const flyB = flyingController(world, 8);
  const flyIdle = lockstepPair(flyA, flyB, ticks, {}, dt);
  const flyC = flyingController(world, 8);
  const flyD = flyingController(world, 8);
  const flyDescend = lockstepPair(flyC, flyD, ticks, { descend: true }, dt);
  return {
    stationary: idle,
    walk,
    strafe,
    jump,
    'flight-hover': flyIdle,
    'flight-descend': flyDescend,
  };
}

function lockstepPair(
  a: PlayerController,
  b: PlayerController,
  ticks: number,
  input: MoveSimInput,
  dt: number,
): MoveSimCompareResult {
  const world = new FlatProbeWorld() as unknown as VoxelWorld;
  const source = sourceFrom(input);
  const diffs: MoveSimTickDiff[] = [];
  let firstDivergedTick: number | null = null;
  for (let tick = 1; tick <= ticks; tick += 1) {
    a.tick(world, source, dt);
    b.tick(world, source, dt);
    a.creativeFlightAllowed = true;
    b.creativeFlightAllowed = true;
    const error = stateError(a, b);
    if (diverged(error)) {
      diffs.push({ tick, ...error });
      if (firstDivergedTick === null) firstDivergedTick = tick;
    }
  }
  return {
    identical: firstDivergedTick === null,
    firstDivergedTick,
    ticks,
    diffs,
    a: a.captureMovementState(),
    b: b.captureMovementState(),
  };
}

export function formatPoseDump(label: string, dumps: readonly PoseTickDump[]): string[] {
  return dumps.map((pose) => (
    `${label} t=${pose.tick} xyz=${pose.x.toFixed(6)} ${pose.y.toFixed(6)} ${pose.z.toFixed(6)} `
    + `v=${pose.vx.toFixed(6)} ${pose.vy.toFixed(6)} ${pose.vz.toFixed(6)} `
    + `ground=${pose.onGround} fly=${pose.flying}`
  ));
}
