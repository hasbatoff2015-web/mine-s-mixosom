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
