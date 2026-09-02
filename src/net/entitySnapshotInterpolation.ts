import { ENTITY_SNAP_DISTANCE } from '../core/constants';
import { lerpAngle } from '../core/entityInterpolation';
import { shouldAcceptSnapshot } from './authoritativeMotion';

/** Same delay as remote players: absorb one 20 TPS snapshot of jitter without FPS-tied lerp. */
export const ENTITY_INTERP_DELAY_MS = 80;
const MAX_SAMPLES = 8;
const TELEPORT_DISTANCE_SQ = ENTITY_SNAP_DISTANCE * ENTITY_SNAP_DISTANCE;

export interface EntityPoseSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly tick: number;
  readonly at: number;
}

export interface SampledEntityPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly snapped: boolean;
  readonly spawned: boolean;
}

interface EntityTrack {
  samples: EntityPoseSample[];
  lastTick: number;
  spawned: boolean;
}

export function sampleEntityPose(
  samples: readonly EntityPoseSample[],
  now: number,
  delayMs = ENTITY_INTERP_DELAY_MS,
): SampledEntityPose | undefined {
  if (samples.length === 0) return undefined;
  if (samples.length === 1) {
    const only = samples[0]!;
    return { ...only, snapped: false, spawned: true };
  }
  const renderAt = now - delayMs;
  let index = 0;
  while (index < samples.length && samples[index]!.at < renderAt) index += 1;
  if (index === 0) {
    const first = samples[0]!;
    return { ...first, snapped: false, spawned: false };
  }
  if (index >= samples.length) {
    const last = samples[samples.length - 1]!;
    return { ...last, snapped: false, spawned: false };
  }
  const previous = samples[index - 1]!;
  const next = samples[index]!;
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const dz = next.z - previous.z;
  if (dx * dx + dy * dy + dz * dz >= TELEPORT_DISTANCE_SQ) {
    return { ...next, snapped: true, spawned: false };
  }
  const span = Math.max(1, next.at - previous.at);
  const t = Math.max(0, Math.min(1, (renderAt - previous.at) / span));
  return {
    x: previous.x + dx * t,
    y: previous.y + dy * t,
    z: previous.z + dz * t,
    yaw: lerpAngle(previous.yaw, next.yaw, t),
    vx: previous.vx + (next.vx - previous.vx) * t,
    vy: previous.vy + (next.vy - previous.vy) * t,
    vz: previous.vz + (next.vz - previous.vz) * t,
    snapped: false,
    spawned: false,
  };
}

/**
 * Per-entity snapshot history. Render samples `now - delay` between two server poses.
 * Simulation result at a given timestamp does not depend on how often it is sampled (FPS).
 */
export class EntityInterpolationBuffer {
  private readonly tracks = new Map<string, EntityTrack>();
  lastTick = -1;

  acceptPacketTick(tick: number): boolean {
    if (!shouldAcceptSnapshot(this.lastTick, tick)) return false;
    this.lastTick = tick;
    return true;
  }

  ingest(
    id: string,
    pose: {
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly yaw?: number;
      readonly vx?: number;
      readonly vy?: number;
      readonly vz?: number;
    },
    tick: number,
    now: number,
  ): { spawned: boolean; accepted: boolean } {
    let track = this.tracks.get(id);
    if (!track) {
      track = { samples: [], lastTick: -1, spawned: true };
      this.tracks.set(id, track);
    }
    if (!shouldAcceptSnapshot(track.lastTick, tick)) {
      return { spawned: false, accepted: false };
    }
    track.lastTick = tick;
    const spawned = track.samples.length === 0;
    track.samples.push({
      x: pose.x,
      y: pose.y,
      z: pose.z,
      yaw: pose.yaw ?? 0,
      vx: pose.vx ?? 0,
      vy: pose.vy ?? 0,
      vz: pose.vz ?? 0,
      tick,
      at: now,
    });
    if (track.samples.length > MAX_SAMPLES) track.samples.shift();
    const wasSpawn = track.spawned && spawned;
    track.spawned = false;
    return { spawned: wasSpawn || spawned, accepted: true };
  }

  sample(id: string, now: number, delayMs = ENTITY_INTERP_DELAY_MS): SampledEntityPose | undefined {
    const track = this.tracks.get(id);
    if (!track) return undefined;
    return sampleEntityPose(track.samples, now, delayMs);
  }

  has(id: string): boolean {
    return this.tracks.has(id);
  }

  remove(id: string): void {
    this.tracks.delete(id);
  }

  /** Drop tracks that left the interest set. Returns removed ids (no leftover lerp). */
  retain(ids: ReadonlySet<string>): string[] {
    const removed: string[] = [];
    for (const id of [...this.tracks.keys()]) {
      if (ids.has(id)) continue;
      this.tracks.delete(id);
      removed.push(id);
    }
    return removed;
  }

  clear(): void {
    this.tracks.clear();
    this.lastTick = -1;
  }
}
