import { BlockId, getBlockDefinition } from '../blocks';
import { PLAYER_REACH, isValidWorldY } from '../core/constants';
import { Vec3 } from '../math/vec3';
import type { VoxelHit, VoxelWorld } from '../world/World';
import type { ActionRejectReason, BlockTargetIntent } from '../../shared/playerActions';
import { snapUnitAxisFace } from '../../shared/playerCommand';

/** Pose-lag slack only. Not a license to retarget a neighbor from delayed look. */
export const ACTION_REACH = PLAYER_REACH + 1;

export interface ActionEye {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ValidatedBlockIntent {
  readonly hit: VoxelHit;
  readonly face: { x: number; y: number; z: number };
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
  const face = snapUnitAxisFace(intent.faceX, intent.faceY, intent.faceZ);
  if (!face) return { ok: false, reason: 'face' };
  if (![intent.hitX, intent.hitY, intent.hitZ].every(Number.isFinite)) {
    return { ok: false, reason: 'hit' };
  }

  const block = world.getBlock(intent.targetX, intent.targetY, intent.targetZ);
  if (options?.requireBlock !== false && block === BlockId.Air) {
    return { ok: false, reason: 'empty' };
  }

  const reach = options?.reach ?? ACTION_REACH;
  const dx = eye.x - intent.hitX;
  const dy = eye.y - intent.hitY;
  const dz = eye.z - intent.hitZ;
  if (dx * dx + dy * dy + dz * dz > reach * reach) {
    return { ok: false, reason: 'reach' };
  }

  const origin = new Vec3(eye.x, eye.y, eye.z);
  const toHit = new Vec3(intent.hitX - eye.x, intent.hitY - eye.y, intent.hitZ - eye.z);
  if (toHit.lengthSq() < 1e-12) return { ok: false, reason: 'los' };
  const los = world.raycast(origin, toHit, reach);
  if (!los) return { ok: false, reason: 'los' };
  if (los.x !== intent.targetX || los.y !== intent.targetY || los.z !== intent.targetZ) {
    return { ok: false, reason: 'los' };
  }

  const definition = getBlockDefinition(block);
  const hit: VoxelHit = {
    x: intent.targetX,
    y: intent.targetY,
    z: intent.targetZ,
    block: block as VoxelHit['block'],
    normal: new Vec3(face.x, face.y, face.z),
    distance: los.distance,
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
