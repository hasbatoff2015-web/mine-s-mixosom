import * as THREE from 'three';
import { BlockId, isKnownBlockId } from '../blocks';
import type { PlayerArrowManager } from '../combat/PlayerArrowManager';
import {
  DroppedItemManager,
  FallingBlockManager,
  MinecartManager,
  MobManager,
  MOB_DEFINITIONS,
  MOB_HURT_FLASH_SECONDS,
  type MobKind,
} from '../entities';
import { createItemStack } from '../inventory';
import { isKnownItemId } from '../items';
import type { RedstoneSystem } from '../redstone';
import type { EntitySnapshot } from '../../shared/protocol';

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

function pose(
  target: { position: THREE.Vector3; previousPosition: THREE.Vector3; velocity?: THREE.Vector3 },
  snap: EntitySnapshot,
): void {
  target.previousPosition.copy(target.position);
  target.position.set(snap.x, snap.y, snap.z);
  if (target.velocity) {
    target.velocity.set(snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0);
  }
}

/**
 * Applies server entity interest snapshots onto existing client visual managers.
 * Does not run AI, fluids, combat, or pickup.
 */
export function applyEntitySnapshots(session: EntitySnapshotTarget, entities: readonly EntitySnapshot[]): void {
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
          pose(existing, snap);
          existing.stack = createItemStack(snap.itemId, Math.max(1, snap.count ?? 1));
          break;
        }
        session.drops.spawn(createItemStack(snap.itemId, Math.max(1, snap.count ?? 1)), new THREE.Vector3(snap.x, snap.y, snap.z), {
          id: snap.id,
          velocity: new THREE.Vector3(snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0),
          pickupDelaySeconds: 999,
          merge: false,
        });
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
        pose(mob, snap);
        if (snap.yaw !== undefined) {
          mob.previousFacingYaw = mob.facingYaw;
          mob.facingYaw = snap.yaw;
        }
        if (snap.health !== undefined) mob.health = snap.health;
        if (snap.hurt) mob.hurtFlashSeconds = MOB_HURT_FLASH_SECONDS;
        if (snap.onFire) mob.fireTicks = Math.max(mob.fireTicks, 20);
        else {
          mob.fireTicks = 0;
          mob.contactBurning = false;
          mob.sunlightBurning = false;
        }
        break;
      }
      case 'minecart': {
        let cart = session.minecarts.get(snap.id);
        const variant = snap.variant === 'tnt' ? 'tnt' as const : 'normal' as const;
        if (!cart) {
          cart = session.minecarts.spawn(snap.x - 0.5, snap.y, snap.z - 0.5, snap.id, variant);
        }
        if (!cart) break;
        pose(cart, snap);
        cart.yaw = snap.yaw ?? cart.yaw;
        cart.pitch = snap.pitch ?? cart.pitch;
        cart.variant = variant;
        cart.fuseTicks = snap.primed ? Math.max(1, Math.round(snap.fuse ?? 1)) : 0;
        cart.rider = Boolean(snap.passengerId);
        break;
      }
      case 'arrow': {
        session.arrows.applyNetwork(
          snap.id, snap.x, snap.y, snap.z,
          snap.vx ?? 0, snap.vy ?? 0, snap.vz ?? 0,
          snap.onFire === true,
        );
        break;
      }
      case 'falling': {
        if (snap.blockId === undefined || !isKnownBlockId(snap.blockId)) break;
        let entity = session.falling.get(snap.id);
        if (!entity) {
          entity = session.falling.spawn(snap.blockId as BlockId, snap.x - 0.5, snap.y, snap.z - 0.5, snap.id);
        }
        if (!entity) break;
        pose(entity, snap);
        break;
      }
      case 'tnt':
        tnt.push({
          id: snap.id, x: snap.x, y: snap.y, z: snap.z,
          vx: snap.vx ?? 0, vy: snap.vy ?? 0, vz: snap.vz ?? 0,
          fuse: snap.fuse ?? 1,
        });
        break;
    }
  }

  session.redstone.syncNetworkPrimed(tnt);
  session.arrows.retain(seen);
  for (const item of [...session.drops.entities]) {
    if (!seen.has(item.id)) session.drops.remove(item.id);
  }
  for (const mob of [...session.mobs.entities]) {
    if (!seen.has(mob.id)) session.mobs.remove(mob.id);
  }
  for (const cart of [...session.minecarts.entities]) {
    if (!seen.has(cart.id)) session.minecarts.removeById(cart.id);
  }
  for (const falling of [...session.falling.list]) {
    if (!seen.has(falling.id)) session.falling.remove(falling.id);
  }
}
