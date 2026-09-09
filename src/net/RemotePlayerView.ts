import * as THREE from 'three';
import type { PlayerSnapshot, RemotePlayerInfo } from '../../shared/protocol';
import {
  IDLE_PLAYER_PRESENTATION,
  REMOTE_ACTION_STALE_MS,
  presentationHurtSeq,
  type PlayerPresentationState,
} from '../../shared/playerPresentation';
import type { PlayerVisual } from '../rendering/player/PlayerVisual';
import { EMPTY_PLAYER_EQUIPMENT } from '../inventory';
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
import { PlayerNameplate } from '../rendering/player/PlayerNameplate';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
  type PlayerAppearance,
} from '../player/appearance/PlayerAppearance';
import {
  humanoidDeathProgress,
} from '../entities/humanoidDeath';

export { REMOTE_INTERP_DELAY_MS };

export interface RemotePlayerViewOptions {
  readonly visual: PlayerVisual;
  readonly world: VoxelWorld;
  readonly onMining?: (id: string, mining: PlayerPresentationState['mining'], now: number) => void;
  readonly onRemove?: (id: string) => void;
}

export class RemotePlayerView {
  readonly group = new THREE.Group();
  readonly visual: PlayerVisual;
  readonly buffer = new RemoteInterpolationBuffer();
  readonly nameplate: PlayerNameplate;
  private readonly id: string;
  private spawnYaw: number;
  private spawnPitch: number;
  private presentation = IDLE_PLAYER_PRESENTATION;
  private presentationTick = -1;
  private presentationReceivedAt = 0;
  private swingSeq = 0;
  private hurtSeq = 0;
  private lastRenderedPose?: RemoteSampledPose;
  private lastInvisible = false;
  /** -1 = living. Accumulates only after the dead edge so snapshots cannot restart the pose. */
  private deathSeconds = -1;

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
    this.nameplate = new PlayerNameplate(info.name, info.health ?? 20);
    this.group.add(this.nameplate.sprite);
    if (info.appearance) this.visual.setAppearance(createPlayerAppearance(info.appearance));
    this.reset(info, now);
  }

  reset(info: RemotePlayerInfo, _now = 0): void {
    this.buffer.reset();
    this.lastRenderedPose = undefined;
    this.spawnYaw = info.yaw;
    this.spawnPitch = info.pitch;
    this.group.position.set(info.x, info.y, info.z);
    this.visual.animator.reset(info.yaw);
    this.deathSeconds = info.dead === true ? 0 : -1;
    this.presentationTick = -1;
    this.presentation = info.presentation ?? IDLE_PLAYER_PRESENTATION;
    this.presentationReceivedAt = _now;
    this.swingSeq = this.presentation.swingSeq;
    this.hurtSeq = presentationHurtSeq(this.presentation);
    this.visual.setHeldItem(this.presentation.heldItemId ?? undefined);
    this.visual.setArmor(info.equipment ?? EMPTY_PLAYER_EQUIPMENT);
    this.nameplate.setIdentity(info.name, info.health ?? this.nameplate.health);
    if (info.appearance) this.setAppearance(info.appearance);
    this.options.onMining?.(this.id, this.presentation.mining, _now);
  }

  setAppearance(appearance: PlayerAppearance): void {
    this.visual.setAppearance(createPlayerAppearance(appearance ?? DEFAULT_PLAYER_APPEARANCE));
  }

  applySnapshot(snapshot: PlayerSnapshot | RemotePlayerInfo, now = 0, tick?: number): void {
    if (tick === undefined || !Number.isInteger(tick)) return;
    this.buffer.push(remoteSampleFromSnapshot(snapshot, tick, now));
    if (tick <= this.presentationTick) return;
    this.presentationTick = tick;
    this.presentationReceivedAt = now;
    const dead = 'dead' in snapshot && snapshot.dead === true;
    const next = snapshot.presentation ?? IDLE_PLAYER_PRESENTATION;
    if (dead) {
      if (this.deathSeconds < 0) this.deathSeconds = 0;
    } else {
      this.deathSeconds = -1;
      if (next.swingSeq > this.swingSeq) this.visual.swing();
    }
    const nextHurt = presentationHurtSeq(next);
    if (nextHurt > this.hurtSeq) this.visual.triggerHurtFlash();
    this.swingSeq = Math.max(this.swingSeq, next.swingSeq);
    this.hurtSeq = Math.max(this.hurtSeq, nextHurt);
    this.presentation = dead
      ? {
        ...IDLE_PLAYER_PRESENTATION,
        swingSeq: this.swingSeq,
        hurtSeq: this.hurtSeq,
      }
      : next;
    this.visual.setHeldItem(this.presentation.heldItemId ?? undefined);
    this.visual.setArmor(dead ? EMPTY_PLAYER_EQUIPMENT : snapshot.equipment ?? EMPTY_PLAYER_EQUIPMENT);
    if ('health' in snapshot && typeof snapshot.health === 'number') {
      this.nameplate.setIdentity(snapshot.name, snapshot.health);
    } else if (snapshot.name !== this.nameplate.name) {
      this.nameplate.setIdentity(snapshot.name, this.nameplate.health);
    }
    this.options.onMining?.(this.id, this.presentation.mining, now);
  }

  interpolate(now = 0, deltaSeconds = 0, daylight = 1): RemoteSampledPose | undefined {
    const active = now - this.presentationReceivedAt <= REMOTE_ACTION_STALE_MS;
    const actions = active ? this.presentation : IDLE_PLAYER_PRESENTATION;
    const mining = actions.mining;
    const actionFrame = {
      mining: mining !== null && this.options.world.getBlock(mining.x, mining.y, mining.z, false) === mining.blockId,
      bowCharge: actions.bowCharge,
      swordBlocking: actions.swordBlocking,
      foodUseProgress: actions.foodUseProgress,
    };
    const pose = this.buffer.sample(now);
    const dying = this.deathSeconds >= 0;
    if (dying) this.deathSeconds += Math.max(0, deltaSeconds);
    const deathProgress = dying ? humanoidDeathProgress(this.deathSeconds) : 0;
    if (!pose) {
      this.visual.update(deltaSeconds, {
        viewYaw: this.spawnYaw,
        viewPitch: this.spawnPitch,
        movementSpeed: 0,
        onGround: true,
        sneaking: false,
        sprinting: false,
        verticalVelocity: 0,
        ...actionFrame,
        invisible: false,
        hurtFlash: 0,
        deathProgress,
      });
      return undefined;
    }
    this.group.position.set(pose.x, pose.y, pose.z);
    this.lastRenderedPose = pose;
    this.visual.update(deltaSeconds, {
      viewYaw: pose.yaw,
      viewPitch: pose.pitch,
      movementSpeed: dying ? 0 : Math.hypot(pose.vx, pose.vz),
      onGround: pose.onGround,
      sneaking: dying ? false : pose.sneaking,
      sprinting: dying ? false : pose.sprinting,
      verticalVelocity: dying ? 0 : pose.vy,
      ...actionFrame,
      invisible: pose.invisible,
      hurtFlash: 0,
      deathProgress,
    });
    this.lastInvisible = pose.invisible === true;
    this.nameplate.setInvisible(this.lastInvisible);
    this.visual.applyWorldLight(this.options.world, pose.x, pose.y, pose.z, daylight);
    maybeLogRemoteTimeline(this.id.slice(0, 8), this.buffer.snapshots(), this.buffer.diagnostics(now), now);
    return pose;
  }

  /** Read-only timeline of the pose already applied to group.position this frame. */
  get lastRenderTick(): number | undefined {
    return this.lastRenderedPose?.renderTick;
  }

  updateNameplate(camera: THREE.Camera): void {
    this.nameplate.setInvisible(this.lastInvisible);
    this.nameplate.update(camera);
  }

  diagnostics(now = 0): RemoteInterpDiagnostics {
    return this.buffer.diagnostics(now);
  }

  dispose(): void {
    this.options.onRemove?.(this.id);
    this.buffer.reset();
    this.nameplate.dispose();
    this.visual.dispose();
    this.group.removeFromParent();
  }
}
