import type { PlayerSnapshot } from '../../shared/protocol';
import type { MutableVec3, Vec3Like } from '../math/vec3';

export type { MutableVec3, Vec3Like } from '../math/vec3';

export const LOCAL_SNAP_DISTANCE = 6;
export const LOCAL_APPROACH_PER_SECOND = 18;

/**
 * Snapshot ingest helpers. Remote interpolation still uses tick gating and
 * look-lock. Local Anarchy motion no longer chases with `stepTowardTarget`;
 * see `localPlayerPrediction.ts`.
 */
export function shouldAcceptSnapshot(lastTick: number, tick: number): boolean {
  return Number.isInteger(tick) && tick > lastTick;
}

export function distanceSquared(a: Vec3Like, b: Vec3Like): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz;
}

export function splitPlayerSnapshots(
  localId: string,
  players: readonly PlayerSnapshot[],
): { local: PlayerSnapshot | undefined; remotes: PlayerSnapshot[] } {
  let local: PlayerSnapshot | undefined;
  const remotes: PlayerSnapshot[] = [];
  for (const player of players) {
    if (player.id === localId) local = player;
    else remotes.push(player);
  }
  return { local, remotes };
}

/** Foundation pass: camera look stays client-side. Server yaw/pitch are not applied to input. */
export function clientLookAfterSnapshot(
  clientLook: { readonly yaw: number; readonly pitch: number },
  _snapshotLook: { readonly yaw: number; readonly pitch: number },
): { yaw: number; pitch: number } {
  return { yaw: clientLook.yaw, pitch: clientLook.pitch };
}

export function ingestAuthoritativePosition(
  current: Vec3Like,
  snapshot: Vec3Like,
  snapDistance = LOCAL_SNAP_DISTANCE,
): { target: MutableVec3; position: MutableVec3; snapped: boolean } {
  const target = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
  const distSq = distanceSquared(current, target);
  if (distSq >= snapDistance * snapDistance) {
    return { target, position: { ...target }, snapped: true };
  }
  return {
    target,
    position: { x: current.x, y: current.y, z: current.z },
    snapped: false,
  };
}

/**
 * Exponential chase toward the last accepted server pose.
 * One 16 ms frame must not teleport a small error onto the target (that is the rubber-band).
 */
export function stepTowardTarget(
  current: Vec3Like,
  target: Vec3Like,
  dt: number,
  options?: { readonly snapDistance?: number; readonly approachPerSecond?: number },
): { x: number; y: number; z: number; snapped: boolean } {
  const snapDistance = options?.snapDistance ?? LOCAL_SNAP_DISTANCE;
  const approach = options?.approachPerSecond ?? LOCAL_APPROACH_PER_SECOND;
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dz = target.z - current.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= 1e-5) {
    return { x: target.x, y: target.y, z: target.z, snapped: false };
  }
  if (dist >= snapDistance) {
    return { x: target.x, y: target.y, z: target.z, snapped: true };
  }
  const t = 1 - Math.exp(-approach * Math.max(0, dt));
  return {
    x: current.x + dx * t,
    y: current.y + dy * t,
    z: current.z + dz * t,
    snapped: false,
  };
}
