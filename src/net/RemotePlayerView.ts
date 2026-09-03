import * as THREE from 'three';
import type { PlayerSnapshot, RemotePlayerInfo } from '../../shared/protocol';
import type { PlayerVisual } from '../rendering/player/PlayerVisual';
import type { VoxelWorld } from '../world/World';
import {
  maybeLogRemoteTimeline,
} from './remoteInterpDiagnostics';
import {
  REMOTE_INTERP_DELAY_MS,
  RemoteInterpolationBuffer,
  remoteSampleFromSnapshot,
  type RemoteInterpDiagnostics,
  type RemoteSampledPose,
} from './remotePlayerInterpolation';

export { REMOTE_INTERP_DELAY_MS };

export interface RemotePlayerViewOptions {
  readonly visual: PlayerVisual;
  readonly world: VoxelWorld;
}

export class RemotePlayerView {
  readonly group = new THREE.Group();
  readonly visual: PlayerVisual;
  readonly buffer = new RemoteInterpolationBuffer();
  private readonly id: string;
  private spawnYaw: number;
  private spawnPitch: number;

  constructor(
    info: RemotePlayerInfo,
    private readonly options: RemotePlayerViewOptions,
    now = 0,
  ) {
    this.id = info.id;
    this.spawnYaw = info.yaw;
    this.spawnPitch = info.pitch;
    this.visual = options.visual;
    this.group.name = `remote-player:${info.id}`;
    this.group.add(this.visual.root);
    this.visual.root.position.set(0, 0, 0);
    this.reset(info, now);
  }

  reset(info: RemotePlayerInfo, _now = 0): void {
    this.buffer.reset();
    this.spawnYaw = info.yaw;
    this.spawnPitch = info.pitch;
    this.group.position.set(info.x, info.y, info.z);
    this.visual.animator.reset(info.yaw);
  }

  applySnapshot(snapshot: PlayerSnapshot | RemotePlayerInfo, now = 0, tick?: number): void {
    if (tick === undefined || !Number.isInteger(tick)) return;
    this.buffer.push(remoteSampleFromSnapshot(snapshot, tick, now));
  }

  interpolate(now = 0, deltaSeconds = 0, daylight = 1): RemoteSampledPose | undefined {
    const pose = this.buffer.sample(now);
    if (!pose) {
      this.visual.update(deltaSeconds, {
        viewYaw: this.spawnYaw,
        viewPitch: this.spawnPitch,
        movementSpeed: 0,
        onGround: true,
        sneaking: false,
        sprinting: false,
        verticalVelocity: 0,
        mining: false,
        bowCharge: 0,
        swordBlocking: false,
        foodUseProgress: 0,
        invisible: false,
        hurtFlash: 0,
      });
      return undefined;
    }
    this.group.position.set(pose.x, pose.y, pose.z);
    this.visual.update(deltaSeconds, {
      viewYaw: pose.yaw,
      viewPitch: pose.pitch,
      movementSpeed: Math.hypot(pose.vx, pose.vz),
      onGround: pose.onGround,
      sneaking: pose.sneaking,
      sprinting: pose.sprinting,
      verticalVelocity: pose.vy,
      mining: false,
      bowCharge: 0,
      swordBlocking: false,
      foodUseProgress: 0,
      invisible: pose.invisible,
      hurtFlash: 0,
    });
    this.visual.applyWorldLight(this.options.world, pose.x, pose.y, pose.z, daylight);
    maybeLogRemoteTimeline(this.id.slice(0, 8), this.buffer.snapshots(), this.buffer.diagnostics(now), now);
    return pose;
  }

  diagnostics(now = 0): RemoteInterpDiagnostics {
    return this.buffer.diagnostics(now);
  }

  dispose(): void {
    this.buffer.reset();
    this.visual.dispose();
    this.group.removeFromParent();
  }
}
