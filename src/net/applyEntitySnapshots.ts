import * as THREE from 'three';
import { BlockId, isKnownBlockId } from '../blocks';
import type { PlayerArrowManager } from '../combat/PlayerArrowManager';
import {
  DroppedItemManager,
  FallingBlockManager,
  MinecartManager,
  MobManager,
  MOB_DEFINITIONS,
  type MobKind,
} from '../entities';
import { createItemStack } from '../inventory';
import { isKnownItemId } from '../items';
import type { RedstoneSystem } from '../redstone';
import type { EntitySnapshot, NetworkEntityEvent } from '../../shared/protocol';
import { EntityInterpolationBuffer } from './entitySnapshotInterpolation';

export interface EntitySnapshotTarget {
  drops: DroppedItemManager;
  falling: FallingBlockManager;
  mobs: MobManager;
  arrows: PlayerArrowManager;
  minecarts: MinecartManager;
  redstone: RedstoneSystem;
}

function isMobKind(value: string | undefined): value is MobKind {
  return typeof value === 'string' && value in MOB_DEFINITIONS;
}

function ingestPose(
  interpolator: EntityInterpolationBuffer | undefined,
  snap: EntitySnapshot,
  tick: number,
  now: number,
): void {
  interpolator?.ingest(snap.id, {
    x: snap.x,
    y: snap.y,
    z: snap.z,
    yaw: snap.yaw,
    vx: snap.vx,
    vy: snap.vy,
    vz: snap.vz,
  }, tick, now);
}

/**
 * Applies server entity interest snapshots onto existing client visual managers.
 * Does not run AI, fluids, combat, or pickup. Pose history goes into the interpolator;
 * simulation `position` stores the latest accepted snapshot for targeting.
 */
export function applyEntitySnapshots(
  session: EntitySnapshotTarget,
  entities: readonly EntitySnapshot[],
  options?: {
    readonly interpolator?: EntityInterpolationBuffer;
    readonly tick?: number;
    readonly now?: number;
  },
): void {
  const interpolator = options?.interpolator;
  const tick = options?.tick ?? 0;
  const now = options?.now ?? 0;
  if (interpolator && options?.tick !== undefined && !interpolator.acceptPacketTick(tick)) {
    return;
  }

  const seen = new Set<string>();
  const tnt: Array<{
    id: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number;
  }> = [];

  for (const snap of entities) {
    seen.add(snap.id);
    switch (snap.kind) {
      case 'item': {
        if (!snap.itemId || !isKnownItemId(snap.itemId)) break;
        const existing = session.drops.get(snap.id);
        if (existing) {
          existing.position.set(snap.x, snap.y, snap.z);
          if (existing.velocity) existing.velocity.set(snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0);
          existing.stack = createItemStack(snap.itemId, Math.max(1, snap.count ?? 1));
          ingestPose(interpolator, snap, tick, now);
          break;
        }
        session.drops.spawn(createItemStack(snap.itemId, Math.max(1, snap.count ?? 1)), new THREE.Vector3(snap.x, snap.y, snap.z), {
          id: snap.id,
          velocity: new THREE.Vector3(snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0),
          pickupDelaySeconds: 999,
          merge: false,
        });
        ingestPose(interpolator, snap, tick, now);
        break;
      }
      case 'mob': {
        if (!isMobKind(snap.mobKind)) break;
        let mob = session.mobs.get(snap.id);
        if (!mob) {
          mob = session.mobs.spawn(snap.mobKind, new THREE.Vector3(snap.x, snap.y, snap.z), {
            id: snap.id,
            force: true,
            health: snap.health,
            velocity: new THREE.Vector3(snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0),
            state: snap.state === 'die' ? 'die' : 'idle',
          });
        }
        if (!mob) break;
        mob.position.set(snap.x, snap.y, snap.z);
        if (mob.velocity) mob.velocity.set(snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0);
        if (snap.yaw !== undefined) mob.facingYaw = snap.yaw;
        if (snap.health !== undefined) mob.health = snap.health;
        const hurt = snap.hurt === true;
        if (hurt && !mob.networkHurt) session.mobs.applyAuthoritativeHurt(mob.id);
        mob.networkHurt = hurt;
        if (snap.state === 'die' || (snap.health !== undefined && snap.health <= 0)) {
          session.mobs.applyAuthoritativeDeath(mob.id);
        }
        if (snap.onFire) mob.fireTicks = Math.max(mob.fireTicks, 20);
        else {
          mob.fireTicks = 0;
          mob.contactBurning = false;
          mob.sunlightBurning = false;
        }
        ingestPose(interpolator, snap, tick, now);
        break;
      }
      case 'minecart': {
        let cart = session.minecarts.get(snap.id);
        const variant = snap.variant === 'tnt' ? 'tnt' as const : 'normal' as const;
        if (!cart) {
          cart = session.minecarts.spawn(snap.x - 0.5, snap.y, snap.z - 0.5, snap.id, variant);
        }
        if (!cart) break;
        cart.position.set(snap.x, snap.y, snap.z);
        if (cart.velocity) cart.velocity.set(snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0);
        cart.yaw = snap.yaw ?? cart.yaw;
        cart.pitch = snap.pitch ?? cart.pitch;
        cart.variant = variant;
        cart.fuseTicks = snap.primed ? Math.max(1, Math.round(snap.fuse ?? 1)) : 0;
        cart.rider = Boolean(snap.passengerId);
        ingestPose(interpolator, snap, tick, now);
        break;
      }
      case 'arrow': {
        session.arrows.applyNetwork(
          snap.id, snap.x, snap.y, snap.z,
          snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0,
          snap.onFire === true,
          { snapVisual: false },
        );
        ingestPose(interpolator, snap, tick, now);
        break;
      }
      case 'falling': {
        if (snap.blockId === undefined || !isKnownBlockId(snap.blockId)) break;
        let entity = session.falling.get(snap.id);
        if (!entity) {
          entity = session.falling.spawn(snap.blockId as BlockId, snap.x - 0.5, snap.y, snap.z - 0.5, snap.id);
        }
        if (!entity) break;
        entity.position.set(snap.x, snap.y, snap.z);
        if (entity.velocity) entity.velocity.set(snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0);
        ingestPose(interpolator, snap, tick, now);
        break;
      }
      case 'tnt':
        tnt.push({
          id: snap.id, x: snap.x, y: snap.y, z: snap.z,
          vx: snap.vx ?? 0, vy: snap.vy ?? 0, vz: snap.vz ?? 0,
          fuse: snap.fuse ?? 1,
        });
        ingestPose(interpolator, snap, tick, now);
        break;
    }
  }

  session.redstone.syncNetworkPrimed(tnt, { snapVisual: false });
  interpolator?.retain(seen);
  session.arrows.retain(seen);
  for (const item of [...session.drops.entities]) {
    if (!seen.has(item.id)) session.drops.remove(item.id);
  }
  for (const mob of [...session.mobs.entities]) {
    if (seen.has(mob.id)) continue;
    if (session.mobs.shouldKeepRemoteDeath(mob.id)) continue;
    session.mobs.remove(mob.id);
  }
  for (const cart of [...session.minecarts.entities]) {
    if (!seen.has(cart.id)) session.minecarts.removeById(cart.id);
  }
  for (const falling of [...session.falling.list]) {
    if (!seen.has(falling.id)) session.falling.remove(falling.id);
  }
}

export function applyNetworkEntityEvents(
  session: EntitySnapshotTarget,
  events: readonly NetworkEntityEvent[],
): void {
  for (const event of events) {
    switch (event.kind) {
      case 'hurt':
        session.mobs.applyAuthoritativeHurt(event.entityId);
        break;
      case 'death':
        session.mobs.applyAuthoritativeDeath(event.entityId);
        break;
      case 'projectile_spawn':
      case 'projectile_hit':
        break;
    }
  }
  for (const event of events) {
    if (event.kind !== 'projectile_hit') continue;
    session.arrows.removeById(event.entityId);
  }
}

/**
 * Render-time: sample buffered snapshots onto existing meshes. No clones or allocations
 * beyond the sampled pose object.
 */
export function applyInterpolatedEntityVisuals(
  session: EntitySnapshotTarget,
  interpolator: EntityInterpolationBuffer,
  now: number,
): void {
  for (const mob of session.mobs.entities) {
    const pose = interpolator.sample(mob.id, now);
    if (pose) session.mobs.setNetworkRenderPose(mob.id, pose.x, pose.y, pose.z, pose.yaw);
    else if (!session.mobs.shouldKeepRemoteDeath(mob.id)) {
      session.mobs.setNetworkRenderPose(mob.id, undefined);
    }
  }
  session.mobs.interpolateVisuals(1);

  for (const item of session.drops.entities) {
    const pose = interpolator.sample(item.id, now);
    if (!pose) continue;
    item.previousPosition.set(pose.x, pose.y, pose.z);
    item.position.set(pose.x, pose.y, pose.z);
  }
  session.drops.interpolateVisuals(1);

  for (const cart of session.minecarts.entities) {
    const pose = interpolator.sample(cart.id, now);
    if (!pose) continue;
    cart.previousPosition.set(pose.x, pose.y, pose.z);
    cart.position.set(pose.x, pose.y, pose.z);
    cart.yaw = pose.yaw;
  }
  session.minecarts.interpolateVisuals(1);

  for (const falling of session.falling.list) {
    const pose = interpolator.sample(falling.id, now);
    if (!pose) continue;
    falling.previousPosition.set(pose.x, pose.y, pose.z);
    falling.position.set(pose.x, pose.y, pose.z);
  }
  session.falling.interpolate(1);

  for (const tnt of session.redstone.primedTnt) {
    const pose = interpolator.sample(tnt.id, now);
    if (!pose) continue;
    tnt.previousPosition.set(pose.x, pose.y, pose.z);
    tnt.position.set(pose.x, pose.y, pose.z);
  }
  session.redstone.interpolatePrimedTnt(1);

  for (const arrow of session.arrows.entities) {
    const pose = interpolator.sample(arrow.id, now);
    if (!pose) continue;
    session.arrows.applyRenderPose(arrow.id, pose.x, pose.y, pose.z, pose.vx, pose.vy, pose.vz);
  }
}
