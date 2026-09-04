import { BlockId, getBlockDefinition, isKnownBlockId } from '../blocks';
import { PLAYER_NET_REACH, isValidWorldY } from '../core/constants';
import { Vec3 } from '../math/vec3';
import type { VoxelHit, VoxelWorld } from '../world/World';
import type { ActionRejectReason, BlockTargetIntent } from '../../shared/playerActions';
import { exactUnitAxisFace } from '../../shared/playerCommand';

/** Pose-lag slack only. Not a license to retarget a neighbor from delayed look. */
export const ACTION_REACH = PLAYER_NET_REACH;

const HIT_EPSILON = 0.05;
const LOS_EPSILON = 0.075;

export interface ActionEye {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ValidatedBlockIntent {
  readonly hit: VoxelHit;
  readonly face: { x: number; y: number; z: number };
}

function pointInsideTarget(intent: BlockTargetIntent): boolean {
  return intent.hitX >= intent.targetX - HIT_EPSILON
    && intent.hitX <= intent.targetX + 1 + HIT_EPSILON
    && intent.hitY >= intent.targetY - HIT_EPSILON
    && intent.hitY <= intent.targetY + 1 + HIT_EPSILON
    && intent.hitZ >= intent.targetZ - HIT_EPSILON
    && intent.hitZ <= intent.targetZ + 1 + HIT_EPSILON;
}

export function validateBlockTargetIntent(
  world: VoxelWorld,
  eye: ActionEye,
  intent: BlockTargetIntent,
  options?: { readonly requireBlock?: boolean; readonly reach?: number },
): { ok: true; value: ValidatedBlockIntent } | { ok: false; reason: ActionRejectReason } {
  if (!isValidWorldY(intent.targetY) || !Number.isInteger(intent.targetX) || !Number.isInteger(intent.targetZ)) {
    return { ok: false, reason: 'bounds' };
  }
  const face = exactUnitAxisFace(intent.faceX, intent.faceY, intent.faceZ);
  if (!face) return { ok: false, reason: 'face' };
  if (![intent.hitX, intent.hitY, intent.hitZ].every(Number.isFinite) || !pointInsideTarget(intent)) {
    return { ok: false, reason: 'hit' };
  }
  if (!Number.isInteger(intent.targetBlockId) || !isKnownBlockId(intent.targetBlockId)) {
    return { ok: false, reason: 'stale' };
  }

  const block = world.getBlock(intent.targetX, intent.targetY, intent.targetZ);
  if (options?.requireBlock !== false && block === BlockId.Air) {
    return { ok: false, reason: 'empty' };
  }
  if (block !== intent.targetBlockId) {
    return { ok: false, reason: 'stale' };
  }

  const reach = options?.reach ?? ACTION_REACH;
  const dx = intent.hitX - eye.x;
  const dy = intent.hitY - eye.y;
  const dz = intent.hitZ - eye.z;
  const distance = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(distance) || distance > reach || distance <= 1e-6) {
    return { ok: false, reason: 'reach' };
  }

  const origin = new Vec3(eye.x, eye.y, eye.z);
  const direction = new Vec3(dx / distance, dy / distance, dz / distance);
  const los = world.raycast(origin, direction, Math.min(reach, distance + LOS_EPSILON));
  if (!los
    || los.x !== intent.targetX
    || los.y !== intent.targetY
    || los.z !== intent.targetZ
    || los.normal.x !== face.x
    || los.normal.y !== face.y
    || los.normal.z !== face.z) {
    return { ok: false, reason: 'los' };
  }

  const definition = getBlockDefinition(block);
  const hit: VoxelHit = {
    x: intent.targetX,
    y: intent.targetY,
    z: intent.targetZ,
    block: block as VoxelHit['block'],
    normal: new Vec3(face.x, face.y, face.z),
    distance,
    point: new Vec3(intent.hitX, intent.hitY, intent.hitZ),
  };
  if (definition.breakable === false && options?.requireBlock !== false) {
    /* interact/place may still use unbreakable as an anchor; caller decides */
  }
  return { ok: true, value: { hit, face } };
}

/**
 * Server current look may see B. That must never replace client target A.
 * This helper exists so tests can prove the contract: validate A vs current ray B.
 */
export function resolveClientTargetVersusServerRay<T extends { readonly x: number; readonly y: number; readonly z: number }>(
  clientTarget: T,
  serverCurrentRay: T | undefined,
): { mode: 'accept-client' | 'reject'; client: T; serverRay?: T } {
  if (!serverCurrentRay) return { mode: 'accept-client', client: clientTarget };
  return { mode: 'accept-client', client: clientTarget, serverRay: serverCurrentRay };
}
