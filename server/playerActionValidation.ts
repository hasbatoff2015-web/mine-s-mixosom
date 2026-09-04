import { BlockId, isKnownBlockId } from '../src/blocks';
import { PLAYER_NET_REACH, isValidWorldY } from '../src/core/constants';
import { Vec3 } from '../src/math/vec3';
import type { PlayerController } from '../src/player';
import type { VoxelHit, VoxelWorld } from '../src/world/World';
import type { ClientBlockHitIntent } from '../shared/protocol';

export type BlockIntentValidation =
  | { readonly ok: true; readonly hit: VoxelHit }
  | { readonly ok: false; readonly reason: 'bounds' | 'face' | 'hit' | 'reach' | 'stale' | 'empty' | 'los' };

const HIT_EPSILON = 0.05;
const LOS_EPSILON = 0.075;

export function directionFromCapturedLook(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return new Vec3(
    -Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
  ).normalize();
}

function validFace(intent: ClientBlockHitIntent): boolean {
  const components = [intent.faceX, intent.faceY, intent.faceZ];
  return components.every((value) => Number.isInteger(value) && value >= -1 && value <= 1)
    && Math.abs(intent.faceX) + Math.abs(intent.faceY) + Math.abs(intent.faceZ) === 1;
}

function pointInsideTarget(intent: ClientBlockHitIntent): boolean {
  return intent.hitX >= intent.targetX - HIT_EPSILON
    && intent.hitX <= intent.targetX + 1 + HIT_EPSILON
    && intent.hitY >= intent.targetY - HIT_EPSILON
    && intent.hitY <= intent.targetY + 1 + HIT_EPSILON
    && intent.hitZ >= intent.targetZ - HIT_EPSILON
    && intent.hitZ <= intent.targetZ + 1 + HIT_EPSILON;
}

/** Validate captured intent; never replace it with the server's current hit. */
export function validateBlockHitIntent(
  world: VoxelWorld,
  controller: PlayerController,
  intent: ClientBlockHitIntent,
): BlockIntentValidation {
  if (!Number.isInteger(intent.targetX) || !Number.isInteger(intent.targetY) || !Number.isInteger(intent.targetZ)
    || !isValidWorldY(intent.targetY)) return { ok: false, reason: 'bounds' };
  if (!validFace(intent)) return { ok: false, reason: 'face' };
  if (![intent.hitX, intent.hitY, intent.hitZ].every(Number.isFinite) || !pointInsideTarget(intent)) {
    return { ok: false, reason: 'hit' };
  }
  if (!Number.isInteger(intent.targetBlockId) || !isKnownBlockId(intent.targetBlockId)) {
    return { ok: false, reason: 'stale' };
  }
  const block = world.getBlock(intent.targetX, intent.targetY, intent.targetZ);
  if (block === BlockId.Air) return { ok: false, reason: 'empty' };
  if (block !== intent.targetBlockId) return { ok: false, reason: 'stale' };

  const eye = controller.eyePosition();
  const dx = intent.hitX - eye.x;
  const dy = intent.hitY - eye.y;
  const dz = intent.hitZ - eye.z;
  const distance = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(distance) || distance > PLAYER_NET_REACH || distance <= 1e-6) {
    return { ok: false, reason: 'reach' };
  }
  const direction = new Vec3(dx / distance, dy / distance, dz / distance);
  const serverHit = world.raycast(eye, direction, Math.min(PLAYER_NET_REACH, distance + LOS_EPSILON));
  if (!serverHit
    || serverHit.x !== intent.targetX
    || serverHit.y !== intent.targetY
    || serverHit.z !== intent.targetZ
    || serverHit.normal.x !== intent.faceX
    || serverHit.normal.y !== intent.faceY
    || serverHit.normal.z !== intent.faceZ) {
    return { ok: false, reason: 'los' };
  }

  return {
    ok: true,
    hit: {
      x: intent.targetX,
      y: intent.targetY,
      z: intent.targetZ,
      block,
      normal: new Vec3(intent.faceX, intent.faceY, intent.faceZ),
      distance,
      point: new Vec3(intent.hitX, intent.hitY, intent.hitZ),
    },
  };
}
