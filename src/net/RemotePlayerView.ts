import * as THREE from 'three';
import type { PlayerSnapshot, RemotePlayerInfo } from '../../shared/protocol';
import { lerpAngle } from '../core/entityInterpolation';
import { PLAYER_HEIGHT, PLAYER_WIDTH } from '../core/constants';
import { shouldAcceptSnapshot } from './authoritativeMotion';

export const REMOTE_INTERP_DELAY_MS = 80;
const MAX_SAMPLES = 8;

export interface RemotePoseSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  at: number;
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
  return {
    x: previous.x + (next.x - previous.x) * t,
    y: previous.y + (next.y - previous.y) * t,
    z: previous.z + (next.z - previous.z) * t,
    yaw: lerpAngle(previous.yaw, next.yaw, t),
    at: renderAt,
  };
}

export class RemotePlayerView {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly samples: RemotePoseSample[] = [];
  private lastTick = -1;

  constructor(info: RemotePlayerInfo, now = performance.now()) {
    const geometry = new THREE.BoxGeometry(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH);
    const material = new THREE.MeshLambertMaterial({ color: 0xc48a5a });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = PLAYER_HEIGHT / 2;
    this.group.add(this.mesh);
    this.samples.push({ x: info.x, y: info.y, z: info.z, yaw: info.yaw, at: now });
    this.group.position.set(info.x, info.y, info.z);
    this.group.rotation.y = info.yaw;
  }

  applySnapshot(snapshot: PlayerSnapshot | RemotePlayerInfo, now = performance.now(), tick?: number): void {
    if (tick !== undefined && !shouldAcceptSnapshot(this.lastTick, tick)) return;
    if (tick !== undefined) this.lastTick = tick;
    this.samples.push({ x: snapshot.x, y: snapshot.y, z: snapshot.z, yaw: snapshot.yaw, at: now });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  interpolate(now = performance.now()): void {
    const pose = sampleRemotePose(this.samples, now, REMOTE_INTERP_DELAY_MS);
    if (!pose) return;
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.rotation.y = pose.yaw;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
