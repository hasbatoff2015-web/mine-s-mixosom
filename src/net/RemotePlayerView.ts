import * as THREE from 'three';
import type { PlayerSnapshot, RemotePlayerInfo } from '../../shared/protocol';
import { lerpAngle } from '../core/entityInterpolation';
import type { PlayerVisual } from '../rendering/player/PlayerVisual';
import type { VoxelWorld } from '../world/World';
import { shouldAcceptSnapshot } from './authoritativeMotion';

export const REMOTE_INTERP_DELAY_MS = 80;
const MAX_SAMPLES = 8;

export interface RemotePoseSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  sneaking?: boolean;
  sprinting?: boolean;
  onGround?: boolean;
  invisible?: boolean;
  at: number;
}

export interface RemotePlayerViewOptions {
  readonly visual: PlayerVisual;
  readonly world: VoxelWorld;
}

function poseSample(snapshot: PlayerSnapshot | RemotePlayerInfo, at: number): RemotePoseSample {
  const state = snapshot as PlayerSnapshot;
  return {
    x: snapshot.x,
    y: snapshot.y,
    z: snapshot.z,
    yaw: snapshot.yaw,
    pitch: snapshot.pitch,
    vx: state.vx ?? 0,
    vy: state.vy ?? 0,
    vz: state.vz ?? 0,
    sneaking: state.sneaking ?? false,
    sprinting: state.sprinting ?? false,
    onGround: state.onGround ?? true,
    invisible: state.invisible ?? false,
    at,
  };
}

export function sampleRemotePose(
  samples: readonly RemotePoseSample[],
  now: number,
  delayMs = REMOTE_INTERP_DELAY_MS,
): RemotePoseSample | undefined {
  if (samples.length === 0) return undefined;
  if (samples.length === 1) return samples[0];
  const renderAt = now - delayMs;
  let index = 0;
  while (index < samples.length && samples[index]!.at < renderAt) index += 1;
  if (index === 0) return samples[0];
  if (index >= samples.length) return samples[samples.length - 1];
  const previous = samples[index - 1]!;
  const next = samples[index]!;
  const span = Math.max(1, next.at - previous.at);
  const t = Math.max(0, Math.min(1, (renderAt - previous.at) / span));
  const discrete = t < 0.5 ? previous : next;
  return {
    x: previous.x + (next.x - previous.x) * t,
    y: previous.y + (next.y - previous.y) * t,
    z: previous.z + (next.z - previous.z) * t,
    yaw: lerpAngle(previous.yaw, next.yaw, t),
    pitch: (previous.pitch ?? 0) + ((next.pitch ?? 0) - (previous.pitch ?? 0)) * t,
    vx: (previous.vx ?? 0) + ((next.vx ?? 0) - (previous.vx ?? 0)) * t,
    vy: (previous.vy ?? 0) + ((next.vy ?? 0) - (previous.vy ?? 0)) * t,
    vz: (previous.vz ?? 0) + ((next.vz ?? 0) - (previous.vz ?? 0)) * t,
    sneaking: discrete.sneaking ?? false,
    sprinting: discrete.sprinting ?? false,
    onGround: discrete.onGround ?? true,
    invisible: discrete.invisible ?? false,
    at: renderAt,
  };
}

export class RemotePlayerView {
  readonly group = new THREE.Group();
  readonly visual: PlayerVisual;
  private readonly samples: RemotePoseSample[] = [];
  private lastTick = -1;

  constructor(info: RemotePlayerInfo, private readonly options: RemotePlayerViewOptions, now = performance.now()) {
    this.visual = options.visual;
    this.group.name = `remote-player:${info.id}`;
    this.group.add(this.visual.root);
    this.visual.root.position.set(0, 0, 0);
    this.visual.animator.reset(info.yaw);
    this.samples.push(poseSample(info, now));
    this.group.position.set(info.x, info.y, info.z);
  }

  applySnapshot(snapshot: PlayerSnapshot | RemotePlayerInfo, now = performance.now(), tick?: number): void {
    if (tick !== undefined && !shouldAcceptSnapshot(this.lastTick, tick)) return;
    if (tick !== undefined) this.lastTick = tick;
    this.samples.push(poseSample(snapshot, now));
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  interpolate(now = performance.now(), deltaSeconds = 0, daylight = 1): void {
    const pose = sampleRemotePose(this.samples, now, REMOTE_INTERP_DELAY_MS);
    if (!pose) return;
    this.group.position.set(pose.x, pose.y, pose.z);
    this.visual.update(deltaSeconds, {
      viewYaw: pose.yaw,
      viewPitch: pose.pitch ?? 0,
      movementSpeed: Math.hypot(pose.vx ?? 0, pose.vz ?? 0),
      onGround: pose.onGround ?? true,
      sneaking: pose.sneaking ?? false,
      sprinting: pose.sprinting ?? false,
      verticalVelocity: pose.vy ?? 0,
      mining: false,
      bowCharge: 0,
      swordBlocking: false,
      foodUseProgress: 0,
      invisible: pose.invisible ?? false,
      hurtFlash: 0,
    });
    this.visual.applyWorldLight(this.options.world, pose.x, pose.y, pose.z, daylight);
  }

  dispose(): void {
    this.visual.dispose();
    this.group.removeFromParent();
  }
}
