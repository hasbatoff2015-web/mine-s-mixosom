import { FIXED_DT } from './constants';
import { advanceFixedStep, interpolationAlpha } from './fixedStep';

export interface LocalSimPose {
  tick: number;
  time: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface LocalRenderSample {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  alpha: number;
  fromTick: number;
  toTick: number;
  renderTime: number;
  simTick: number;
  simTime: number;
}

export interface LocalRenderDeltaStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  negative: number;
  large: number;
}

const POSE_CAP = 8;
const SNAP_DISTANCE = 6;

function copyPose(pose: LocalSimPose): LocalSimPose {
  return {
    tick: pose.tick,
    time: pose.time,
    x: pose.x,
    y: pose.y,
    z: pose.z,
    vx: pose.vx,
    vy: pose.vy,
    vz: pose.vz,
  };
}

function poseFrom(
  tick: number,
  sample: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  dt = FIXED_DT,
): LocalSimPose {
  return {
    tick,
    time: tick * dt,
    x: sample.x,
    y: sample.y,
    z: sample.z,
    vx: sample.vx,
    vy: sample.vy,
    vz: sample.vz,
  };
}

function lerpPose(from: LocalSimPose, to: LocalSimPose, alpha: number): LocalRenderSample {
  const t = alpha;
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
    vx: from.vx + (to.vx - from.vx) * t,
    vy: from.vy + (to.vy - from.vy) * t,
    vz: from.vz + (to.vz - from.vz) * t,
    alpha: t,
    fromTick: from.tick,
    toTick: to.tick,
    renderTime: from.time + (to.time - from.time) * t,
    simTick: to.tick,
    simTime: to.time,
  };
}

/**
 * Local-player presentation clock. Physics keeps `previousPosition` for fall
 * distance; this buffer stores completed simulation poses and interpolates
 * only the adjacent pair that brackets `simTime - dt + leftover`.
 *
 * After N ticks in one rAF the last pair is S_{n-1}, S_n — never S_{n-N}, S_n,
 * which would pull the camera backward toward an older pose.
 */
export class LocalPlayerRenderState {
  private readonly poses: LocalSimPose[] = [];
  simTick = 0;

  constructor() {
    this.reset({ x: 0, y: 0, z: 0 });
  }

  reset(sample: { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number }, dt = FIXED_DT): void {
    this.simTick = 0;
    this.poses.length = 0;
    const pose = poseFrom(0, {
      x: sample.x,
      y: sample.y,
      z: sample.z,
      vx: sample.vx ?? 0,
      vy: sample.vy ?? 0,
      vz: sample.vz ?? 0,
    }, dt);
    this.poses.push(pose);
    this.poses.push(copyPose(pose));
  }

  get current(): LocalSimPose {
    return this.poses[this.poses.length - 1] ?? poseFrom(0, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }

  get previous(): LocalSimPose {
    return this.poses[this.poses.length - 2] ?? this.current;
  }

  snapTo(sample: { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number }, dt = FIXED_DT): void {
    const pose = poseFrom(this.simTick, {
      x: sample.x,
      y: sample.y,
      z: sample.z,
      vx: sample.vx ?? 0,
      vy: sample.vy ?? 0,
      vz: sample.vz ?? 0,
    }, dt);
    this.poses.length = 0;
    this.poses.push(copyPose(pose));
    this.poses.push(pose);
  }

  /** Call once after each completed physics tick. */
  pushAfterTick(
    sample: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
    dt = FIXED_DT,
  ): void {
    const last = this.current;
    const dist = Math.hypot(sample.x - last.x, sample.y - last.y, sample.z - last.z);
    this.simTick += 1;
    if (dist >= SNAP_DISTANCE) {
      this.snapTo(sample, dt);
      return;
    }
    this.poses.push(poseFrom(this.simTick, sample, dt));
    while (this.poses.length > POSE_CAP) this.poses.shift();
  }

  /**
   * leftover is `advanceFixedStep.nextAccumulator`. Display time is always
   * inside the last completed tick interval: [simTime - dt, simTime].
   */
  sample(leftover: number, dt = FIXED_DT): LocalRenderSample {
    const curr = this.current;
    const prev = this.previous;
    const alpha = interpolationAlpha(leftover, dt);
    const sampled = lerpPose(prev, curr, alpha);
    sampled.simTick = this.simTick;
    sampled.simTime = curr.time;
    sampled.renderTime = curr.time - dt + leftover;
    return sampled;
  }
}

export interface RenderFrameTimeline {
  ticks: number;
  leftoverBefore: number;
  leftoverAfter: number;
  elapsed: number;
  states: LocalSimPose[];
  alpha: number;
  render: LocalRenderSample;
}

export function describeTickTimeline(
  render: LocalPlayerRenderState,
  leftoverBefore: number,
  elapsed: number,
  posesAfterEachTick: Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number }>,
  dt = FIXED_DT,
): RenderFrameTimeline {
  const leftoverAfter = leftoverBefore + elapsed - posesAfterEachTick.length * dt;
  const states: LocalSimPose[] = [];
  for (const pose of posesAfterEachTick) {
    render.pushAfterTick(pose, dt);
    states.push(copyPose(render.current));
  }
  const leftover = leftoverAfter < 1e-12 ? 0 : leftoverAfter;
  const sampled = render.sample(leftover, dt);
  return {
    ticks: posesAfterEachTick.length,
    leftoverBefore,
    leftoverAfter: leftover,
    elapsed,
    states,
    alpha: sampled.alpha,
    render: sampled,
  };
}

export function signedHorizontalDelta(
  from: { x: number; z: number },
  to: { x: number; z: number },
  along: { x: number; z: number },
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(along.x, along.z);
  if (len < 1e-8) return dx * 0 + dz;
  return (dx * along.x + dz * along.z) / len;
}

export function summarizeRenderDeltas(
  deltas: readonly number[],
  largeThreshold: number,
): LocalRenderDeltaStats {
  if (deltas.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, negative: 0, large: 0 };
  }
  let min = deltas[0]!;
  let max = deltas[0]!;
  let sum = 0;
  let negative = 0;
  let large = 0;
  for (const value of deltas) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    if (value < -1e-6) negative += 1;
    if (value > largeThreshold) large += 1;
  }
  return {
    count: deltas.length,
    min,
    max,
    mean: sum / deltas.length,
    negative,
    large,
  };
}

/** Constant-velocity sim: z += speed * dt per tick. No physics, no network. */
export function runSyntheticRenderLoop(options: {
  seconds: number;
  frameDt: number;
  speed: number;
  dt?: number;
}): { samples: LocalRenderSample[]; deltas: number[]; stats: LocalRenderDeltaStats } {
  const dt = options.dt ?? FIXED_DT;
  const render = new LocalPlayerRenderState();
  render.reset({ x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: options.speed }, dt);
  let accumulator = 0;
  let z = 0;
  const samples: LocalRenderSample[] = [];
  for (let time = 0; time < options.seconds - 1e-12; time += options.frameDt) {
    const stepped = advanceFixedStep(accumulator, options.frameDt, dt);
    accumulator = stepped.nextAccumulator;
    for (let i = 0; i < stepped.ticks; i += 1) {
      z += options.speed * dt;
      render.pushAfterTick({ x: 0, y: 1, z, vx: 0, vy: 0, vz: options.speed }, dt);
    }
    samples.push(render.sample(accumulator, dt));
  }
  const deltas: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    deltas.push(samples[i]!.z - samples[i - 1]!.z);
  }
  return {
    samples,
    deltas,
    stats: summarizeRenderDeltas(deltas, options.speed * options.frameDt * 1.5 + 1e-6),
  };
}
